/**
 * redis：内存实现 + 定时落盘到 data/redis.json，接口按 node-redis v4（返回字符串）
 * 覆盖 Yunzai 与常见插件用到的 string / hash / list / set / zset / 过期 / multi
 */
import fs from "node:fs"
import { EventEmitter } from "node:events"

const FILE = `${process.cwd()}/data/redis.json`
const str = v => (v == null ? null : Buffer.isBuffer(v) ? v.toString() : String(v))
const now = () => Date.now()
const globRe = p =>
  new RegExp(`^${String(p).replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".").replace(/\[!/g, "[^")}$`)

class Store {
  data = new Map()
  exp = new Map()
  constructor() {
    try {
      const j = JSON.parse(fs.readFileSync(FILE, "utf8"))
      for (const [k, t, v] of j.data || []) {
        if (t && t <= now()) continue
        this.data.set(k, t === undefined ? v : this.revive(v))
        if (t) this.exp.set(k, t)
      }
    } catch {}
  }
  revive(v) {
    if (v && typeof v === "object" && v.$t) {
      if (v.$t === "h") return new Map(v.v)
      if (v.$t === "s") return new Set(v.v)
      if (v.$t === "z") return Object.assign(new Map(v.v), { zset: true })
      if (v.$t === "l") return v.v
    }
    return v
  }
  pack(v) {
    if (v instanceof Map) return { $t: v.zset ? "z" : "h", v: [...v] }
    if (v instanceof Set) return { $t: "s", v: [...v] }
    if (Array.isArray(v)) return { $t: "l", v }
    return v
  }
  alive(k) {
    const t = this.exp.get(k)
    if (t && t <= now()) {
      this.data.delete(k)
      this.exp.delete(k)
    }
    return this.data.has(k)
  }
  get(k) {
    return this.alive(k) ? this.data.get(k) : undefined
  }
  set(k, v) {
    this.data.set(k, v)
    this.dirty()
  }
  del(k) {
    this.exp.delete(k)
    const r = this.data.delete(k)
    if (r) this.dirty()
    return r
  }
  keys() {
    return [...this.data.keys()].filter(k => this.alive(k))
  }
  timer = null
  dirty() {
    if (this.timer) return
    this.timer = setTimeout(() => this.save(), 3000)
  }
  async save() {
    clearTimeout(this.timer)
    this.timer = null
    const data = []
    for (const k of this.keys()) data.push([k, this.exp.get(k) || 0, this.pack(this.data.get(k))])
    const tmp = `${FILE}.tmp`
    await fs.promises.writeFile(tmp, JSON.stringify({ v: 1, data }))
    await fs.promises.rename(tmp, FILE)
  }
}
const store = new Store()

const typed = (k, Cls, create) => {
  let v = store.get(k)
  if (v === undefined) {
    if (!create) return undefined
    v = new Cls()
    if (Cls === Map && create === "z") v.zset = true
    store.set(k, v)
  }
  return v
}
const zsorted = z => [...z].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))

class Client extends EventEmitter {
  isOpen = true
  isReady = true
  async connect() {
    this.emit("connect")
    this.emit("ready")
    return this
  }
  async disconnect() {}
  async quit() {}
  async ping(v) {
    return v ?? "PONG"
  }
  async save() {
    await store.save()
    return "OK"
  }
  async flushAll() {
    store.data.clear()
    store.exp.clear()
    store.dirty()
    return "OK"
  }
  flushDb() {
    return this.flushAll()
  }
  async dbSize() {
    return store.keys().length
  }
  async select() {
    return "OK"
  }
  /** INFO 文本格式与真 redis 一致，按段返回；内存用 JSON 序列化长度估算 */
  async info(section) {
    const keys = store.keys()
    const mem = keys.reduce((n, k) => n + k.length + JSON.stringify(store.pack(store.data.get(k)) ?? "").length, 0)
    const human = n => (n > 1048576 ? `${(n / 1048576).toFixed(2)}M` : `${(n / 1024).toFixed(2)}K`)
    const expires = keys.filter(k => store.exp.has(k)).length
    const sections = {
      Server: { redis_version: "7.0.0-bash-yunzai", redis_mode: "standalone", os: process.platform, process_id: process.pid, uptime_in_seconds: Math.floor(performance.now() / 1000), uptime_in_days: Math.floor(performance.now() / 864e5) },
      Clients: { connected_clients: 1, blocked_clients: 0 },
      Memory: { used_memory: mem, used_memory_human: human(mem), used_memory_peak: mem, used_memory_peak_human: human(mem), maxmemory: 0 },
      Persistence: { loading: 0, rdb_changes_since_last_save: store.timer ? 1 : 0 },
      Stats: { total_connections_received: 1, total_commands_processed: Client.commands, keyspace_hits: 0, keyspace_misses: 0 },
      Keyspace: keys.length ? { db0: `keys=${keys.length},expires=${expires},avg_ttl=0` } : {},
    }
    const pick = section && section !== "all" && section !== "everything" ? Object.keys(sections).filter(i => i.toLowerCase() === String(section).toLowerCase()) : Object.keys(sections)
    return pick.map(s => `# ${s}\r\n${Object.entries(sections[s]).map(([k, v]) => `${k}:${v}`).join("\r\n")}\r\n`).join("\r\n")
  }
  async configGet(name) {
    const all = { maxmemory: "0", "maxmemory-policy": "noeviction", databases: "16", save: "" }
    return Object.fromEntries(Object.entries(all).filter(([k]) => new RegExp(`^${String(name).replace(/\*/g, ".*")}$`).test(k)))
  }
  async configSet() {
    return "OK"
  }

