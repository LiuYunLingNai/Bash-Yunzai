/** compression：没有 HTTP 服务器，中间件直接放行 */
export default () => (req, res, next) => next?.()
