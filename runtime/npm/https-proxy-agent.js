/**
 * https-proxy-agent：fetch 由浏览器发出，代理请用浏览器启动参数 --proxy-server 配置
 * 真实包是 CJS，default 导出为 { HttpsProxyAgent }；这里 default 同时可当类用
 */
export class HttpsProxyAgent {
  constructor(proxy, opts) {
    this.proxy = proxy
    this.opts = opts
  }
}
HttpsProxyAgent.HttpsProxyAgent = HttpsProxyAgent
export default HttpsProxyAgent
