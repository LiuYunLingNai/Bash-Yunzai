/** child_process（交给 bash 执行）、网络类模块的 fetch 实现或桩 */
;(() => {
  const B = __bridge
  const EventEmitter = __node.events
  const { Readable, Writable } = __node.stream

  /** bash 跑完后读 stdout / stderr */
  const result = id => {
    let out, err
    try { out = Buffer.from(B.readBytes(`${B.ROOT}/temp/bridge/${id}.out`).buffer) } catch { out = Buffer.alloc(0) }
    try { err = Buffer.from(B.readBytes(`${B.ROOT}/temp/bridge/${id}.err`).buffer) } catch { err = Buffer.alloc(0) }
    __node.fs._dirty()
    return { out, err }
  }
  const sq = s => `'${String(s).replace(/'/g, `'\\''`)}'`
  const envPrefix = env => {
    if (!env) return ""
    return Object.entries(env)
      .filter(([k, v]) => /^[A-Za-z_]\w*$/.test(k) && v !== undefined && process.env[k] !== v)
      .map(([k, v]) => `export ${k}=${sq(v)}; `)
      .join("")
  }
  const cwdOf = o => __node.path.resolve(o?.cwd ? String(o.cwd) : process.cwd())
  const enc = (b, o) => (o?.encoding === "buffer" ? b : b.toString(o?.encoding || "utf8"))

  class ChildProcess extends EventEmitter {
    constructor() {
      super()
      this.pid = Math.floor(Math.random() * 1e6)
      this.stdout = new Readable()
      this.stderr = new Readable()
      this.stdin = new Writable({ write: (c, e, cb) => cb() })
      this.exitCode = null
    }
    kill() {
      return false
    }
    ref() { return this }
    unref() { return this }
  }

  /** 在 bash 里运行，完成后把输出推到子进程流并 resolve；input 为写给子进程的 stdin */
  let stdinSeq = 0
  const run = async (cmd, o, cp, input) => {
    if (input?.length) {
      const f = `${B.ROOT}/temp/bridge/stdin-${++stdinSeq}`
      await B.call("fs.write", f, input)
      cmd = `{ ${cmd}\n} <${sq(f)}`
    }
    return B.call("exec", cwdOf(o), envPrefix(o?.env) + cmd).then(r => {
      const code = Number(r.code) || 0
      const { out, err } = result(r.id)
      if (out.length) cp.stdout.push(out)
      cp.stdout.push(null)
      if (err.length) cp.stderr.push(err)
      cp.stderr.push(null)
      cp.exitCode = code
      queueMicrotask(() => {
        cp.emit("exit", code, null)
        cp.emit("close", code, null)
      })
      return { code, out, err }
    })
  }

  const exec = (cmd, o, cb) => {
    if (typeof o === "function") [cb, o] = [o, {}]
    const cp = new ChildProcess()
    run(cmd, o, cp).then(({ code, out, err }) => {
      const error = code ? Object.assign(Error(`Command failed: ${cmd}\n${err}`), { code, killed: false, signal: null, cmd }) : null
      cb?.(error, enc(out, o), enc(err, o))
    })
    return cp
  }
  const execFile = (file, args, o, cb) => {
    if (typeof args === "function") [cb, args, o] = [args, [], {}]
    else if (!Array.isArray(args)) [cb, o, args] = [o, args, []]
    if (typeof o === "function") [cb, o] = [o, {}]
    return exec([file, ...(args || [])].map(sq).join(" "), o, cb)
  }
  const spawn = (cmd, args, o) => {
    if (!Array.isArray(args)) [o, args] = [args, []]
    const line = o?.shell ? [cmd, ...args].join(" ") : [cmd, ...args].map(sq).join(" ")
    const cp = new ChildProcess()
    /**
     * 不能边跑边写 stdin：收集写入，stdin.end() 后再执行（systeminformation 调 PowerShell 就是这样）
     * 50ms 内没人写 stdin 就直接执行；不支持一直开着的交互式子进程
     */
    const input = []
    let start
    const started = new Promise(r => (start = r))
    cp.stdin = new Writable({
      write: (c, e, cb) => (input.push(Buffer.from(c)), cb()),
      final: cb => (start(), cb()),
    })
    /** 50ms 内没写过 stdin 视为不需要输入；写过就等 end() */
    const timer = setTimeout(() => input.length || start(), 50)
    started.then(() => {
      clearTimeout(timer)
      return run(line, o, cp, input.length ? Buffer.concat(input) : null)
    }).then(({ code, out, err }) => {
      /** 127 = 命令不存在，Node 下 spawn 会触发 error（ENOENT） */
      if (code === 127 && !o?.shell) cp.emit("error", Object.assign(Error(`spawn ${cmd} ENOENT`), { code: "ENOENT", errno: -2, syscall: `spawn ${cmd}`, path: cmd }))
      else if (o?.stdio === "inherit" || o?.stdio?.[1] === "inherit") {
        if (out.length) process.stdout.write(out)
        if (err.length) process.stderr.write(err)
      }
    })
    return cp
  }
  const execSync = (cmd, o = {}) => {
    const r = B.sync("exec", cwdOf(o), envPrefix(o.env) + cmd)
    const code = Number(r.code) || 0
    const { out, err } = result(r.id)
    if (code) throw Object.assign(Error(`Command failed: ${cmd}\n${err}`), { status: code, stdout: enc(out, o), stderr: enc(err, o), output: [null, out, err] })
    return o.encoding && o.encoding !== "buffer" ? out.toString(o.encoding) : out
  }
  const spawnSync = (cmd, args = [], o = {}) => {
    if (!Array.isArray(args)) [o, args] = [args, []]
    const line = o.shell ? [cmd, ...args].join(" ") : [cmd, ...args].map(sq).join(" ")
    const r = B.sync("exec", cwdOf(o), envPrefix(o.env) + line)
    const { out, err } = result(r.id)
    return { pid: 0, status: Number(r.code) || 0, signal: null, stdout: enc(out, o), stderr: enc(err, o), output: [null, out, err] }
  }
  __node.child_process = {
    exec, execFile, spawn, execSync, spawnSync, ChildProcess,
    execFileSync: (f, a = [], o) => execSync([f, ...a].map(sq).join(" "), o),
    fork: () => { throw Error("fork 不支持") },
  }

  /** http / https：用 fetch 实现常用的 get / request */
  const request = (url, o, cb) => {
    if (typeof url === "object" && !(url instanceof URL)) [cb, o, url] = [o, url, null]
    if (typeof o === "function") [cb, o] = [o, {}]
    o ||= {}
    const u = url ? new URL(url) : new URL(`${o.protocol || "http:"}//${o.hostname || o.host || "localhost"}${o.port ? `:${o.port}` : ""}${o.path || "/"}`)
    const body = []
    const req = new Writable({ write: (c, e, done) => (body.push(typeof c === "string" ? Buffer.from(c) : c), done()) })
    req.setTimeout = () => req
    req.setHeader = (k, v) => ((o.headers ||= {})[k] = v)
    req.abort = req.destroy = () => req.emit("abort")
    req.on("finish", async () => {
      try {
        const r = await fetch(u, { method: o.method || "GET", headers: o.headers, body: body.length ? Buffer.concat(body) : undefined, redirect: "manual" })
        const res = new Readable()
        Object.assign(res, { statusCode: r.status, statusMessage: r.statusText, headers: Object.fromEntries(r.headers) })
        cb?.(res)
        req.emit("response", res)
        res.push(Buffer.from(await r.arrayBuffer()))
        res.push(null)
      } catch (err) {
        req.emit("error", err)
      }
    })
    return req
  }
  const get = (...a) => {
    const r = request(...a)
    r.end()
    return r
  }
  const Agent = class { constructor(o) { this.options = o } destroy() {} }
  const http = { request, get, Agent, globalAgent: new Agent(), STATUS_CODES: {}, METHODS: ["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"], createServer: () => { throw Error("bash-yunzai 不支持 HTTP 服务器") }, Server: class {}, IncomingMessage: Readable, ServerResponse: Writable }
  __node.http = http
  __node.https = { ...http }
  __node.http2 = { connect: () => { throw Error("http2 不支持") }, constants: {} }
  const noNet = () => { throw Error("bash-yunzai 不支持原始 socket") }
  __node.net = { Socket: class extends EventEmitter { connect() { noNet() } }, createServer: noNet, createConnection: noNet, connect: noNet, isIP: s => (/^\d+\.\d+\.\d+\.\d+$/.test(s) ? 4 : s.includes(":") ? 6 : 0), isIPv4: s => /^\d+\.\d+\.\d+\.\d+$/.test(s), isIPv6: s => s.includes(":") }
  __node.tls = { connect: noNet, createServer: noNet, TLSSocket: class {} }
  __node.dgram = { createSocket: noNet }
  const lookup = (h, o, cb) => ((cb ||= o), queueMicrotask(() => cb(null, "127.0.0.1", 4)))
  __node.dns = { lookup, promises: { lookup: async () => ({ address: "127.0.0.1", family: 4 }) }, setDefaultResultOrder() {} }
  __node["dns/promises"] = __node.dns.promises

  /** zlib：只支持异步解压/压缩（CompressionStream） */
  const stream = (Cls, fmt) => async b => Buffer.from(await new Response(new Blob([b]).stream().pipeThrough(new Cls(fmt))).arrayBuffer())
  const zcb = fn => (b, o, cb) => (typeof o === "function" && (cb = o), fn(b).then(r => cb(null, r), cb))
  const noSync = () => { throw Error("zlib 同步接口不支持") }
  __node.zlib = {
    gzip: zcb(stream(CompressionStream, "gzip")), gunzip: zcb(stream(DecompressionStream, "gzip")),
    deflate: zcb(stream(CompressionStream, "deflate")), inflate: zcb(stream(DecompressionStream, "deflate")),
    deflateRaw: zcb(stream(CompressionStream, "deflate-raw")), inflateRaw: zcb(stream(DecompressionStream, "deflate-raw")),
    unzip: zcb(stream(DecompressionStream, "gzip")),
    gzipSync: noSync, gunzipSync: noSync, deflateSync: noSync, inflateSync: noSync, brotliCompressSync: noSync, brotliDecompressSync: noSync,
    createGzip: noSync, createGunzip: noSync, constants: {},
  }

  /** stdin：bash 读终端，逐行回调 __yz.stdinLine / stdinClose；首次监听时才让 bash 开始读 */
  const q = new URLSearchParams(location.search)
  const stdin = Object.assign(new Readable(), {
    isTTY: q.get("tty") === "1",
    fd: 0,
    setRawMode() { return this },
    ref() { return this },
    unref() { return this },
  })
  let reading = false
  const startRead = () => reading || ((reading = true), B.send("stdin.on", "-", []))
  for (const k of ["on", "once", "addListener"]) {
    const orig = stdin[k]
    stdin[k] = function (name, fn) {
      if (name === "data" || name === "readable" || name === "end") startRead()
      return orig.call(this, name, fn)
    }
  }
  stdin.resume = function () {
    startRead()
    return Readable.prototype.resume.call(this)
  }
  __yz.stdinLine = line => stdin.push(Buffer.from(`${line}\n`))
  __yz.stdinClose = () => stdin.push(null)
  process.stdin = stdin
  if (q.get("force_tty")) process.env.FORCE_TTY = q.get("force_tty")

  /** readline：按行切分 input，支持 line / close / question / history / 异步迭代 */
  class Interface extends EventEmitter {
    constructor(input, output) {
      if (input && !input.on && input.input) ({ input, output } = input)
      super()
      this.input = input
      this.output = output
      this.history = []
      this.historySize = 30
      this.closed = false
      this.buf = ""
      this.pending = []
      input?.on?.("data", c => {
        this.buf += String(c)
        let i
        while ((i = this.buf.indexOf("\n")) !== -1) {
          const line = this.buf.slice(0, i).replace(/\r$/, "")
          this.buf = this.buf.slice(i + 1)
          if (line) this.history.unshift(line)
          if (this.history.length > this.historySize) this.history.length = this.historySize
          const w = this.pending.shift()
          if (w) w(line)
          else this.emit("line", line)
        }
      })
      input?.on?.("end", () => this.close())
    }
    setPrompt(p) { this.promptText = p }
    getPrompt() { return this.promptText ?? "> " }
    prompt() { this.output?.write?.(this.getPrompt()) }
    write(d) { this.output?.write?.(String(d)) }
    pause() { return this }
    resume() { return this }
    close() {
      if (this.closed) return
      this.closed = true
      this.emit("close")
    }
    _question(text) {
      this.output?.write?.(text)
      return new Promise(resolve => this.pending.push(resolve))
    }
    question(text, o, cb) {
      if (typeof o === "function") cb = o
      const p = this._question(text)
      if (cb) p.then(cb)
      return p
    }
    [Symbol.asyncIterator]() {
      const it = EventEmitter.on(this, "line")
      const next = it[Symbol.asyncIterator]().next
      return { next: async () => (this.closed ? { done: true } : { value: (await next()).value[0], done: false }), [Symbol.asyncIterator]() { return this } }
    }
  }
  const createInterface = (input, output) => new Interface(input, output)
  __node.readline = { createInterface, Interface, emitKeypressEvents() {}, clearLine: () => true, cursorTo: () => true, moveCursor: () => true }
  __node["readline/promises"] = { createInterface, Interface }
  __node.worker_threads = { isMainThread: true, parentPort: null, workerData: null, threadId: 0, Worker: class { constructor() { throw Error("worker_threads 不支持") } } }
  __node.cluster = { isPrimary: true, isMaster: true, isWorker: false, fork() {}, on() {} }
  __node.diagnostics_channel = { channel: () => ({ hasSubscribers: false, publish() {}, subscribe() {}, unsubscribe() {} }), subscribe() {}, unsubscribe() {}, tracingChannel: () => ({ hasSubscribers: false }) }
  __node.inspector = { url: () => undefined, open() {}, close() {} }
  __node.punycode = { toASCII: s => new URL(`http://${s}`).hostname, toUnicode: s => s }
})()
