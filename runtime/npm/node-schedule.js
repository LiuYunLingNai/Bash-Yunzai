/** node-schedule：cron（5 或 6 段，秒在最前）+ Date，到点用 setTimeout 触发 */
const RANGES = [[0, 59], [0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
const NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

const field = (s, [min, max]) => {
  const set = new Set()
  for (let part of s.split(",")) {
    part = part.toLowerCase().replace(/[a-z]{3}/g, m => NAMES[m] ?? m)
    let [r, step] = part.split("/")
    step = Number(step) || 1
    let a, b
    if (r === "*" || r === "?") [a, b] = [min, max]
    else if (r.includes("-")) [a, b] = r.split("-").map(Number)
    else [a, b] = [Number(r), step > 1 ? max : Number(r)]
    if (Number.isNaN(a) || Number.isNaN(b)) throw Error(`无效的 cron 字段：${s}`)
    for (let i = a; i <= b; i += step) set.add(i)
  }
  return { set, any: s === "*" || s === "?" }
}

const parse = expr => {
  const f = String(expr).trim().split(/\s+/)
  if (f.length === 5) f.unshift("0")
  if (f.length !== 6) throw Error(`无效的 cron 表达式：${expr}`)
  const r = f.map((s, i) => field(s, RANGES[i]))
  if (r[5].set.has(7)) r[5].set.add(0)
  return r
}

/** 日与星期：都限定时满足其一即可（标准 cron 语义） */
const dayOk = ([, , , dom, , dow], d) => {
  const a = dom.set.has(d.getDate()), b = dow.set.has(d.getDay())
  if (dom.any && dow.any) return true
  if (dom.any) return b
  if (dow.any) return a
  return a || b
}

/** 从 from 之后找下一个匹配时间：不匹配的天、小时、分钟整段跳过 */
const next = (cron, from) => {
  const d = new Date(Math.floor(from / 1000) * 1000 + 1000)
  const limit = from + 5 * 366 * 864e5
  while (d.getTime() < limit) {
    if (!cron[4].set.has(d.getMonth() + 1) || !dayOk(cron, d)) {
      d.setHours(24, 0, 0, 0)
      continue
    }
    if (!cron[2].set.has(d.getHours())) {
      d.setMinutes(60, 0, 0)
      continue
    }
    if (!cron[1].set.has(d.getMinutes())) {
      d.setSeconds(60, 0)
      continue
    }
    for (let s = d.getSeconds(); s < 60; s++) if (cron[0].set.has(s)) return (d.setSeconds(s, 0), d)
    d.setSeconds(60, 0)
  }
  return null
}

const MAX_DELAY = 2 ** 31 - 1

/** { second, minute, hour, date, month, dayOfWeek } → cron */
const ruleToCron = r => {
  const f = (v, d = "*") => (v == null ? d : Array.isArray(v) ? v.join(",") : typeof v === "object" ? `${v.start}-${v.end}${v.step ? `/${v.step}` : ""}` : String(v))
  return [f(r.second, "0"), f(r.minute), f(r.hour), f(r.date), f(r.month == null ? null : Array.isArray(r.month) ? r.month.map(i => i + 1) : typeof r.month === "number" ? r.month + 1 : r.month), f(r.dayOfWeek)].join(" ")
}

export class Job {
  constructor(name, rule, fn) {
    /** scheduleJob(rule, fn) 与 scheduleJob(name, rule, fn) */
    if (typeof rule === "function" || fn === undefined) [fn, rule, name] = [rule, name, `<Anonymous Job ${++Job.n}>`]
    if (rule && typeof rule === "object" && !(rule instanceof Date) && !rule.rule) rule = ruleToCron(rule)
    this.name = name
    this.fn = fn
    this.rule = rule
    this.pendingInvocations = []
    if (rule instanceof Date || typeof rule === "number") this.at = new Date(rule)
    else this.cron = parse(typeof rule === "object" && rule.rule ? rule.rule : rule)
    this.schedule()
  }
  static n = 0
  nextInvocation() {
    if (this.at) return this.at > Date.now() ? this.at : null
    return next(this.cron, Date.now())
  }
  schedule() {
    const t = this.nextInvocation()
    if (!t) return false
    this.nextAt = t
    const wait = t.getTime() - Date.now()
    this.timer = setTimeout(() => {
      if (wait > MAX_DELAY) return this.schedule()
      try {
        this.fn(new Date())
      } catch (err) {
        logger?.error?.("定时任务错误", err)
      }
      if (!this.at) this.schedule()
    }, Math.min(wait, MAX_DELAY))
    return true
  }
  cancel() {
    clearTimeout(this.timer)
    this.timer = null
    return true
  }
  cancelNext() {
    this.cancel()
    return this.schedule()
  }
  reschedule(rule) {
    this.cancel()
    this.cron = parse(rule)
    return this.schedule()
  }
}

export const scheduleJob = (...a) => {
  try {
    return new Job(...a)
  } catch (err) {
    logger?.error?.("创建定时任务失败", err)
    return null
  }
}
export const cancelJob = job => job?.cancel?.()
export const rescheduleJob = (job, rule) => job?.reschedule?.(rule)
export class RecurrenceRule {}
export const gracefulShutdown = async () => {}
export default { scheduleJob, cancelJob, rescheduleJob, Job, RecurrenceRule, gracefulShutdown }