  async get(k) {
    const v = store.get(k)
    return v === undefined ? null : str(v)
  }
  async set(k, v, o = {}) {
    const exists = store.get(k) !== undefined
    if ((o.NX && exists) || (o.XX && !exists)) return null
    const old = o.GET ? await this.get(k) : undefined
    const keep = o.KEEPTTL ? store.exp.get(k) : undefined
    store.set(k, str(v))
    store.exp.delete(k)
    const ttl = o.EX ? o.EX * 1000 : o.PX ? o.PX : o.EXAT ? o.EXAT * 1000 - now() : o.PXAT ? o.PXAT - now() : 0
    if (ttl) store.exp.set(k, now() + ttl)
    else if (keep) store.exp.set(k, keep)
    return o.GET ? old : "OK"
  }
  setEx(k, s, v) {
    return this.set(k, v, { EX: s })
  }
  pSetEx(k, ms, v) {
    return this.set(k, v, { PX: ms })
  }
  async setNX(k, v) {
    return (await this.set(k, v, { NX: true })) === "OK"
  }
  async getDel(k) {
    const v = await this.get(k)
    store.del(k)
    return v
  }
  async getSet(k, v) {
    return this.set(k, v, { GET: true })
  }
  async mGet(ks) {
    return Promise.all(ks.map(k => this.get(k)))
  }
  async mSet(o) {
    for (const [k, v] of Array.isArray(o) ? o : Object.entries(o)) await this.set(k, v)
    return "OK"
  }
  async append(k, v) {
    const s = (store.get(k) ?? "") + str(v)
    store.set(k, s)
    return s.length
  }
  async strLen(k) {
    return (store.get(k) ?? "").length
  }
  async incrBy(k, n) {
    const v = (Number(store.get(k)) || 0) + Number(n)
    store.set(k, String(v))
    return v
  }
  incr(k) {
    return this.incrBy(k, 1)
  }
  decr(k) {
    return this.incrBy(k, -1)
  }
  decrBy(k, n) {
    return this.incrBy(k, -n)
  }
  async incrByFloat(k, n) {
    const v = (Number(store.get(k)) || 0) + Number(n)
    store.set(k, String(v))
    return String(v)
  }

  async del(...ks) {
    return ks.flat().filter(k => store.del(k)).length
  }
  unlink(...ks) {
    return this.del(...ks)
  }
  async exists(...ks) {
    return ks.flat().filter(k => store.get(k) !== undefined).length
  }
  async type(k) {
    const v = store.get(k)
    return v === undefined ? "none" : typeof v === "string" ? "string" : Array.isArray(v) ? "list" : v instanceof Set ? "set" : v.zset ? "zset" : "hash"
  }
  async keys(p = "*") {
    const re = globRe(p)
    return store.keys().filter(k => re.test(k))
  }
  async *scanIterator(o = {}) {
    for (const k of await this.keys(o.MATCH || "*")) yield k
  }
  async scan(cursor, o = {}) {
    return { cursor: 0, keys: await this.keys(o.MATCH || "*") }
  }
  async rename(a, b) {
    if (store.get(a) === undefined) throw Error("ERR no such key")
    store.set(b, store.get(a))
    const t = store.exp.get(a)
    store.del(a)
    if (t) store.exp.set(b, t)
    return "OK"
  }
  async expire(k, s) {
    return this.pExpire(k, s * 1000)
  }
  async pExpire(k, ms) {
    if (store.get(k) === undefined) return false
    store.exp.set(k, now() + Number(ms))
    store.dirty()
    return true
  }
  async expireAt(k, t) {
    return this.pExpire(k, t * 1000 - now())
  }
  async persist(k) {
    return store.exp.delete(k)
  }
  async pTTL(k) {
    if (store.get(k) === undefined) return -2
    const t = store.exp.get(k)
    return t ? t - now() : -1
  }
  async ttl(k) {
    const t = await this.pTTL(k)
    return t < 0 ? t : Math.ceil(t / 1000)
  }

