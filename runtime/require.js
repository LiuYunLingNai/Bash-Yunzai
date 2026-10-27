/** 同步 CommonJS 加载器：内置模块取 __node，文件用同步 XHR 读出后包一层函数执行 */
;(() => {
  const B = __bridge
  const path = __node.path
  const fs = __node.fs
  const cache = Object.create(null)

  const isFile = p => fs.statSync(p, { throwIfNoEntry: false })?.isFile()
  const isDir = p => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory()
  const pkgOf = dir => {
    try {
      return JSON.parse(B.readText(`${dir}/package.json`))
    } catch {
      return null
    }
  }
  /** exports 条件解析：CJS 优先 require / node / default */
  const cond = v => {
    if (typeof v === "string") return v
    if (Array.isArray(v)) for (const i of v) { const r = cond(i); if (r) return r }
    if (v && typeof v === "object") for (const k of ["require", "node", "default"]) if (k in v) { const r = cond(v[k]); if (r) return r }
    return null
  }
  const asFile = p => {
    for (const ext of ["", ".js", ".cjs", ".json"]) if (isFile(p + ext)) return p + ext
    return null
  }
  const asDir = p => {
    const pkg = pkgOf(p)
    if (pkg) {
      const exp = pkg.exports && cond(typeof pkg.exports === "object" && "." in pkg.exports ? pkg.exports["."] : pkg.exports)
      for (const main of [exp, pkg.main].filter(Boolean)) {
        const r = asFile(path.join(p, main)) || (isDir(path.join(p, main)) && asIndex(path.join(p, main)))
        if (r) return r
      }
    }
    return asIndex(p)
  }
  const asIndex = p => asFile(`${p}/index`)
  /** 包名 + 子路径，按 exports 映射 */
  const fromPkg = (dir, sub) => {
    if (!sub) return asDir(dir)
    const pkg = pkgOf(dir)
    if (pkg?.exports && typeof pkg.exports === "object") {
      const t = cond(pkg.exports[`./${sub}`])
      if (t) return asFile(path.join(dir, t))
    }
    const p = path.join(dir, sub)
    return asFile(p) || (isDir(p) && asDir(p))
  }

  const resolve = (id, from = B.ROOT) => {
    id = String(id)
    if (id.startsWith("node:") || id in __node) return id.replace(/^node:/, "")
    if (id.startsWith("file:")) id = __node.url.fileURLToPath(id)
    if (id.startsWith("./") || id.startsWith("../") || B.isAbs(id)) {
      const p = path.resolve(from, id)
      const r = asFile(p) || (isDir(p) && asDir(p))
      if (r) return r
    } else {
      const parts = id.split("/")
      const name = id.startsWith("@") ? parts.splice(0, 2).join("/") : parts.shift()
      const sub = parts.join("/")
      for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
        if (!dir.endsWith("/node_modules")) {
          let base = `${dir}/node_modules/${name}`
          if (isDir(base)) {
            /** 和 Node 一样用真实路径：pnpm 的包是链接，依赖在真实路径的兄弟目录里 */
            try {
              base = fs.realpathSync(base)
            } catch {}
            const r = fromPkg(base, sub)
            if (r) return r
          }
        }
        if (path.dirname(dir) === dir) break
      }
    }
    throw Object.assign(Error(`Cannot find module '${id}' from '${from}'`), { code: "MODULE_NOT_FOUND" })
  }

  const load = file => {
    if (file in __node) return __node[file]
    if (cache[file]) return cache[file].exports
    const module = { id: file, filename: file, loaded: false, exports: {}, children: [], paths: [] }
    cache[file] = module
    const src = B.readText(file)
    if (file.endsWith(".json")) {
      module.exports = JSON.parse(src)
    } else {
      const dir = path.dirname(file)
      const req = id => load(resolve(id, dir))
      req.resolve = id => resolve(id, dir)
      req.cache = cache
      try {
        new Function("exports", "require", "module", "__filename", "__dirname", `${src}\n//# sourceURL=${B.toURL(file)}`)(module.exports, req, module, file, dir)
      } catch (err) {
        delete cache[file]
        throw err
      }
    }
    module.loaded = true
    return module.exports
  }

  const require = (id, from) => load(resolve(id, from))
  require.resolve = resolve
  require.cache = cache
  globalThis.__require = require
})()
