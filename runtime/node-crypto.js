/** crypto：同步 md5 / sha1 / sha256（Web Crypto 只有异步），随机数用 crypto.getRandomValues */
;(() => {
  const webcrypto = globalThis.crypto
  const rotl = (x, n) => (x << n) | (x >>> (32 - n))

  /** 补位：长度按 64 位写在末尾，le 决定字节序 */
  const pad = (m, le) => {
    const n = m.length
    const out = new Uint8Array((((n + 8) >> 6) + 1) << 6)
    out.set(m)
    out[n] = 0x80
    const bits = n * 8
    const dv = new DataView(out.buffer)
    if (le) {
      dv.setUint32(out.length - 8, bits >>> 0, true)
      dv.setUint32(out.length - 4, Math.floor(bits / 2 ** 32), true)
    } else {
      dv.setUint32(out.length - 8, Math.floor(bits / 2 ** 32))
      dv.setUint32(out.length - 4, bits >>> 0)
    }
    return dv
  }

  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)
  const md5 = m => {
    const dv = pad(m, true)
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
    const M = new Array(16)
    for (let off = 0; off < dv.byteLength; off += 64) {
      for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true)
      let a = a0, b = b0, c = c0, d = d0
      for (let i = 0; i < 64; i++) {
        let f, g
        if (i < 16) (f = (b & c) | (~b & d)), (g = i)
        else if (i < 32) (f = (d & b) | (~d & c)), (g = (5 * i + 1) & 15)
        else if (i < 48) (f = b ^ c ^ d), (g = (3 * i + 5) & 15)
        else (f = c ^ (b | ~d)), (g = (7 * i) & 15)
        const t = d
        d = c
        c = b
        b = (b + rotl((a + f + K[i] + M[g]) | 0, S[i])) | 0
        a = t
      }
      a0 = (a0 + a) | 0
      b0 = (b0 + b) | 0
      c0 = (c0 + c) | 0
      d0 = (d0 + d) | 0
    }
    const out = new DataView(new ArrayBuffer(16))
    ;[a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true))
    return new Uint8Array(out.buffer)
  }

  const sha1 = m => {
    const dv = pad(m, false)
    let h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
    const w = new Int32Array(80)
    for (let off = 0; off < dv.byteLength; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4)
      for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
      let [a, b, c, d, e] = h
      for (let i = 0; i < 80; i++) {
        const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d
        const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6
        const t = (rotl(a, 5) + f + e + k + w[i]) | 0
        e = d
        d = c
        c = rotl(b, 30)
        b = a
        a = t
      }
      h = h.map((v, i) => (v + [a, b, c, d, e][i]) | 0)
    }
    const out = new DataView(new ArrayBuffer(20))
    h.forEach((v, i) => out.setInt32(i * 4, v))
    return new Uint8Array(out.buffer)
  }

  const K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]
  const rotr = (x, n) => (x >>> n) | (x << (32 - n))
  const sha256 = m => {
    const dv = pad(m, false)
    let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
    const w = new Int32Array(64)
    for (let off = 0; off < dv.byteLength; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4)
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
      }
      let [a, b, c, d, e, f, g, hh] = h
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
        hh = g
        g = f
        f = e
        e = (d + t1) | 0
        d = c
        c = b
        b = a
        a = (t1 + t2) | 0
      }
      h = h.map((v, i) => (v + [a, b, c, d, e, f, g, hh][i]) | 0)
    }
    const out = new DataView(new ArrayBuffer(32))
    h.forEach((v, i) => out.setInt32(i * 4, v))
    return new Uint8Array(out.buffer)
  }

  const ALG = { md5: [md5, 64], sha1: [sha1, 64], sha256: [sha256, 64] }
  const alg = name => {
    const a = ALG[String(name).toLowerCase().replace("-", "")]
    if (!a) throw Error(`Digest method not supported: ${name}`)
    return a
  }
  const toBytes = (d, enc) => (typeof d === "string" ? Buffer.from(d, enc) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : Buffer.from(d))
  const concat = parts => Buffer.concat(parts.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p))))
  const out = (b, enc) => {
    const buf = Buffer.from(b)
    return enc ? buf.toString(enc) : buf
  }

  class Hash {
    constructor(name) {
      ;[this.fn] = alg(name)
      this.parts = []
    }
    update(d, enc) {
      this.parts.push(toBytes(d, enc))
      return this
    }
    digest(enc) {
      return out(this.fn(concat(this.parts)), enc)
    }
    copy() {
      const h = Object.create(Hash.prototype)
      h.fn = this.fn
      h.parts = [...this.parts]
      return h
    }
  }
  class Hmac {
    constructor(name, key) {
      const [fn, bs] = alg(name)
      this.fn = fn
      let k = toBytes(key)
      if (k.length > bs) k = fn(k)
      this.k = new Uint8Array(bs)
      this.k.set(k)
      this.parts = []
    }
    update(d, enc) {
      this.parts.push(toBytes(d, enc))
      return this
    }
    digest(enc) {
      const ipad = this.k.map(b => b ^ 0x36), opad = this.k.map(b => b ^ 0x5c)
      const inner = this.fn(concat([ipad, ...this.parts]))
      return out(this.fn(concat([opad, inner])), enc)
    }
  }

  const randomBytes = (n, cb) => {
    const b = Buffer.alloc(n)
    for (let i = 0; i < n; i += 65536) webcrypto.getRandomValues(b.subarray(i, i + 65536))
    if (cb) return queueMicrotask(() => cb(null, b))
    return b
  }
  const unsupported = name => () => { throw Error(`crypto.${name} 不支持`) }
  __node.crypto = {
    createHash: name => new Hash(name),
    createHmac: (name, key) => new Hmac(name, key),
    getHashes: () => Object.keys(ALG),
    hash: (name, d, enc = "hex") => new Hash(name).update(d).digest(enc),
    randomBytes,
    pseudoRandomBytes: randomBytes,
    randomFillSync: b => (webcrypto.getRandomValues(b), b),
    randomUUID: () => webcrypto.randomUUID(),
    randomInt: (min, max) => {
      if (max === undefined) [min, max] = [0, min]
      return min + Math.floor((webcrypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (max - min))
    },
    getRandomValues: a => webcrypto.getRandomValues(a),
    timingSafeEqual: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
    webcrypto,
    subtle: webcrypto.subtle,
    createCipheriv: unsupported("createCipheriv"),
    createDecipheriv: unsupported("createDecipheriv"),
    scryptSync: unsupported("scryptSync"),
    pbkdf2Sync: unsupported("pbkdf2Sync"),
    generateKeyPairSync: unsupported("generateKeyPairSync"),
    publicEncrypt: unsupported("publicEncrypt"),
    privateDecrypt: unsupported("privateDecrypt"),
    createPublicKey: unsupported("createPublicKey"),
    createPrivateKey: unsupported("createPrivateKey"),
    constants: {},
  }
})()
