/**
 * 生成 import map：
 * 1. Node 内置模块 → data: 包装模块，导出 __node 里的对象
 * 2. runtime/npm/*.js 里的同名替身（文件名 @a__b 表示 @a/b）
 * 3. node_modules 里的真实包：ESM 直接映射，CJS 包一层 __require
 * 4. 根目录与插件 package.json 的 imports（#miao 等）和插件自己的依赖（scopes）
 */
;(() => {
  const B = __bridge
  const fs = __node.fs
  const path = __node.path
  const imports = {}
  const scopes = {}
  const ID = /^[A-Za-z_$][\w$]*$/
  const RESERVED = new Set(["default", "break", "case", "catch", "class", "const", "continue", "debugger", "delete", "do", "else", "export", "extends", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "return", "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while", "with", "yield", "let", "static", "enum", "await", "implements", "package", "protected", "interface", "private", "public", "null", "true", "false"])
  const dataURL = src => `data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`
  const names = keys => [...new Set(keys)].filter(k => ID.test(k) && !RESERVED.has(k))
  const readJSON = f => {
    try {
      return JSON.parse(B.readText(f))
    } catch {
      return null
    }
  }

  /** 1. 内置模块 */
  for (const [name, mod] of Object.entries(__node)) {
    const keys = names(Object.keys(mod).concat(typeof mod === "function" ? Object.getOwnPropertyNames(mod) : []))
    const src = `const m = __node[${JSON.stringify(name)}];export default m;export const {${keys.join(",")}} = m;`
    imports[name] = imports[`node:${name}`] = dataURL(src)
  }

  /** 2. 替身 */
  const SHIM_DIR = `${B.ROOT}/runtime/npm`
  const shims = new Set()
  for (const f of fs.readdirSync(SHIM_DIR))
    if (f.endsWith(".js")) {
      const name = f.slice(0, -3).replace("__", "/")
      shims.add(name)
      imports[name] = B.toURL(`${SHIM_DIR}/${f}`)
    }

  /** ESM 入口条件 */
  const cond = v => {
    if (typeof v === "string") return { file: v, esm: null }
    if (Array.isArray(v)) for (const i of v) { const r = cond(i); if (r) return r }
    if (v && typeof v === "object") {
      for (const k of ["browser", "import", "module"]) if (k in v) { const r = cond(v[k]); if (r) return { file: r.file, esm: r.esm ?? true } }
      if ("default" in v) return cond(v.default)
    }
    return null
  }
  const isESM = (file, hint) => {
    if (hint !== null && hint !== undefined) return hint
    if (file.endsWith(".mjs")) return true
    if (file.endsWith(".cjs")) return false
    for (let d = path.dirname(file); ; d = path.dirname(d)) {
      const pkg = readJSON(`${d}/package.json`)
      if (pkg) return pkg.type === "module"
      if (path.dirname(d) === d) return false
    }
  }
  /** CJS 包：用 __require 加载，猜一下具名导出（含 TS 编译出的 __exportStar(require("./x"))） */
  const cjsKeys = (file, seen = new Set()) => {
    if (seen.has(file) || seen.size > 50) return []
    seen.add(file)
    let src
    try {
      src = B.readText(file)
    } catch {
      return []
    }
    const keys = [...src.matchAll(/(?:^|[^.\w$])(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1])
    keys.push(...[...src.matchAll(/Object\.defineProperty\(\s*(?:module\.)?exports\s*,\s*["']([A-Za-z_$][\w$]*)["']/g)].map(m => m[1]))
    for (const m of src.matchAll(/__exportStar\(\s*require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g))
      try {
        keys.push(...cjsKeys(__require.resolve(m[1], path.dirname(file)), seen))
      } catch {}
    return keys
  }
  const cjsWrap = file => {
    const keys = names(cjsKeys(file))
    return dataURL(`const m = __require(${JSON.stringify(file)});export default m;${keys.length ? `export const {${keys.join(",")}} = m;` : ""}`)
  }
  const withExt = f => (fs.existsSync(f) ? f : fs.existsSync(`${f}.js`) ? `${f}.js` : `${f}/index.js`)

  const realDir = d => {
    try {
      return fs.realpathSync(d)
    } catch {
      return d
    }
  }
  /** 按 Node 规则从 from 往上找 node_modules/<name>，返回真实路径 */
  const findDep = (name, from) => {
    for (let d = from; ; d = path.dirname(d)) {
      if (!d.endsWith("/node_modules")) {
        const p = `${d}/node_modules/${name}`
        if (fs.existsSync(`${p}/package.json`)) return realDir(p)
      }
      if (path.dirname(d) === d) return null
    }
  }
  /**
   * .mjs 入口相对导入的 CJS 文件（如 sequelize 的 lib/index.mjs → ./index.js）：
   * 浏览器会把它当 ESM 解析失败，用完整 URL 作为键映射到 CJS 包装
   */
  const fixCjsImports = file => {
    let src
    try {
      src = B.readText(file)
    } catch {
      return
    }
    for (const m of src.matchAll(/\b(?:import|export)\b[^'"]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const t = path.resolve(path.dirname(file), m[1] || m[2])
      if (/\.(js|cjs)$/.test(t) && !isESM(t) && fs.existsSync(t)) imports[B.toURL(t)] = cjsWrap(t)
    }
  }

  /** 3. 把一个包的入口与 exports 子路径写进 target，返回是否有 ESM 入口 */
  const mapPkg = (name, dir, target) => {
    const pkg = readJSON(`${dir}/package.json`)
    if (!pkg) return false
    let esm = false
    const exp = pkg.exports
    const entries = {}
    if (exp && typeof exp === "object" && Object.keys(exp).some(k => k.startsWith("."))) {
      for (const [k, v] of Object.entries(exp)) if (k.startsWith(".") && !k.includes("*")) entries[k] = v
    } else if (exp) entries["."] = exp
    if (!entries["."]) {
      // 不用 module / browser 字段：那是给打包工具的，常省略扩展名（css-what），Node 也不认
      entries["."] = pkg.main || "index.js"
    }
    for (const [k, v] of Object.entries(entries)) {
      const r = cond(v)
      if (!r) continue
      const file = withExt(path.join(dir, r.file))
      const key = k === "." ? name : `${name}/${k.slice(2)}`
      if (key.endsWith(".json")) continue
      try {
        /** "import" 条件只说明想当 ESM 用，文件本身还要看扩展名和 type */
        if (isESM(file, file.endsWith(".mjs") || file.endsWith(".cjs") ? null : r.esm)) {
          target[key] = B.toURL(file)
          esm = true
          fixCjsImports(file)
        } else target[key] = cjsWrap(__require.resolve(file))
      } catch {}
    }
    target[`${name}/`] ??= B.toURL(`${dir}/`)
    return esm
  }

  /**
   * ESM 包里的裸导入要靠 scope 解析：以包的真实路径为键，递归映射它的依赖
   * CJS 包不用管，__require 会按真实路径往上找
   */
  const scoped = new Set()
  const mapDeps = dir => {
    const key = B.toURL(`${dir}/`)
    if (scoped.has(key)) return
    scoped.add(key)
    const pkg = readJSON(`${dir}/package.json`)
    const scope = {}
    for (const name of Object.keys({ ...pkg?.dependencies, ...pkg?.optionalDependencies, ...pkg?.peerDependencies })) {
      if (shims.has(name)) continue
      const d = findDep(name, dir)
      if (d && mapPkg(name, d, scope)) mapDeps(d)
    }
    if (Object.keys(scope).length) scopes[key] = { ...scopes[key], ...scope }
  }
  /** 映射一个依赖到 target：用真实路径，是 ESM 就继续映射它的依赖 */
  const mapDep = (name, dir, target) => {
    dir = realDir(dir)
    if (mapPkg(name, dir, target)) mapDeps(dir)
  }

  /** 依赖查找目录：bash-yunzai 自己的 node_modules，以及上级 Yunzai 的 */
  const NM = [`${B.ROOT}/node_modules`, `${path.dirname(B.ROOT)}/node_modules`].filter(d => fs.existsSync(d))
  globalThis.__nodeModules = NM
  const pkgDirs = nm => {
    const out = []
    for (const i of fs.readdirSync(nm)) {
      if (i.startsWith(".")) continue
      if (i.startsWith("@")) for (const j of fs.readdirSync(`${nm}/${i}`)) out.push([`${i}/${j}`, `${nm}/${i}/${j}`])
      else out.push([i, `${nm}/${i}`])
    }
    return out
  }
  for (const nm of [...NM].reverse())
    for (const [name, dir] of pkgDirs(nm)) if (!shims.has(name)) mapDep(name, dir, imports)

  /** 4. package.json 的 imports */
  const mapImports = (pkgDir, target) => {
    const pkg = readJSON(`${pkgDir}/package.json`)
    for (const [k, v] of Object.entries(pkg?.imports || {})) {
      const r = cond(v)
      if (!r) continue
      if (k.endsWith("/*") && r.file.endsWith("/*")) target[k.slice(0, -1)] = B.toURL(path.join(pkgDir, r.file.slice(0, -1)) + "/")
      else if (!k.includes("*")) target[k] = B.toURL(path.join(pkgDir, r.file))
    }
    return pkg
  }
  mapImports(B.ROOT, imports)
  const PLUGINS = `${B.ROOT}/plugins`
  for (const p of fs.existsSync(PLUGINS) ? fs.readdirSync(PLUGINS) : []) {
    const dir = `${PLUGINS}/${p}`
    if (!fs.statSync(dir).isDirectory()) continue
    const scope = {}
    const pkg = mapImports(dir, scope)
    /** 插件声明的依赖：插件自己的 node_modules 优先，找不到再往上 */
    for (const name of Object.keys({ ...pkg?.dependencies, ...pkg?.optionalDependencies })) {
      if (shims.has(name)) continue
      const d = findDep(name, dir)
      if (d) mapDep(name, d, scope)
      else __yzLog("warn", `插件 ${p} 缺少依赖 ${name}，请在 bash-yunzai 目录 pnpm i`)
    }
    if (Object.keys(scope).length) scopes[B.toURL(`${dir}/`)] = { ...scopes[B.toURL(`${dir}/`)], ...scope }
  }

  const map = { imports, scopes }
  globalThis.__importMap = map
  /** 排查用：写到 temp/importmap.json */
  B.send("fs.write", "-", [`${B.ROOT}/temp/importmap.json`, JSON.stringify(map, null, 1)])
  const s = document.createElement("script")
  s.type = "importmap"
  s.textContent = JSON.stringify(map)
  document.currentScript.after(s)
})()
