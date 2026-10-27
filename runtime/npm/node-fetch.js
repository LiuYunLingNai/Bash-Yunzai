/**
 * node-fetch：用浏览器 fetch（插件自带的 node-fetch 3 依赖 Node 的 http / zlib，浏览器里跑不了）
 * 注意浏览器会丢弃 Cookie / Referer / User-Agent 等受限请求头
 */
const nodeFetch = (url, opts = {}) => {
  if (opts.agent) opts = { ...opts, agent: undefined }
  if (opts.body && typeof opts.body.getBuffer === "function") opts = { ...opts, body: opts.body.getBuffer() }
  return globalThis.fetch(url, opts)
}
export const { Blob, File, FormData, Headers, Request, Response } = globalThis
export const AbortError = class extends Error { name = "AbortError" }
export const FetchError = class extends Error { name = "FetchError" }
export const isRedirect = code => [301, 302, 303, 307, 308].includes(code)
export const fileFrom = async (p, type) => new File([await (await import("node:fs/promises")).readFile(p)], p.split("/").pop(), { type })
export default nodeFetch