  async hSet(k, f, v) {
    const h = typed(k, Map, true)
    const o = typeof f === "object" ? (f instanceof Map ? [...f] : Object.entries(f)) : [[f, v]]
    let n = 0
    for (const [a, b] of o) {
      if (!h.has(String(a))) n++
      h.set(String(a), str(b))
    }
    store.dirty()
    return n
  }
  hmSet(k, o) {
    return this.hSet(k, o)
  }
  async hSetNX(k, f, v) {
    const h = typed(k, Map, true)
    if (h.has(String(f))) return false
    h.set(String(f), str(v))
    store.dirty()
    return true
  }
  async hGet(k, f) {
    return typed(k, Map)?.get(String(f)) ?? null
  }
  async hmGet(k, fs) {
    const h = typed(k, Map)
    return fs.map(f => h?.get(String(f)) ?? null)
  }
  async hGetAll(k) {
    return Object.fromEntries(typed(k, Map) || [])
  }
  async hDel(k, ...fs) {
    const h = typed(k, Map)
    if (!h) return 0
    const n = fs.flat().filter(f => h.delete(String(f))).length
    if (!h.size) store.del(k)
    else store.dirty()
    return n
  }
  async hExists(k, f) {
    return !!typed(k, Map)?.has(String(f))
  }
  async hKeys(k) {
    return [...(typed(k, Map)?.keys() || [])]
  }
  async hVals(k) {
    return [...(typed(k, Map)?.values() || [])]
  }
  async hLen(k) {
    return typed(k, Map)?.size || 0
  }
  async hIncrBy(k, f, n) {
    const h = typed(k, Map, true)
    const v = (Number(h.get(String(f))) || 0) + Number(n)
    h.set(String(f), String(v))
    store.dirty()
    return v
  }

  async lPush(k, ...v) {
    const l = typed(k, Array, true)
    l.unshift(...v.flat().map(str).reverse())
    store.dirty()
    return l.length
  }
  async rPush(k, ...v) {
    const l = typed(k, Array, true)
    l.push(...v.flat().map(str))
    store.dirty()
    return l.length
  }
  async lPop(k) {
    const l = typed(k, Array)
    const v = l?.shift() ?? null
    if (l && !l.length) store.del(k)
    else store.dirty()
    return v
  }
  async rPop(k) {
    const l = typed(k, Array)
    const v = l?.pop() ?? null
    if (l && !l.length) store.del(k)
    else store.dirty()
    return v
  }
  async lRange(k, a, b) {
    const l = typed(k, Array) || []
    if (b < 0) b = l.length + b
    if (a < 0) a = Math.max(0, l.length + a)
    return l.slice(a, b + 1)
  }
  async lLen(k) {
    return typed(k, Array)?.length || 0
  }
  async lIndex(k, i) {
    return typed(k, Array)?.at(i) ?? null
  }
  async lTrim(k, a, b) {
    const l = typed(k, Array)
    if (!l) return "OK"
    store.set(k, await this.lRange(k, a, b))
    return "OK"
  }
  async lRem(k, n, v) {
    const l = typed(k, Array)
    if (!l) return 0
    let c = 0
    store.set(k, l.filter(i => (i === str(v) && (!n || c < Math.abs(n)) ? (c++, false) : true)))
    return c
  }

