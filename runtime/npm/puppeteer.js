/** puppeteer：bash-yunzai 的截图由 bash 驱动浏览器完成（renderers/bash），这里不提供 */
const no = () => {
  throw Error("bash-yunzai 不支持直接使用 puppeteer，请使用 Renderer / runtime.render")
}
export const launch = no
export const connect = no
export const executablePath = () => ""
export default { launch, connect, executablePath }
