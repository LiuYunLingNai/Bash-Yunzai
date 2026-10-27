/** level：内存 Map，变更后延迟写到 <location>/data.json */
import fs from "node:fs"

export class Level {
  constructor(location, opts = {}) {
    this.location = location
    this.opts = opts
    this.map = new Map()
    this.status = "closed"
  }
  get file() {
    return `${this.location}/data.json`
  }
  async open() {
    try {
      this.map = new Map(JSON.parse(fs.readFileSync(this.file, "utf8")))
    } catch {}
    this.status = "open"
  }
  async close() {
    await this.flush()
    this.status = "closed"
  }
  save() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 2000)
  }
  async flush() {
    clearTimeout(this.timer)
    await fs.promises.mkdir(this.location, { recursive: true })
    await fs.promises.writeFile(this.file, JSON.stringify([...this.map]))
  }
  async get(k) {
    if (!this.map.has(k)) throw Object.assign(Error("NotFound"), { code: "LEVEL_NOT_FOUND", notFound: true })
    return this.map.get(k)
  }
  async getMany(ks) {
    return ks.map(k => this.map.get(k))
  }
  async put(k, v) {
    this.map.set(k, v)
    this.save()
  }
  async del(k) {
    this.map.delete(k)
    this.save()
  }
  async batch(ops = []) {
    for (const o of ops) o.type === "del" ? this.map.delete(o.key) : this.map.set(o.key, o.value)
    this.save()
  }
  async clear() {
    this.map.clear()
    this.save()
  }
  async *iterator() {
    for (const i of [...this.map].sort((a, b) => (a[0] < b[0] ? -1 : 1))) yield i
  }
  async *keys() {
    for await (const [k] of this.iterator()) yield k
  }
  async *values() {
    for await (const [, v] of this.iterator()) yield v
  }
  sublevel(name) {
    return new Level(`${this.location}/${name}`, this.opts)
  }
}
export default { Level }
