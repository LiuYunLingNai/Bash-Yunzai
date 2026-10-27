/** fs：读用 file:// 同步 XHR，目录和 stat 用浏览器的目录列表页，写操作走 bash */
;(() => {
  const B = __bridge
  const path = __node.path
  const { Readable, Writable } = __node.stream
  const EventEmitter = __node.events

  const P = p => {
    if (p instanceof URL) p = __node.url.fileURLToPath(p)
    else if (Buffer.isBuffer(p)) p = p.toString()
    return path.resolve(String(p))
  }
  const ERRNO = { ENOENT: -2, EEXIST: -17, EISDIR: -21, ENOTDIR: -20, EIO: -5, ENOSYS: -38, EBADF: -9, ENOTEMPTY: -39 }
  const MSG = { ENOENT: "no such file or directory", EEXIST: "file already exists", EISDIR: "illegal operation on a directory", ENOTDIR: "not a directory", EIO: "i/o error", ENOSYS: "function not implemented", EBADF: "bad file descriptor", ENOTEMPTY: "directory not empty" }
  const fsErr = (code, syscall, p, detail) =>
    Object.assign(Error(`${code}: ${MSG[code] || code}, ${syscall} '${p}'${detail ? ` ${detail}` : ""}`), { code, errno: ERRNO[code], syscall, path: p })
  /** bash 返回的 stderr → 错误码 */
  const bashErr = (r, syscall, p) => {
    const err = B.outText(r.id)
    const code = /No such file/i.test(err) ? "ENOENT" : /Is a directory/i.test(err) ? "EISDIR" : /File exists/i.test(err) ? "EEXIST" : /Not a directory/i.test(err) ? "ENOTDIR" : "EIO"
    return fsErr(code, syscall, p, err.trim())
  }

  /** 目录列表缓存，写操作和外部命令后清空 */
  const cache = new Map()
  const TTL = 1000
  const dirty = () => cache.clear()
  const isListing = t => t.startsWith("<!DOCTYPE html>") && t.includes("addRow(")
  const listRaw = dir => {
    const key = dir.toLowerCase()
    const c = cache.get(key)
    if (c && Date.now() - c.t < TTL) return c.v
    let v = null
    try {
      const x = new XMLHttpRequest()
      x.open("GET", B.toURL(dir.endsWith("/") ? dir : `${dir}/`), false)
      x.send()
      const t = x.responseText
      if (isListing(t)) {
        v = []
        for (const m of t.matchAll(/<script>addRow\((.*?)\);<\/script>/g)) {
          try {
            const [name, , isdir, size, , mtime] = JSON.parse(`[${m[1]}]`)
            if (name !== "..") v.push({ name, isdir: !!isdir, size, mtime: mtime * 1000 })
          } catch {}
        }
      }
    } catch {}
    cache.set(key, { t: Date.now(), v })
    return v
  }
  const isRoot = p => p === "/" || /^[a-zA-Z]:\/?$/.test(p)
  const statRaw = p => {
    if (isRoot(p)) return { name: p, isdir: true, size: 0, mtime: 0 }
    const list = listRaw(path.dirname(p))
    if (!list) return null
    const base = path.basename(p)
    return list.find(i => i.name === base) || (process.platform === "win32" && list.find(i => i.name.toLowerCase() === base.toLowerCase())) || null
  }

  class Stats {
    constructor(s) {
      const t = new Date(s.mtime)
      Object.assign(this, { dev: 0, ino: 0, mode: s.isdir ? 0o40755 : 0o100644, nlink: 1, uid: 0, gid: 0, rdev: 0, size: s.size, blksize: 4096, blocks: Math.ceil(s.size / 512), atimeMs: s.mtime, mtimeMs: s.mtime, ctimeMs: s.mtime, birthtimeMs: s.mtime, atime: t, mtime: t, ctime: t, birthtime: t })
      this._dir = s.isdir
    }
    isFile() { return !this._dir }
    isDirectory() { return this._dir }
    isSymbolicLink() { return false }
    isBlockDevice() { return false }
    isCharacterDevice() { return false }
    isFIFO() { return false }
    isSocket() { return false }
  }
  class Dirent {
    constructor(s, dir) {
      this.name = s.name
      this.parentPath = this.path = dir
      this._dir = s.isdir
    }
    isFile() { return !this._dir }
    isDirectory() { return this._dir }
    isSymbolicLink() { return false }
    isBlockDevice() { return false }
    isCharacterDevice() { return false }
    isFIFO() { return false }
    isSocket() { return false }
  }

  /** 真实路径：浏览器看不出符号链接 / junction，交给 bash 的 cd -P */
  const realCache = new Map()
  const realpathSync = p => {
    p = P(p)
    const key = process.platform === "win32" ? p.toLowerCase() : p
    if (realCache.has(key)) return realCache.get(key)
    const r = B.sync("fs.realpath", p)
    if (r.code !== "0") throw bashErr(r, "realpath", p)
    const v = B.outText(r.id, ".path") || p
    realCache.set(key, v)
    return v
  }

  const encOf = o => (typeof o === "string" ? o : o?.encoding)
  const decode = (b, enc) => (enc && enc !== "buffer" ? b.toString(enc) : b)
  const fds = new Map()
  let nextFd = 100

  const readFileSync = (p, o) => {
    if (typeof p === "number") {
      const f = fds.get(p)
      if (!f) throw fsErr("EBADF", "read", p)
      p = f.path
    }
    p = P(p)
    let b
    try {
      b = B.readBytes(p)
    } catch {
      throw fsErr("ENOENT", "open", p)
    }
    if (b.length > 15 && b[0] === 0x3c && b[1] === 0x21 && statRaw(p)?.isdir) throw fsErr("EISDIR", "read", p)
    return decode(Buffer.from(b.buffer), encOf(o))
  }
  const toWrite = (d, o) => (typeof d === "string" ? (encOf(o) && !/^utf-?8$/i.test(encOf(o)) ? Buffer.from(d, encOf(o)) : d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : String(d))
  const writeFileSync = (p, d, o) => {
    if (typeof p === "number") {
      const f = fds.get(p)
      if (!f) throw fsErr("EBADF", "write", p)
      return writeFileSync(f.path, d, { ...(typeof o === "object" ? o : {}), flag: "a" })
    }
    p = P(p)
    const r = B.sync(String(o?.flag || "").startsWith("a") ? "fs.append" : "fs.write", p, toWrite(d, o))
    dirty()
    if (r.code !== "0") throw bashErr(r, "open", p)
  }
  const appendFileSync = (p, d, o) => writeFileSync(p, d, { ...(typeof o === "string" ? { encoding: o } : o), flag: "a" })
  const existsSync = p => {
    try {
      return !!statRaw(P(p))
    } catch {
      return false
    }
  }
  const statSync = (p, o) => {
    p = P(p)
    const s = statRaw(p)
    if (!s) {
      if (o?.throwIfNoEntry === false) return undefined
      throw fsErr("ENOENT", "stat", p)
    }
    return new Stats(s)
  }
  const readdirSync = (p, o) => {
    p = P(p)
    const list = listRaw(p)
    if (!list) throw fsErr(statRaw(p) ? "ENOTDIR" : "ENOENT", "scandir", p)
    let out = list.map(i => (o?.withFileTypes ? new Dirent(i, p) : i.name))
    if (o?.recursive)
      for (const i of list)
        if (i.isdir)
          out = out.concat(readdirSync(`${p}/${i.name}`, o).map(j => (o.withFileTypes ? j : `${i.name}/${j}`)))
    return out
  }
  const mkdirSync = (p, o) => {
    p = P(p)
    const recursive = typeof o === "object" ? o?.recursive : false
    const s = statRaw(p)
    if (s) {
      if (recursive && s.isdir) return undefined
      throw fsErr("EEXIST", "mkdir", p)
    }
    if (!recursive && !statRaw(path.dirname(p))) throw fsErr("ENOENT", "mkdir", p)
    const r = B.sync("fs.mkdir", p)
    dirty()
    if (r.code !== "0") throw bashErr(r, "mkdir", p)
    return recursive ? p : undefined
  }
  const rmSync = (p, o) => {
    p = P(p)
    if (!statRaw(p)) {
      if (o?.force) return
      throw fsErr("ENOENT", "rm", p)
    }
    const r = B.sync("fs.rm", p)
    dirty()
    if (r.code !== "0") throw bashErr(r, "rm", p)
  }
  const unlinkSync = p => {
    p = P(p)
    const s = statRaw(p)
    if (!s) throw fsErr("ENOENT", "unlink", p)
    if (s.isdir) throw fsErr("EISDIR", "unlink", p)
    rmSync(p)
  }
  const rmdirSync = (p, o) => rmSync(p, o)
  const pair = (op, syscall) => (a, b) => {
    a = P(a)
    b = P(b)
    if (!statRaw(a)) throw fsErr("ENOENT", syscall, a)
    const r = B.sync(op, a, b)
    dirty()
    if (r.code !== "0") throw bashErr(r, syscall, a)
  }
  const renameSync = pair("fs.mv", "rename")
  const copyFileSync = pair("fs.cp", "copyfile")
  /** cp -r 在目标目录已存在时会把源目录放进去，Node 的 cpSync 是合并内容 */
  const cpSync = (a, b, o) => {
    a = P(a)
    b = P(b)
    const s = statRaw(a)
    if (!s) throw fsErr("ENOENT", "cp", a)
    if (s.isdir && statRaw(b)?.isdir) {
      for (const i of readdirSync(a)) cpSync(`${a}/${i}`, `${b}/${i}`, o)
      return
    }
    copyFileSync(a, b)
  }

  const openSync = (p, flags = "r") => {
    p = P(p)
    const fd = nextFd++
    if (/[wa]/.test(flags) && !/a/.test(flags)) writeFileSync(p, "")
    else if (/a/.test(flags) && !statRaw(p)) writeFileSync(p, "")
    else if (!statRaw(p)) throw fsErr("ENOENT", "open", p)
    fds.set(fd, { path: p, flags, pos: 0 })
    return fd
  }
  const closeSync = fd => void fds.delete(fd)
  const writeSync = (fd, d, ...a) => {
    const f = fds.get(fd)
    if (!f) throw fsErr("EBADF", "write", fd)
    if (typeof d !== "string" && typeof a[0] === "number") d = d.subarray(a[0], a[0] + (a[1] ?? d.length))
    appendFileSync(f.path, d)
    return typeof d === "string" ? Buffer.byteLength(d) : d.length
  }
  const readSync = (fd, buf, off = 0, len = buf.length - off, pos) => {
    const f = fds.get(fd)
    if (!f) throw fsErr("EBADF", "read", fd)
    if (typeof off === "object") ({ offset: off = 0, length: len = buf.length - off, position: pos } = off)
    const b = (f.data ??= B.readBytes(f.path))
    const start = pos ?? f.pos
    const n = Math.max(0, Math.min(len, b.length - start))
    buf.set(b.subarray(start, start + n), off)
    if (pos == null) f.pos += n
    return n
  }
  const fstatSync = fd => {
    const f = fds.get(fd)
    if (!f) throw fsErr("EBADF", "fstat", fd)
    return statSync(f.path)
  }

  const createReadStream = (p, o = {}) => {
    if (typeof o === "string") o = { encoding: o }
    const r = new Readable({ encoding: o.encoding })
    r.path = p
    promises.readFile(p).then(
      b => {
        r.push(b.subarray(o.start || 0, o.end != null ? o.end + 1 : undefined))
        r.push(null)
      },
      err => r.destroy(err),
    )
    return r
  }
  const createWriteStream = (p, o = {}) => {
    if (typeof o === "string") o = { encoding: o }
    p = P(p)
    let first = !String(o.flags || "").startsWith("a")
    const w = new Writable({
      write(chunk, enc, cb) {
        const op = first ? "fs.write" : "fs.append"
        first = false
        B.call(op, p, toWrite(chunk, enc)).then(r => (dirty(), cb(r.code === "0" ? null : bashErr(r, "write", p))))
      },
    })
    w.path = p
    w.bytesWritten = 0
    if (first) w.write("")
    return w
  }
  class FSWatcher extends EventEmitter {
    close() {}
    ref() { return this }
    unref() { return this }
  }

  const readFileAsync = (p, o) =>
    new Promise((resolve, reject) => {
      if (typeof p === "object" && p?.fd !== undefined) p = fds.get(p.fd)?.path
      p = P(p)
      const x = new XMLHttpRequest()
      x.open("GET", B.toURL(p))
      x.responseType = "arraybuffer"
      x.onload = () => {
        const b = Buffer.from(x.response)
        if (b.length > 15 && b[0] === 0x3c && b[1] === 0x21 && statRaw(p)?.isdir) return reject(fsErr("EISDIR", "read", p))
        resolve(decode(b, encOf(o)))
      }
      x.onerror = () => reject(fsErr("ENOENT", "open", p))
      x.send()
    })
  const asyncOp = (op, syscall, pre) => async (a, b, o) => {
    if (pre) {
      const r = pre(a, b, o)
      if (r !== undefined) return r === true ? undefined : r
    }
    const r = await B.call(op, ...[a, b].filter(i => i !== undefined))
    dirty()
    if (r.code !== "0") throw bashErr(r, syscall, a)
  }
  const wrapSync = fn => async (...a) => fn(...a)
  const promises = {
    readFile: readFileAsync,
    writeFile: async (p, d, o) => {
      if (typeof p === "object" && p?.fd !== undefined) p = fds.get(p.fd)?.path
      p = P(p)
      const r = await B.call(String(o?.flag || "").startsWith("a") ? "fs.append" : "fs.write", p, toWrite(d, o))
      dirty()
      if (r.code !== "0") throw bashErr(r, "open", p)
    },
    appendFile: (p, d, o) => promises.writeFile(p, d, { ...(typeof o === "string" ? { encoding: o } : o), flag: "a" }),
    mkdir: async (p, o) => {
      p = P(p)
      const recursive = typeof o === "object" ? o?.recursive : false
      const s = statRaw(p)
      if (s) {
        if (recursive && s.isdir) return undefined
        throw fsErr("EEXIST", "mkdir", p)
      }
      await asyncOp("fs.mkdir", "mkdir")(p)
      return recursive ? p : undefined
    },
    rm: async (p, o) => {
      p = P(p)
      if (!statRaw(p)) {
        if (o?.force) return
        throw fsErr("ENOENT", "rm", p)
      }
      await asyncOp("fs.rm", "rm")(p)
    },
    unlink: async p => {
      p = P(p)
      if (!statRaw(p)) throw fsErr("ENOENT", "unlink", p)
      await asyncOp("fs.rm", "unlink")(p)
    },
    rmdir: async (p, o) => promises.rm(p, o),
    rename: async (a, b) => asyncOp("fs.mv", "rename")(P(a), P(b)),
    copyFile: async (a, b) => asyncOp("fs.cp", "copyfile")(P(a), P(b)),
    cp: wrapSync(cpSync),
    stat: wrapSync(statSync),
    lstat: wrapSync(statSync),
    readdir: wrapSync(readdirSync),
    access: async p => {
      if (!statRaw(P(p))) throw fsErr("ENOENT", "access", P(p))
    },
    realpath: wrapSync(realpathSync),
    utimes: async () => {},
    chmod: async () => {},
    mkdtemp: async prefix => {
      const p = `${prefix}${Math.random().toString(36).slice(2, 8)}`
      await promises.mkdir(p, { recursive: true })
      return p
    },
    open: async (p, flags) => {
      const fd = openSync(p, flags)
      return {
        fd,
        readFile: o => promises.readFile(fds.get(fd).path, o),
        writeFile: (d, o) => promises.writeFile(fds.get(fd).path, d, o),
        appendFile: (d, o) => promises.appendFile(fds.get(fd).path, d, o),
        write: async d => ({ bytesWritten: writeSync(fd, d) }),
        read: async (buf, off, len, pos) => ({ bytesRead: readSync(fd, buf, off, len, pos), buffer: buf }),
        stat: async () => fstatSync(fd),
        close: async () => closeSync(fd),
        [Symbol.asyncDispose]: async () => closeSync(fd),
      }
    },
  }
  promises.constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 }

  /** 回调版 */
  const cbify = fn => (...a) => {
    const cb = typeof a.at(-1) === "function" ? a.pop() : () => {}
    fn(...a).then(r => cb(null, r), cb)
  }
  const fs = {
    readFileSync, writeFileSync, appendFileSync, existsSync, statSync, lstatSync: statSync, readdirSync,
    mkdirSync, rmSync, rmdirSync, unlinkSync, renameSync, copyFileSync, cpSync,
    openSync, closeSync, writeSync, readSync, fstatSync,
    accessSync: p => void statSync(p),
    realpathSync: Object.assign(realpathSync, { native: realpathSync }),
    chmodSync() {}, utimesSync() {}, symlinkSync() { throw fsErr("ENOSYS", "symlink", "") },
    readlinkSync: p => { throw fsErr("ENOSYS", "readlink", P(p)) },
    mkdtempSync: prefix => mkdirSync(`${prefix}${Math.random().toString(36).slice(2, 8)}`, { recursive: true }),
    createReadStream, createWriteStream,
    watch: () => new FSWatcher(), watchFile() {}, unwatchFile() {},
    Stats, Dirent, FSWatcher, promises,
    constants: promises.constants, F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1,
    exists: (p, cb) => cb(existsSync(p)),
    _dirty: dirty,
  }
  for (const [k, fn] of Object.entries(promises)) if (typeof fn === "function" && !fs[k]) fs[k] = cbify(fn)
  fs.default = fs
  __node.fs = fs
  __node["fs/promises"] = promises
})()
