/**
 * sequelize：sqlite3 是原生模块，浏览器里跑不了。这里用 JSON 文件实现常用的 Model 接口，
 * 每张表存成 <storage 所在目录>/json/<表名>.json。只支持简单 where（等值 / null / Op.in 等）
 * 和 genshin 用到的两条 delete 语句；已有的 sqlite 数据库不会被读取
 */
import fs from "node:fs"
import path from "node:path"

const type = n => Object.assign(() => ({ key: n }), { key: n, toString: () => n })
export const DataTypes = Object.fromEntries(
  ["STRING", "CHAR", "TEXT", "INTEGER", "BIGINT", "FLOAT", "REAL", "DOUBLE", "DECIMAL", "BOOLEAN", "DATE", "DATEONLY", "TIME", "NOW", "UUID", "UUIDV1", "UUIDV4", "JSON", "JSONB", "BLOB", "ENUM", "ARRAY", "VIRTUAL"].map(n => [n, type(n)]),
)
export const Op = Object.fromEntries(["eq", "ne", "gt", "gte", "lt", "lte", "in", "notIn", "like", "notLike", "is", "not", "or", "and", "between", "notBetween", "startsWith", "endsWith", "substring"].map(k => [k, Symbol.for(`sequelize.op.${k}`)]))
export const QueryTypes = { SELECT: "SELECT", DELETE: "DELETE", UPDATE: "UPDATE", INSERT: "INSERT", RAW: "RAW" }

const likeRe = p => new RegExp(`^${String(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i")
const cmp = (v, c) => {
  if (c === null) return v == null
  if (typeof c !== "object" || c instanceof Date) return v == c
  for (const s of Object.getOwnPropertySymbols(c)) {
    const x = c[s]
    const ok = {
      [Op.eq]: () => (x === null ? v == null : v == x),
      [Op.ne]: () => (x === null ? v != null : v != x),
      [Op.is]: () => (x === null ? v == null : v === x),
      [Op.not]: () => (x === null ? v != null : v !== x),
      [Op.gt]: () => v > x,
      [Op.gte]: () => v >= x,
      [Op.lt]: () => v < x,
      [Op.lte]: () => v <= x,
      [Op.in]: () => x.some(i => i == v),
      [Op.notIn]: () => !x.some(i => i == v),
      [Op.like]: () => likeRe(x).test(v ?? ""),
      [Op.notLike]: () => !likeRe(x).test(v ?? ""),
      [Op.startsWith]: () => String(v ?? "").startsWith(x),
      [Op.endsWith]: () => String(v ?? "").endsWith(x),
      [Op.substring]: () => String(v ?? "").includes(x),
      [Op.between]: () => v >= x[0] && v <= x[1],
      [Op.notBetween]: () => v < x[0] || v > x[1],
    }[s]
    if (ok && !ok()) return false
  }
  return true
}
const match = (row, where) => {
  if (!where) return true
  for (const [k, c] of Object.entries(where)) if (!cmp(row[k], c)) return false
  if (where[Op.or] && !where[Op.or].some(w => match(row, w))) return false
  if (where[Op.and] && !where[Op.and].every(w => match(row, w))) return false
  return true
}

/** 极简 SQL 条件：col is [not] null / col = 'x' / col != 'x'，and / or / 括号 */
const sqlWhere = sql => {
  const tok = sql.match(/\(|\)|'(?:[^']|'')*'|!=|<>|=|[A-Za-z_][\w.]*|\d+/g) || []
  let i = 0
  const lit = t => (t?.startsWith("'") ? t.slice(1, -1).replace(/''/g, "'") : t === "null" || t === "NULL" ? null : Number(t))
  const atom = () => {
    if (tok[i] === "(") {
      i++
      const f = or()
      i++
      return f
    }
    const col = tok[i++]
    if (/^is$/i.test(tok[i])) {
      i++
      const not = /^not$/i.test(tok[i]) && ++i
      i++
      return r => (not ? r[col] != null : r[col] == null)
    }
    const op = tok[i++], v = lit(tok[i++])
    return op === "=" ? r => r[col] === v : r => r[col] !== v
  }
  const and = () => {
    let f = atom()
    while (/^and$/i.test(tok[i])) {
      i++
      const a = f, b = atom()
      f = r => a(r) && b(r)
    }
    return f
  }
  const or = () => {
    let f = and()
    while (/^or$/i.test(tok[i])) {
      i++
      const a = f, b = and()
      f = r => a(r) || b(r)
    }
    return f
  }
  return or()
}

export class Sequelize {
  constructor(opts = {}, ...rest) {
    if (typeof opts === "string") opts = rest[2] || rest[0] || {}
    this.options = opts
    this.dir = path.join(path.dirname(opts.storage || "data/db/data.db"), "json")
    this.models = {}
  }
  async authenticate() {}
  async sync() {
    for (const m of Object.values(this.models)) await m.sync()
  }
  async close() {
    for (const m of Object.values(this.models)) await m._flush()
  }
  define(name, attrs, opts = {}) {
    const M = { [name]: class extends Model {} }[name]
    return M.init(attrs, { ...opts, sequelize: this, modelName: name })
  }
  model(name) {
    return this.models[name]
  }
  async transaction(fn) {
    const t = { commit: async () => {}, rollback: async () => {} }
    return fn ? fn(t) : t
  }
  getDialect() {
    return "json"
  }
  /** 只认 delete from <表> where ...；其余返回空 */
  async query(sql) {
    const m = /^\s*delete\s+from\s+["`]?(\w+)["`]?\s*(?:where\s+(.+))?$/is.exec(String(sql))
    if (!m) return [[], 0]
    const model = Object.values(this.models).find(i => i.tableName === m[1])
    if (!model) return [[], 0]
    const rows = model._rows()
    const f = m[2] ? sqlWhere(m[2]) : () => true
    const keep = rows.filter(r => !f(r))
    const n = rows.length - keep.length
    rows.splice(0, rows.length, ...keep)
    if (n) model._save()
    return [[], n]
  }
  static DataTypes = DataTypes
  static Op = Op
  static QueryTypes = QueryTypes
}

