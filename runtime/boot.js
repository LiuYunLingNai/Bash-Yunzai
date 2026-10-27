/** bash-yunzai 运行时引导：全局对象、与 bash 的桥 */
;(() => {
  const q = new URLSearchParams(location.search)
  const ROOT = q.get("root").replace(/\\/g, "/").replace(/\/$/, "")
  globalThis.global = globalThis

  /** 本地路径 → file:// URL；# ? % 需要转义 */
  const toURL = p =>
    "file://" + (p.startsWith("/") ? "" : "/") + encodeURI(p).replace(/[#?]/g, encodeURIComponent)
  /** 是否绝对路径：/x 或 D:/x */
  const isAbs = p => p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p)

  /** bx 编码：" \ 控制字符 代理对 → \xHH（UTF-8 字节），其余原样，CDP 会转成 \uXXXX */
  const enc = new TextEncoder()
  const hex = Array.from({ length: 256 }, (_, i) => `\\x${i.toString(16).padStart(2, "0")}`)
  const bxText = s =>
    String(s).replace(/[\x00-\x1f\x7f"\\]|[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g, c =>
      c.length === 2 || (c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff)
        ? Array.from(enc.encode(c.length === 2 ? c : "\ufffd"), b => hex[b]).join("")
        : hex[c.charCodeAt(0)],
    )
  /** 二进制：可打印 ASCII（除 " \）原样，其余 \xHH */
  const safe = hex.map((h, i) => (i >= 0x20 && i < 0x7f && i !== 0x22 && i !== 0x5c ? String.fromCharCode(i) : h))
  const bxBytes = bytes => {
    const out = []
    for (let i = 0; i < bytes.length; i += 65536) {
      const a = new Array(Math.min(65536, bytes.length - i))
      for (let j = 0; j < a.length; j++) a[j] = safe[bytes[i + j]]
      out.push(a.join(""))
    }
    return out.join("")
  }
  const bx = v => (typeof v === "string" ? bxText(v) : bxBytes(v))

  let seq = 0
  const waiters = new Map()
  /** 发给 bash，不等待 */
  const send = (op, id, fields) => __bash(`${op} ${id} ${fields.map(bx).join("\n")}`)
  /** 同步调用：阻塞到 bash 完成，返回状态码字符串 */
  const sync = (op, ...fields) => {
    const id = `s${++seq}`
    send(op, id, fields)
    const x = new XMLHttpRequest()
    x.open("GET", `http://bridge.local/wait/${id}`, false)
    x.send()
    return { id, code: x.getResponseHeader("x-ret") }
  }
  /** 异步调用：返回 Promise<{id, code}> */
  const call = (op, ...fields) => {
    const id = `a${++seq}`
    const p = Promise.withResolvers()
    waiters.set(id, p)
    send(op, id, fields)
    return p.promise
  }

  /** 读本地文件（同步），不存在抛错 */
  const readBytes = p => {
    const x = new XMLHttpRequest()
    x.open("GET", toURL(p), false)
    x.overrideMimeType("text/plain; charset=x-user-defined")
    x.send()
    const t = x.responseText
    const b = new Uint8Array(t.length)
    for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i) & 0xff
    return b
  }
  const dec = new TextDecoder()
  const readText = p => dec.decode(readBytes(p))
  /** 读 bash 写的附加输出（stderr 等），不存在返回空 */
  const outText = (id, ext = "") => {
    try {
      return readText(`${ROOT}/temp/bridge/${id}${ext}`)
    } catch {
      return ""
    }
  }

  globalThis.__bridge = { ROOT, toURL, isAbs, bx, send, sync, call, readBytes, readText, outText }

  /** 日志直接发给 bash */
  globalThis.__yzLog = (level, text) => send("log", "-", [level, text])

  /** bash 回调入口 */
  globalThis.__yz = {
    resolve(id, code) {
      const p = waiters.get(id)
      if (!p) return
      waiters.delete(id)
      p.resolve({ id, code })
    },
    renders: new Map(),
    renderDone(id, imgs) {
      const p = waiters.get(id)
      if (!p) return
      waiters.delete(id)
      p.resolve({ id, code: "0", imgs })
    },
    wsOpen() {},
    wsClose() {},
    wsMessage() {},
  }

  /** process */
  const listeners = {}
  globalThis.process = {
    env: { TZ: "Asia/Shanghai", NODE_ENV: "production" },
    argv: ["node", `${ROOT}/app.js`],
    platform: q.get("platform") || "linux",
    arch: q.get("arch") || "x64",
    version: "v22.0.0",
    /** 字段不能空：systeminformation 的 versions() 会为空字段计数，等不到回调就永远不返回 */
    versions: {
      node: "22.0.0",
      v8: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "12.0",
      uv: "1.48.0",
      zlib: "1.3.0",
      openssl: "3.0.13",
      modules: "127",
      chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "",
      bash_yunzai: "1",
    },
    pid: 1,
    title: "bash-yunzai",
    exitCode: 0,
    cwd: () => ROOT,
    chdir() {},
    uptime: () => performance.now() / 1000,
    hrtime: Object.assign(
      (prev = [0, 0]) => {
        const t = performance.now() * 1e6
        let s = Math.floor(t / 1e9) - prev[0],
          n = Math.floor(t % 1e9) - prev[1]
        if (n < 0) (s--, (n += 1e9))
        return [s, n]
      },
      { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) },
    ),
    memoryUsage: () => {
      const m = performance.memory || {}
      return { rss: m.totalJSHeapSize || 0, heapTotal: m.totalJSHeapSize || 0, heapUsed: m.usedJSHeapSize || 0, external: 0, arrayBuffers: 0 }
    },
    cpuUsage: () => ({ user: 0, system: 0 }),
    nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
    emitWarning: (...args) => console.warn(...args),
    on(name, fn) {
      ;(listeners[name] ??= []).push(fn)
      return this
    },
    once(name, fn) {
      return this.on(name, fn)
    },
    off(name, fn) {
      listeners[name] = (listeners[name] || []).filter(i => i !== fn)
      return this
    },
    removeListener(name, fn) {
      return this.off(name, fn)
    },
    removeAllListeners(name) {
      delete listeners[name]
      return this
    },
    listeners: name => listeners[name] || [],
    emit(name, ...args) {
      for (const fn of listeners[name] || []) fn(...args)
      return !!listeners[name]?.length
    },
    exit(code = 0) {
      if (process.exiting) return
      process.exiting = true
      try {
        process.emit("exit", code)
      } catch {}
      send("exit", "-", [String(Number(code) || 0)])
    },
    kill() {},
    /** 原样写到 bash 的终端，不加日志前缀（readline 提示符、spawn 的 inherit 输出） */
    stdout: { isTTY: q.get("tty") === "1", columns: 120, rows: 30, fd: 1, write: (s, e, cb) => (send("out", "-", ["1", typeof s === "string" ? s : s]), (typeof e === "function" ? e : cb)?.(), true), on() { return this }, once() { return this } },
    stderr: { isTTY: q.get("tty") === "1", columns: 120, rows: 30, fd: 2, write: (s, e, cb) => (send("out", "-", ["2", typeof s === "string" ? s : s]), (typeof e === "function" ? e : cb)?.(), true), on() { return this }, once() { return this } },
    stdin: null,
    report: { getReport: () => ({}) },
    release: { name: "node" },
    config: { variables: {} },
    features: {},
    execPath: "node",
    execArgv: [],
  }

  /** 未捕获错误交给 process 监听器（Yunzai 的 init.js 会注册） */
  addEventListener("error", e => {
    if (process.emit("uncaughtException", e.error || e.message)) e.preventDefault()
  })
  addEventListener("unhandledrejection", e => {
    if (process.emit("unhandledRejection", e.reason)) e.preventDefault()
  })

  /** 告诉 bash 页面已就绪，bash 拿到 __yz 后才能回调 */
  send("ready", "-", [])

  globalThis.setImmediate ??= (fn, ...args) => setTimeout(fn, 0, ...args)
  globalThis.clearImmediate ??= id => clearTimeout(id)

  /** console 走 bash 日志，避免 Runtime.consoleAPICalled 刷屏 */
  const fmt = args =>
    args.map(i => (typeof i === "string" ? i : globalThis.__inspect ? __inspect(i) : String(i))).join(" ")
  for (const [k, lv] of Object.entries({ log: "info", info: "info", debug: "debug", warn: "warn", error: "error", trace: "debug" }))
    console[k] = (...args) => __yzLog(lv, `[console.${k}] ${fmt(args)}`)
})()
