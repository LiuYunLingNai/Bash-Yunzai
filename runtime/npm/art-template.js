/** art-template：用浏览器版，换上 Node 版的路径解析和同步文件读取 */
import path from "node:path"
import fs from "node:fs"

const template = __require(__require.resolve("art-template/lib/template-web.js", process.cwd()))
const LOCAL = /^\.+\//
template.defaults.resolveFilename = (filename, options) => {
  const { root, extname } = options
  if (LOCAL.test(filename)) {
    const from = options.filename
    filename = path.resolve(!from || filename === from ? root : path.dirname(from), filename)
  } else filename = path.resolve(root, filename)
  if (!path.extname(filename)) filename += extname
  return filename
}
template.defaults.loader = filename => fs.readFileSync(filename, "utf8")
template.defaults.debug = false

export const { render, compile, defaults } = template
export default template