const NOW = DataTypes.NOW
export class Model {
  static init(attrs, opts = {}) {
    this.rawAttributes = {}
    for (const [k, v] of Object.entries(attrs)) this.rawAttributes[k] = typeof v === "object" && v.type ? v : { type: v }
    this.sequelize = opts.sequelize
    this.tableName = opts.tableName || `${opts.modelName || this.name}s`
    this.options = { timestamps: true, ...opts }
    this.pk = Object.keys(this.rawAttributes).find(k => this.rawAttributes[k].primaryKey)
    if (!this.pk) {
      this.pk = "id"
      this.rawAttributes.id = { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }
    }
    if (this.options.timestamps)
      for (const k of ["createdAt", "updatedAt"]) this.rawAttributes[k] ??= { type: DataTypes.DATE }
    for (const [k, a] of Object.entries(this.rawAttributes))
      Object.defineProperty(this.prototype, k, {
        configurable: true,
        get() {
          return a.get ? a.get.call(this) : this.getDataValue(k)
        },
        set(v) {
          a.set ? a.set.call(this, v) : this.setDataValue(k, v)
        },
      })
    if (this.sequelize) this.sequelize.models[this.name] = this
    return this
  }
  static get _file() {
    return path.join(this.sequelize?.dir || "data/db/json", `${this.tableName}.json`)
  }
  static _rows() {
    if (!Object.hasOwn(this, "_data")) {
      try {
        this._data = JSON.parse(fs.readFileSync(this._file, "utf8"))
      } catch {
        this._data = []
      }
    }
    return this._data
  }
  static _save() {
    clearTimeout(this._timer)
    this._timer = setTimeout(() => this._flush(), 500)
  }
  static async _flush() {
    clearTimeout(this._timer)
    if (!Object.hasOwn(this, "_data")) return
    await fs.promises.mkdir(path.dirname(this._file), { recursive: true })
    await fs.promises.writeFile(this._file, JSON.stringify(this._data))
  }
  static async sync() {
    this._rows()
    return this
  }
  static _wrap(row) {
    const m = new this()
    m.dataValues = { ...row }
    m.isNewRecord = false
    m._changed.clear()
    return m
  }
  static _query(o = {}) {
    let rows = this._rows().filter(r => match(r, o.where))
    for (const [k, d] of [...(o.order || [])].reverse())
      rows = [...rows].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (/desc/i.test(d) ? -1 : 1))
    if (o.offset) rows = rows.slice(o.offset)
    if (o.limit) rows = rows.slice(0, o.limit)
    return rows
  }
  static build(values = {}) {
    return new this(values)
  }
  static async create(values = {}) {
    return this.build(values).save()
  }
  static async bulkCreate(list = []) {
    return Promise.all(list.map(v => this.create(v)))
  }
  static async findByPk(pk) {
    if (pk == null) return null
    const r = this._rows().find(r => r[this.pk] == pk)
    return r ? this._wrap(r) : null
  }
  static async findOne(o = {}) {
    const r = this._query({ ...o, limit: 1 })[0]
    return r ? this._wrap(r) : null
  }
  static async findAll(o = {}) {
    return this._query(o).map(r => (o.raw ? { ...r } : this._wrap(r)))
  }
  static async findAndCountAll(o = {}) {
    return { count: this._query({ where: o.where }).length, rows: await this.findAll(o) }
  }
  static async findOrCreate(o = {}) {
    const m = await this.findOne(o)
    if (m) return [m, false]
    return [await this.create({ ...o.where, ...o.defaults }), true]
  }
  static async count(o = {}) {
    return this._query({ where: o.where }).length
  }
  static async destroy(o = {}) {
    const rows = this._rows()
    const keep = o.truncate ? [] : rows.filter(r => !match(r, o.where))
    const n = rows.length - keep.length
    rows.splice(0, rows.length, ...keep)
    if (n) this._save()
    return n
  }
  static async update(values, o = {}) {
    const list = this._query({ where: o.where })
    for (const r of list) {
      const m = this._wrap(r)
      m.set(values)
      await m.save()
    }
    return [list.length]
  }
  static async upsert(values) {
    const m = await this.findByPk(values[this.pk])
    if (m) return [await m.update(values), false]
    return [await this.create(values), true]
  }
  static async max(k) {
    return Math.max(...this._rows().map(r => r[k]).filter(v => v != null))
  }

  constructor(values = {}) {
    this.dataValues = {}
    this._changed = new Set()
    this.isNewRecord = true
    const attrs = this.constructor.rawAttributes || {}
    for (const [k, a] of Object.entries(attrs))
      if (a.defaultValue !== undefined) this.dataValues[k] = a.defaultValue === NOW ? new Date().toISOString() : typeof a.defaultValue === "function" ? a.defaultValue() : a.defaultValue
    this.set(values)
  }
  getDataValue(k) {
    return this.dataValues[k]
  }
  setDataValue(k, v) {
    if (this.dataValues[k] !== v) this._changed.add(k)
    this.dataValues[k] = v
  }
  get(k, o) {
    if (typeof k === "string") return this[k]
    if (k?.plain || o?.plain || k === undefined) {
      const out = {}
      for (const i of Object.keys(this.constructor.rawAttributes || this.dataValues)) out[i] = this[i]
      return out
    }
  }
  set(k, v) {
    if (typeof k === "object" && k) {
      for (const [a, b] of Object.entries(k)) this.set(a, b)
      return this
    }
    if (this.constructor.rawAttributes?.[k]) this[k] = v
    else this.setDataValue(k, v)
    return this
  }
  changed(k) {
    return k ? this._changed.has(k) : this._changed.size ? [...this._changed] : false
  }
  toJSON() {
    return { ...this.dataValues }
  }
  async save() {
    const M = this.constructor
    const rows = M._rows()
    const now = new Date().toISOString()
    if (M.options?.timestamps) {
      this.dataValues.updatedAt = now
      this.dataValues.createdAt ??= now
    }
    if (this.dataValues[M.pk] == null && M.rawAttributes[M.pk]?.autoIncrement !== false)
      this.dataValues[M.pk] = rows.reduce((n, r) => Math.max(n, Number(r[M.pk]) || 0), 0) + 1
    const i = rows.findIndex(r => r[M.pk] == this.dataValues[M.pk])
    if (i === -1) rows.push({ ...this.dataValues })
    else rows[i] = { ...this.dataValues }
    this.isNewRecord = false
    this._changed.clear()
    M._save()
    return this
  }
  async update(values) {
    this.set(values)
    return this.save()
  }
  async destroy() {
    const M = this.constructor
    const rows = M._rows()
    const i = rows.findIndex(r => r[M.pk] == this.dataValues[M.pk])
    if (i !== -1) {
      rows.splice(i, 1)
      M._save()
    }
  }
  async reload() {
    const r = this.constructor._rows().find(r => r[this.constructor.pk] == this.dataValues[this.constructor.pk])
    if (r) this.dataValues = { ...r }
    return this
  }
  async increment(k, o = {}) {
    for (const i of Array.isArray(k) ? k : [k]) this.setDataValue(i, (Number(this.getDataValue(i)) || 0) + (o.by ?? 1))
    return this.save()
  }
}

export default Object.assign(Sequelize, { Sequelize, Model, DataTypes, Op, QueryTypes })
