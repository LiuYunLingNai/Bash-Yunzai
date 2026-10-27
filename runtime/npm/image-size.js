/** image-size：解析 png / jpg / gif / webp / bmp 的宽高 */
const size = input => {
  const b = typeof input === "string" ? (globalThis.__node.fs.readFileSync(input)) : input
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b[0] === 0x89 && b[1] === 0x50) return { type: "png", width: dv.getUint32(16), height: dv.getUint32(20) }
  if (b[0] === 0x47 && b[1] === 0x49) return { type: "gif", width: dv.getUint16(6, true), height: dv.getUint16(8, true) }
  if (b[0] === 0x42 && b[1] === 0x4d) return { type: "bmp", width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) }
  if (b[0] === 0x52 && b[8] === 0x57 && b[9] === 0x45) {
    const t = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (t === "VP8X") return { type: "webp", width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
    if (t === "VP8 ") return { type: "webp", width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff }
    if (t === "VP8L") {
      const n = dv.getUint32(21, true)
      return { type: "webp", width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1 }
    }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length; ) {
      if (b[i] !== 0xff) break
      const m = b[i + 1], len = dv.getUint16(i + 2)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: "jpg", height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) }
      i += 2 + len
    }
  }
  throw TypeError("unsupported file type")
}
export const imageSize = size
export const imageSizeFromFile = async f => size(f)
export const setConcurrency = () => {}
/** v1 是 CJS：default 即 sizeOf，并带 imageSize / setConcurrency 属性 */
Object.assign(size, { imageSize: size, imageSizeFromFile, setConcurrency, default: size })
export default size
