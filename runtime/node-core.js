/** Node 内置模块（纯计算部分）：注册到 globalThis.__node */
;(() => {
  const N = (globalThis.__node = {})
  const B = __bridge

  /** events */
  class EventEmitter {
    static defaultMaxListeners = 10
    static captureRejections = false
    _ev() {
      return (this._events ??= Object.create(null))
    }
    on(name, fn) {
      const ev = this._ev()
      if (ev.newListener && name !== "newListener") this.emit("newListener", name, fn)
      ;(ev[name] ??= []).push(fn)
      return this
    }
    addListener(name, fn) {
      return this.on(name, fn)
    }
    prependListener(name, fn) {
      ;(this._ev()[name] ??= []).unshift(fn)
      return this
    }
    once(name, fn) {
      const w = (...args) => {
        this.off(name, w)
        return fn.apply(this, args)
      }
      w.listener = fn
      return this.on(name, w)
    }
    prependOnceListener(name, fn) {
      const w = (...args) => {
        this.off(name, w)
        return fn.apply(this, args)
      }
      w.listener = fn
      return this.prependListener(name, w)
    }
    off(name, fn) {
      const list = this._ev()[name]
      if (!list) return this
      const i = list.findIndex(l => l === fn || l.listener === fn)
      if (i !== -1) list.splice(i, 1)
      if (!list.length) delete this._ev()[name]
      return this
    }
    removeListener(name, fn) {
      return this.off(name, fn)
    }
    removeAllListeners(name) {
      if (name === undefined) this._events = Object.create(null)
      else delete this._ev()[name]
      return this
    }
    emit(name, ...args) {
      const list = this._ev()[name]
      if (!list?.length) {
        if (name === "error") throw args[0] instanceof Error ? args[0] : Error(`Unhandled error: ${args[0]}`)
        return false
      }
      for (const fn of [...list]) fn.apply(this, args)
      return true
    }
    listeners(name) {
      return (this._ev()[name] || []).map(l => l.listener || l)
    }
    rawListeners(name) {
      return [...(this._ev()[name] || [])]
    }
    listenerCount(name) {
      return (this._ev()[name] || []).length
    }
    eventNames() {
      return Reflect.ownKeys(this._ev())
    }
    setMaxListeners() {
      return this
    }
    getMaxListeners() {
      return EventEmitter.defaultMaxListeners
    }
  }
  EventEmitter.EventEmitter = EventEmitter
  EventEmitter.once = (em, name) =>
    new Promise((resolve, reject) => {
      em.once(name, (...args) => resolve(args))
      if (name !== "error") em.once?.("error", reject)
    })
  EventEmitter.on = (em, name) => {
    const q = [], w = []
    em.on(name, (...args) => (w.length ? w.shift()(args) : q.push(args)))
    return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(r => (q.length ? r({ value: q.shift() }) : w.push(v => r({ value: v })))) }) }
  }
  EventEmitter.setMaxListeners = () => {}
  N.events = EventEmitter

  /** path（posix 语义，额外认识 D:/ 盘符） */
  const norm = p => {
    p = String(p).replace(/\\/g, "/")
    const m = p.match(/^([a-zA-Z]:)?(\/)?/)
    const root = (m[1] || "") + (m[2] || "")
    const out = []
    for (const s of p.slice(m[0].length).split("/")) {
      if (!s || s === ".") continue
      if (s === "..") {
        if (out.length && out.at(-1) !== "..") out.pop()
        else if (!root) out.push("..")
      } else out.push(s)
    }
    const r = root + out.join("/")
    return r || "."
  }
  const path = {
    sep: "/",
    delimiter: process.platform === "win32" ? ";" : ":",
    normalize: p => {
      const r = norm(p)
      return /[\\/]$/.test(p) && r !== "/" && !r.endsWith("/") ? r + "/" : r
    },
    join: (...a) => norm(a.filter(i => i !== "").join("/") || "."),
    resolve: (...a) => {
      let r = ""
      for (let i = a.length - 1; i >= 0 && !B.isAbs(r); i--) if (a[i]) r = r ? `${a[i]}/${r}` : String(a[i])
      if (!B.isAbs(r)) r = `${process.cwd()}/${r}`
      const n = norm(r)
      return n.length > 1 && n.endsWith("/") && !/^[a-zA-Z]:\/$/.test(n) ? n.slice(0, -1) : n
    },
    isAbsolute: p => B.isAbs(String(p).replace(/\\/g, "/")),
    dirname: p => {
      p = norm(p)
      const i = p.lastIndexOf("/")
      if (i === -1) return "."
      if (i === 0) return "/"
      if (/^[a-zA-Z]:$/.test(p.slice(0, i))) return p.slice(0, i + 1)
      return p.slice(0, i)
    },
    basename: (p, ext) => {
      let b = String(p).replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop()
      if (ext && b.endsWith(ext) && b !== ext) b = b.slice(0, -ext.length)
      return b
    },
    extname: p => {
      const b = path.basename(p)
      const i = b.lastIndexOf(".")
      return i <= 0 ? "" : b.slice(i)
    },
    relative: (from, to) => {
      const f = path.resolve(from).split("/").filter(Boolean), t = path.resolve(to).split("/").filter(Boolean)
      let i = 0
      while (i < f.length && i < t.length && f[i].toLowerCase() === t[i].toLowerCase()) i++
      return [...Array(f.length - i).fill(".."), ...t.slice(i)].join("/")
    },
    parse: p => {
      const base = path.basename(p), ext = path.extname(p)
      const root = (String(p).match(/^([a-zA-Z]:)?\//) || [""])[0]
      return { root, dir: path.dirname(p), base, ext, name: ext ? base.slice(0, -ext.length) : base }
    },
    format: o => (o.dir ? `${o.dir}/` : o.root || "") + (o.base || (o.name || "") + (o.ext || "")),
    toNamespacedPath: p => p,
  }
  path.posix = path.win32 = path.default = path
  N.path = path

  /** util */
  const inspect = (v, opts = {}) => {
    const depth = opts.depth ?? 2, seen = new WeakSet(), maxStr = opts.maxStringLength ?? 10000
    const ind = n => "  ".repeat(n)
    const f = (v, d) => {
      switch (typeof v) {
        case "string":
          return d ? JSON.stringify(v.length > maxStr ? v.slice(0, maxStr) + "..." : v) : v
        case "function":
          return `[Function: ${v.name || "(anonymous)"}]`
        case "bigint":
          return `${v}n`
        case "symbol":
          return v.toString()
        case "undefined":
          return "undefined"
        case "object":
          break
        default:
          return String(v)
      }
      if (v === null) return "null"
      if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`
      if (v instanceof Date) return v.toISOString()
      if (v instanceof RegExp) return String(v)
      if (Buffer.isBuffer(v)) return `<Buffer ${Array.from(v.subarray(0, 50), i => i.toString(16).padStart(2, "0")).join(" ")}${v.length > 50 ? ` ... ${v.length - 50} more bytes` : ""}>`
      if (seen.has(v)) return "[Circular]"
      if (d > depth) return Array.isArray(v) ? "[Array]" : "[Object]"
      seen.add(v)
      let r
      if (Array.isArray(v)) {
        const items = v.slice(0, 100).map(i => f(i, d + 1))
        if (v.length > 100) items.push(`... ${v.length - 100} more items`)
        r = items.join(", ").length < 72 ? `[ ${items.join(", ")} ]` : `[\n${items.map(i => ind(d + 1) + i).join(",\n")}\n${ind(d)}]`
      } else if (v instanceof Map || v instanceof Set) {
        const items = [...v].slice(0, 100).map(i => (v instanceof Map ? `${f(i[0], d + 1)} => ${f(i[1], d + 1)}` : f(i, d + 1)))
        r = `${v.constructor.name}(${v.size}) { ${items.join(", ")} }`
      } else {
        const keys = Object.keys(v)
        const name = v.constructor && v.constructor !== Object ? `${v.constructor.name} ` : ""
        if (!keys.length) r = `${name}{}`
        else {
          const items = keys.map(k => `${/^[a-zA-Z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${f(v[k], d + 1)}`)
          r = items.join(", ").length < 72 ? `${name}{ ${items.join(", ")} }` : `${name}{\n${items.map(i => ind(d + 1) + i).join(",\n")}\n${ind(d)}}`
        }
      }
      seen.delete(v)
      return r
    }
    return f(v, 0)
  }
  inspect.custom = Symbol.for("nodejs.util.inspect.custom")
  inspect.defaultOptions = {}
  globalThis.__inspect = inspect
  const format = (fmt, ...args) => {
    if (typeof fmt !== "string") return [fmt, ...args].map(i => inspect(i)).join(" ")
    let i = 0
    let s = fmt.replace(/%[sdifjoOc%]/g, m => {
      if (m === "%%") return "%"
      if (i >= args.length) return m
      const a = args[i++]
      switch (m) {
        case "%s": return typeof a === "string" ? a : inspect(a)
        case "%d": case "%i": return String(parseInt(a))
        case "%f": return String(parseFloat(a))
        case "%j": return JSON.stringify(a)
        case "%c": return ""
        default: return inspect(a)
      }
    })
    for (; i < args.length; i++) s += " " + (typeof args[i] === "string" ? args[i] : inspect(args[i]))
    return s
  }
  const promisify = fn => {
    if (fn[promisify.custom]) return fn[promisify.custom]
    return (...args) => new Promise((resolve, reject) => fn(...args, (err, ...r) => (err ? reject(err) : resolve(r.length > 1 ? r : r[0]))))
  }
  promisify.custom = Symbol.for("nodejs.util.promisify.custom")
  const isDeepStrictEqual = (a, b) => {
    if (Object.is(a, b)) return true
    if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
    const ka = Object.keys(a), kb = Object.keys(b)
    return ka.length === kb.length && ka.every(k => isDeepStrictEqual(a[k], b[k]))
  }
  N.util = {
    inspect, format, promisify, isDeepStrictEqual,
    formatWithOptions: (o, ...a) => format(...a),
    callbackify: fn => (...args) => { const cb = args.pop(); fn(...args).then(r => cb(null, r), cb) },
    deprecate: (fn, msg) => { let w = false; return function (...a) { if (!w) { w = true; console.warn(`DeprecationWarning: ${msg}`) } return fn.apply(this, a) } },
    inherits: (c, s) => { Object.setPrototypeOf(c.prototype, s.prototype); Object.setPrototypeOf(c, s) },
    isArray: Array.isArray,
    stripVTControlCharacters: s => String(s).replace(/\x1b\[[0-9;]*m/g, ""),
    styleText: (f, s) => s,
    debuglog: () => () => {},
    TextEncoder, TextDecoder,
    types: {
      isPromise: v => v instanceof Promise, isDate: v => v instanceof Date, isRegExp: v => v instanceof RegExp,
      isNativeError: v => v instanceof Error, isUint8Array: v => v instanceof Uint8Array, isAnyArrayBuffer: v => v instanceof ArrayBuffer,
      isMap: v => v instanceof Map, isSet: v => v instanceof Set, isProxy: () => false, isAsyncFunction: v => v?.constructor?.name === "AsyncFunction",
    },
  }

  /** url */
  const fileURLToPath = u => {
    u = typeof u === "string" ? new URL(u) : u
    if (u.protocol !== "file:") throw new TypeError("The URL must be of scheme file")
    let p = decodeURIComponent(u.pathname)
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1)
    return p
  }
  const pathToFileURL = p => new URL(B.toURL(path.resolve(p)))
  N.url = {
    URL, URLSearchParams, fileURLToPath, pathToFileURL,
    parse: s => { try { const u = new URL(s); return Object.assign({}, { protocol: u.protocol, host: u.host, hostname: u.hostname, port: u.port, pathname: u.pathname, search: u.search, query: u.search.slice(1), hash: u.hash, href: u.href, path: u.pathname + u.search }) } catch { return { href: s, pathname: s, path: s } } },
    format: u => (typeof u === "string" ? u : u instanceof URL ? u.href : `${u.protocol || "http:"}//${u.host || u.hostname || ""}${u.pathname || ""}${u.search || ""}`),
    resolve: (from, to) => new URL(to, new URL(from, "resolve://")).href.replace(/^resolve:\/\//, ""),
  }

  /** os */
  N.os = {
    EOL: process.platform === "win32" ? "\r\n" : "\n",
    platform: () => process.platform,
    type: () => ({ win32: "Windows_NT", linux: "Linux", darwin: "Darwin" })[process.platform] || "Linux",
    arch: () => process.arch,
    release: () => "",
    version: () => "",
    machine: () => "x86_64",
    hostname: () => "bash-yunzai",
    homedir: () => process.env.HOME || process.cwd(),
    tmpdir: () => `${process.cwd()}/temp`,
    endianness: () => "LE",
    uptime: () => Math.floor(performance.now() / 1000),
    loadavg: () => [0, 0, 0],
    totalmem: () => (navigator.deviceMemory || 8) * 1073741824,
    freemem: () => (navigator.deviceMemory || 8) * 536870912,
    availableParallelism: () => navigator.hardwareConcurrency || 1,
    cpus: () => Array.from({ length: navigator.hardwareConcurrency || 1 }, () => ({ model: "CPU", speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } })),
    networkInterfaces: () => ({}),
    userInfo: () => ({ username: "bash", uid: -1, gid: -1, shell: null, homedir: process.cwd() }),
    constants: { signals: {}, errno: {} },
  }

  /** timers */
  N.timers = { setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate }
  N["timers/promises"] = {
    setTimeout: (ms, v) => new Promise(r => setTimeout(r, ms, v)),
    setImmediate: v => new Promise(r => setTimeout(r, 0, v)),
    setInterval: async function* (ms, v) { while (true) { await new Promise(r => setTimeout(r, ms)); yield v } },
    scheduler: { wait: ms => new Promise(r => setTimeout(r, ms)) },
  }

  /** assert */
  const AssertionError = class extends Error { name = "AssertionError" }
  const assert = (v, msg) => { if (!v) throw new AssertionError(msg || "Assertion failed") }
  Object.assign(assert, {
    AssertionError, ok: assert,
    equal: (a, b, m) => assert(a == b, m || `${a} == ${b}`),
    notEqual: (a, b, m) => assert(a != b, m),
    strictEqual: (a, b, m) => assert(Object.is(a, b), m || `${inspect(a)} === ${inspect(b)}`),
    notStrictEqual: (a, b, m) => assert(!Object.is(a, b), m),
    deepEqual: (a, b, m) => assert(isDeepStrictEqual(a, b), m),
    deepStrictEqual: (a, b, m) => assert(isDeepStrictEqual(a, b), m),
    notDeepStrictEqual: (a, b, m) => assert(!isDeepStrictEqual(a, b), m),
    throws: (fn, m) => { try { fn() } catch { return } throw new AssertionError(m || "Missing expected exception") },
    rejects: async (p, m) => { try { await (typeof p === "function" ? p() : p) } catch { return } throw new AssertionError(m || "Missing expected rejection") },
    fail: m => { throw new AssertionError(m || "Failed") },
    match: (s, re, m) => assert(re.test(s), m),
  })
  assert.strict = assert
  N.assert = assert

  N.querystring = {
    parse: s => Object.fromEntries(new URLSearchParams(s)),
    stringify: o => new URLSearchParams(Object.entries(o || {}).flatMap(([k, v]) => (Array.isArray(v) ? v.map(i => [k, i]) : [[k, v]]))).toString(),
    escape: encodeURIComponent, unescape: decodeURIComponent,
  }
  N.string_decoder = { StringDecoder: class { constructor(enc) { this.d = new TextDecoder(enc === "utf8" || !enc ? "utf-8" : enc) } write(b) { return this.d.decode(b, { stream: true }) } end(b) { return b ? this.d.decode(b) : this.d.decode() } } }
  N.buffer = { Buffer, Blob, File, atob, btoa, constants: { MAX_LENGTH: 2 ** 31 - 1, MAX_STRING_LENGTH: 2 ** 29 }, kMaxLength: 2 ** 31 - 1, isUtf8: () => true }
  N.process = process
  N.module = { createRequire: () => __require, builtinModules: () => Object.keys(N) }
  N.perf_hooks = { performance, PerformanceObserver: globalThis.PerformanceObserver }
  N.async_hooks = {
    AsyncLocalStorage: class { run(store, fn, ...a) { const o = this.s; this.s = store; try { return fn(...a) } finally { this.s = o } } getStore() { return this.s } enterWith(s) { this.s = s } disable() {} },
    AsyncResource: class { runInAsyncScope(fn, t, ...a) { return fn.apply(t, a) } },
    createHook: () => ({ enable() {}, disable() {} }),
  }
  N.vm = { runInThisContext: code => (0, eval)(code), runInNewContext: (code, ctx = {}) => new Function(...Object.keys(ctx), `return eval(${JSON.stringify(code)})`)(...Object.values(ctx)), Script: class { constructor(c) { this.c = c } runInThisContext() { return (0, eval)(this.c) } } }
  N.v8 = { getHeapStatistics: () => ({ total_heap_size: 0, used_heap_size: 0, heap_size_limit: 0 }), serialize: v => Buffer.from(JSON.stringify(v)), deserialize: b => JSON.parse(String(b)) }
  N.tty = { isatty: () => false, WriteStream: class {}, ReadStream: class {} }
  N.constants = {}
})()