  async sAdd(k, ...v) {
    const s = typed(k, Set, true)
    let n = 0
    for (const i of v.flat().map(str)) if (!s.has(i)) (s.add(i), n++)
    store.dirty()
    return n
  }
  async sRem(k, ...v) {
    const s = typed(k, Set)
    if (!s) return 0
    const n = v.flat().filter(i => s.delete(str(i))).length
    if (!s.size) store.del(k)
    else store.dirty()
    return n
  }
  async sMembers(k) {
    return [...(typed(k, Set) || [])]
  }
  async sIsMember(k, v) {
    return !!typed(k, Set)?.has(str(v))
  }
  async sCard(k) {
    return typed(k, Set)?.size || 0
  }

  async zAdd(k, items) {
    const z = typed(k, Map, "z")
    let n = 0
    for (const { score, value } of Array.isArray(items) ? items : [items]) {
      if (!z.has(str(value))) n++
      z.set(str(value), Number(score))
    }
    store.dirty()
    return n
  }
  async zScore(k, v) {
    return typed(k, Map)?.get(str(v)) ?? null
  }
  async zIncrBy(k, n, v) {
    const z = typed(k, Map, "z")
    const s = (z.get(str(v)) || 0) + Number(n)
    z.set(str(v), s)
    store.dirty()
    return s
  }
  async zRem(k, ...v) {
    const z = typed(k, Map)
    if (!z) return 0
    const n = v.flat().filter(i => z.delete(str(i))).length
    store.dirty()
    return n
  }
  async zCard(k) {
    return typed(k, Map)?.size || 0
  }
  async zRange(k, a, b, o = {}) {
    let l = zsorted(typed(k, Map) || [])
    if (o.REV) l.reverse()
    if (o.BY === "SCORE") return l.filter(([, s]) => s >= Number(a) && s <= Number(b)).map(([v]) => v)
    if (b < 0) b = l.length + b
    return l.slice(a, b + 1).map(([v]) => v)
  }
  async zRangeWithScores(k, a, b, o = {}) {
    let l = zsorted(typed(k, Map) || [])
    if (o.REV) l.reverse()
    if (b < 0) b = l.length + b
    return l.slice(a, b + 1).map(([value, score]) => ({ value, score }))
  }
  zRevRange(k, a, b) {
    return this.zRange(k, a, b, { REV: true })
  }
  async zRank(k, v) {
    const i = zsorted(typed(k, Map) || []).findIndex(([m]) => m === str(v))
    return i === -1 ? null : i
  }
  async zRevRank(k, v) {
    const l = zsorted(typed(k, Map) || []).reverse()
    const i = l.findIndex(([m]) => m === str(v))
    return i === -1 ? null : i
  }
  async zCount(k, a, b) {
    return [...(typed(k, Map)?.values() || [])].filter(s => s >= Number(a) && s <= Number(b)).length
  }

  /** multi / pipeline：收集调用，exec 时依次执行 */
  multi() {
    const q = []
    const p = new Proxy(
      {},
      {
        get: (t, k) => {
          if (k === "exec" || k === "execAsPipeline") return () => Promise.all(q.map(([m, a]) => this[m](...a)))
          if (k === "addCommand") return a => (q.push(["sendCommand", [a]]), p)
          return (...a) => (q.push([k, a]), p)
        },
      },
    )
    return p
  }
  pipeline() {
    return this.multi()
  }

  /** 原始命令：方法名大小写不敏感 */
  async sendCommand([cmd, ...args]) {
    const name = Object.getOwnPropertyNames(Client.prototype).find(i => i.toLowerCase() === String(cmd).toLowerCase())
    if (!name) throw Error(`ERR unknown command '${cmd}'`)
    return this[name](...args)
  }
  duplicate() {
    return new Client()
  }
}
/** 小写别名：redis.hgetall 等旧写法 */
for (const k of Object.getOwnPropertyNames(Client.prototype)) {
  const l = k.toLowerCase()
  if (l !== k && !(l in Client.prototype)) Client.prototype[l] = Client.prototype[k]
}

/** 命令计数（INFO 的 total_commands_processed）：包一层所有异步方法 */
Client.commands = 0
for (const k of Object.getOwnPropertyNames(Client.prototype)) {
  const fn = Client.prototype[k]
  if (k === "constructor" || typeof fn !== "function" || fn.constructor.name !== "AsyncFunction") continue
  Client.prototype[k] = function (...a) {
    Client.commands++
    return fn.apply(this, a)
  }
}

export const createClient = () => new Client()
export const createCluster = createClient
export default { createClient, createCluster }
