/** lodash：用 es-toolkit/compat 的 ESM 版本，补上原版 lib/modules/lodash 里修正的 defaults */
import * as compat from "es-toolkit/compat"

const _ = { ...compat }
_.defaults = (object, ...sources) => {
  object = Object(object)
  const objectProto = Object.prototype
  let length = sources.length
  const guard = length > 2 ? sources[2] : undefined
  if (guard && _.isObject(sources[1]) && sources[1][sources[0]] === guard) length = 1
  for (let i = 0; i < length; i++) {
    const source = sources[i] ?? {}
    for (const key in source) {
      const value = object[key]
      if (value === undefined || (!Object.hasOwn(object, key) && _.eq(value, objectProto[key])))
        object[key] = source[key]
    }
  }
  return object
}
export default _
