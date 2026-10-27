/** express：bash-yunzai 不跑 HTTP 服务器，插件注册路由不报错但不会生效 */
const chain = () => {
  const app = (req, res, next) => next?.()
  return new Proxy(app, {
    get(t, k) {
      if (k in t) return t[k]
      if (k === "listen") return () => ({ on() {}, close() {}, address: () => ({ port: 0 }) })
      if (k === "locals" || k === "settings") return (t[k] ??= {})
      return (...a) => (k === "get" && a.length === 1 && typeof a[0] === "string" ? undefined : app)
    },
  })
}
const express = Object.assign(chain, {
  Router: chain,
  static: () => (req, res, next) => next?.(),
  json: () => (req, res, next) => next?.(),
  raw: () => (req, res, next) => next?.(),
  text: () => (req, res, next) => next?.(),
  urlencoded: () => (req, res, next) => next?.(),
})
export const Router = chain
export default express
