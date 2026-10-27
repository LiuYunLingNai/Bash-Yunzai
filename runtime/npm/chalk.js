/** chalk：可链式调用的 ANSI 颜色 */
const STYLES = {
  reset: [0, 0], bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24], inverse: [7, 27], hidden: [8, 28], strikethrough: [9, 29],
  black: [30, 39], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39], white: [37, 39], gray: [90, 39], grey: [90, 39],
  blackBright: [90, 39], redBright: [91, 39], greenBright: [92, 39], yellowBright: [93, 39], blueBright: [94, 39], magentaBright: [95, 39], cyanBright: [96, 39], whiteBright: [97, 39],
  bgBlack: [40, 49], bgRed: [41, 49], bgGreen: [42, 49], bgYellow: [43, 49], bgBlue: [44, 49], bgMagenta: [45, 49], bgCyan: [46, 49], bgWhite: [47, 49], bgGray: [100, 49],
  bgRedBright: [101, 49], bgGreenBright: [102, 49], bgYellowBright: [103, 49], bgBlueBright: [104, 49], bgMagentaBright: [105, 49], bgCyanBright: [106, 49], bgWhiteBright: [107, 49],
}
const hexRGB = h => {
  h = String(h).replace("#", "")
  if (h.length === 3) h = [...h].map(c => c + c).join("")
  const n = parseInt(h, 16) || 0
  return [n >> 16, (n >> 8) & 255, n & 255]
}

function make(level, codes = []) {
  const fn = (...args) => {
    const s = args.join(" ")
    if (!level || !codes.length) return s
    return codes.reduce((t, [o, c]) => `\x1b[${o}m${t.replaceAll(`\x1b[${c}m`, `\x1b[${c}m\x1b[${o}m`)}\x1b[${c}m`, s)
  }
  return new Proxy(fn, {
    get(t, k) {
      if (k === "level") return level
      if (k in STYLES) return make(level, [...codes, STYLES[k]])
      if (k === "visible") return make(level, codes)
      if (k === "rgb") return (r, g, b) => make(level, [...codes, [`38;2;${r};${g};${b}`, 39]])
      if (k === "bgRgb") return (r, g, b) => make(level, [...codes, [`48;2;${r};${g};${b}`, 49]])
      if (k === "hex") return h => make(level, [...codes, [`38;2;${hexRGB(h).join(";")}`, 39]])
      if (k === "bgHex") return h => make(level, [...codes, [`48;2;${hexRGB(h).join(";")}`, 49]])
      if (k === "ansi256") return n => make(level, [...codes, [`38;5;${n}`, 39]])
      if (k === "bgAnsi256") return n => make(level, [...codes, [`48;5;${n}`, 49]])
      return t[k]
    },
    set(t, k, v) {
      t[k] = v
      return true
    },
  })
}

export class Chalk {
  constructor(opts = {}) {
    return make(opts.level ?? 3)
  }
}
const chalk = make(3)
export const supportsColor = { level: 3, hasBasic: true, has256: true, has16m: true }
export const chalkStderr = chalk
export default chalk
