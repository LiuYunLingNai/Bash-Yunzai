/** log4js：只实现 getLogger / configure，输出交给 bash */
const LEVELS = ["all", "trace", "debug", "info", "warn", "error", "fatal", "mark", "off"]
const COLOR = { trace: 34, debug: 36, info: 32, warn: 33, error: 31, fatal: 35, mark: 90 }
let cfg = { categories: { default: { level: "info" } } }

const pad = (n, l = 2) => String(n).padStart(l, "0")
const stamp = () => {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}
const fmt = a => (typeof a === "string" ? a : globalThis.__inspect ? __inspect(a) : String(a))

class Logger {
  constructor(category) {
    this.category = category
  }
  get level() {
    return (cfg.categories[this.category] || cfg.categories.default)?.level || "info"
  }
  set level(v) {
    ;(cfg.categories[this.category] ??= {}).level = v
  }
  isLevelEnabled(lv) {
    return LEVELS.indexOf(String(lv).toLowerCase()) >= LEVELS.indexOf(String(this.level).toLowerCase())
  }
  log(lv, ...args) {
    if (!this.isLevelEnabled(lv)) return
    const tag = lv.toUpperCase().slice(0, 4).padEnd(4)
    __yzLog(lv, `\x1b[${COLOR[lv] || 0}m[${stamp()}][${tag}]\x1b[0m${args.map(fmt).join(" ")}`)
  }
}
for (const lv of ["trace", "debug", "info", "warn", "error", "fatal", "mark"]) {
  Logger.prototype[lv] = function (...args) {
    this.log(lv, ...args)
  }
  Logger.prototype[`is${lv[0].toUpperCase()}${lv.slice(1)}Enabled`] = function () {
    return this.isLevelEnabled(lv)
  }
}

const loggers = {}
export const getLogger = (category = "default") => (loggers[category] ??= new Logger(category))
export const configure = c => {
  cfg = { ...c, categories: { default: { level: "info" }, ...c?.categories } }
  return log4js
}
export const shutdown = cb => cb?.()
export const levels = Object.fromEntries(LEVELS.map((l, i) => [l.toUpperCase(), { levelStr: l.toUpperCase(), level: i }]))
const log4js = { getLogger, configure, shutdown, levels }
export default log4js
