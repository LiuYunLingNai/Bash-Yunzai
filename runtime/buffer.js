/** Node Buffer 的最小实现：基于 Uint8Array，覆盖 Yunzai 与常见插件用到的部分 */
;(() => {
  const te = new TextEncoder()
  const td = new TextDecoder()

  const b64enc = u8 => {
    if (u8.toBase64) return u8.toBase64()
    let s = ""
    for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768))
    return btoa(s)
  }
  const b64dec = s => {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "")
    s += "===".slice((s.length + 3) % 4)
    if (Uint8Array.fromBase64) return Uint8Array.fromBase64(s)
    const bin = atob(s)
    const u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    return u8
  }
  const latin1 = u8 => {
    let s = ""
    for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768))
    return s
  }
  const norm = enc => String(enc || "utf8").toLowerCase().replace("-", "")

  class Buffer extends Uint8Array {
    static from(v, enc, len) {
      if (typeof v === "string") return Buffer.fromString(v, enc)
      if (v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== "undefined" && v instanceof SharedArrayBuffer))
        return new Buffer(v, enc || 0, len ?? v.byteLength - (enc || 0))
      if (ArrayBuffer.isView(v)) {
        const b = new Buffer(v.byteLength)
        b.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
        return b
      }
      if (v?.type === "Buffer" && Array.isArray(v.data)) return Buffer.from(v.data)
      if (Array.isArray(v) || v?.length !== undefined) {
        const b = new Buffer(v.length)
        for (let i = 0; i < v.length; i++) b[i] = v[i]
        return b
      }
      throw new TypeError("The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array")
    }
    static fromString(s, enc) {
      let u8
      switch (norm(enc)) {
        case "base64":
        case "base64url":
          u8 = b64dec(s)
          break
        case "hex": {
          const n = s.length >> 1
          u8 = new Uint8Array(n)
          for (let i = 0; i < n; i++) u8[i] = parseInt(s.substr(i * 2, 2), 16)
          break
        }
        case "latin1":
        case "binary":
        case "ascii": {
          u8 = new Uint8Array(s.length)
          for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff
          break
        }
        case "utf16le":
        case "ucs2": {
          u8 = new Uint8Array(s.length * 2)
          for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i)
            u8[i * 2] = c & 0xff
            u8[i * 2 + 1] = c >> 8
          }
          break
        }
        default:
          u8 = te.encode(s)
      }
      return new Buffer(u8.buffer, u8.byteOffset, u8.byteLength)
    }
    static alloc(n, fill = 0, enc) {
      const b = new Buffer(n)
      if (fill) b.fill(fill, 0, n, enc)
      return b
    }
    static allocUnsafe(n) {
      return new Buffer(n)
    }
    static allocUnsafeSlow(n) {
      return new Buffer(n)
    }
    static isBuffer(v) {
      return v instanceof Buffer
    }
    static isEncoding(enc) {
      return ["utf8", "base64", "base64url", "hex", "latin1", "binary", "ascii", "utf16le", "ucs2"].includes(norm(enc))
    }
    static byteLength(v, enc) {
      if (typeof v !== "string") return v.byteLength ?? v.length
      return Buffer.fromString(v, enc).length
    }
    static concat(list, total) {
      total ??= list.reduce((n, i) => n + i.length, 0)
      const b = new Buffer(total)
      let off = 0
      for (const i of list) {
        if (off >= total) break
        b.set(i.subarray(0, total - off), off)
        off += i.length
      }
      return b
    }
    static compare(a, b) {
      return a.compare(b)
    }

    toString(enc, start = 0, end = this.length) {
      const u8 = start || end !== this.length ? this.subarray(start, end) : this
      switch (norm(enc)) {
        case "base64":
          return b64enc(u8)
        case "base64url":
          return b64enc(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
        case "hex":
          return Array.from(u8, i => i.toString(16).padStart(2, "0")).join("")
        case "latin1":
        case "binary":
        case "ascii":
          return latin1(u8)
        case "utf16le":
        case "ucs2": {
          let s = ""
          for (let i = 0; i + 1 < u8.length; i += 2) s += String.fromCharCode(u8[i] | (u8[i + 1] << 8))
          return s
        }
        default:
          return td.decode(u8)
      }
    }
    toJSON() {
      return { type: "Buffer", data: Array.from(this) }
    }
    equals(b) {
      return this.compare(b) === 0
    }
    compare(b) {
      const n = Math.min(this.length, b.length)
      for (let i = 0; i < n; i++) if (this[i] !== b[i]) return this[i] < b[i] ? -1 : 1
      return this.length === b.length ? 0 : this.length < b.length ? -1 : 1
    }
    slice(start, end) {
      return this.subarray(start, end)
    }
    write(s, off = 0, len, enc) {
      if (typeof off === "string") [enc, off] = [off, 0]
      if (typeof len === "string") [enc, len] = [len, undefined]
      const b = Buffer.fromString(s, enc)
      const n = Math.min(b.length, len ?? Infinity, this.length - off)
      this.set(b.subarray(0, n), off)
      return n
    }
    copy(target, tStart = 0, sStart = 0, sEnd = this.length) {
      const src = this.subarray(sStart, Math.min(sEnd, sStart + target.length - tStart))
      target.set(src, tStart)
      return src.length
    }
    fill(v, start = 0, end = this.length, enc) {
      if (typeof v === "string") {
        const b = Buffer.fromString(v, enc)
        if (!b.length) return super.fill(0, start, end)
        for (let i = start; i < end; i++) this[i] = b[(i - start) % b.length]
        return this
      }
      return super.fill(v, start, end)
    }
    indexOf(v, from = 0, enc) {
      if (typeof v === "number") return super.indexOf(v, from)
      const b = typeof v === "string" ? Buffer.fromString(v, enc) : v
      outer: for (let i = from; i <= this.length - b.length; i++) {
        for (let j = 0; j < b.length; j++) if (this[i + j] !== b[j]) continue outer
        return i
      }
      return -1
    }
    includes(v, from, enc) {
      return this.indexOf(v, from, enc) !== -1
    }
    get dv() {
      return new DataView(this.buffer, this.byteOffset, this.byteLength)
    }
  }

  /** readUInt32LE / writeInt16BE 等 */
  const rw = { UInt8: "Uint8", Int8: "Int8", UInt16: "Uint16", Int16: "Int16", UInt32: "Uint32", Int32: "Int32", Float: "Float32", Double: "Float64", BigUInt64: "BigUint64", BigInt64: "BigInt64" }
  const size = { Uint8: 1, Int8: 1, Uint16: 2, Int16: 2, Uint32: 4, Int32: 4, Float32: 4, Float64: 8, BigUint64: 8, BigInt64: 8 }
  for (const [name, dv] of Object.entries(rw))
    for (const le of [true, false]) {
      const suf = name.endsWith("8") ? "" : le ? "LE" : "BE"
      Buffer.prototype[`read${name}${suf}`] = function (off = 0) {
        return this.dv[`get${dv}`](off, le)
      }
      Buffer.prototype[`write${name}${suf}`] = function (v, off = 0) {
        this.dv[`set${dv}`](off, v, le)
        return off + size[dv]
      }
    }
  for (const i of Object.getOwnPropertyNames(Buffer.prototype))
    if (/^(read|write)UInt/.test(i)) Buffer.prototype[i.replace("UInt", "Uint")] = Buffer.prototype[i]

  Buffer.poolSize = 8192
  globalThis.Buffer = Buffer
})()
