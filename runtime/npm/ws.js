/** ws：客户端用浏览器 WebSocket 包一层 EventEmitter；不支持服务端 */
import { EventEmitter } from "node:events"

export class WebSocket extends EventEmitter {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  constructor(url, protocols) {
    super()
    if (protocols && !Array.isArray(protocols) && typeof protocols === "object") protocols = undefined
    this.ws = new globalThis.WebSocket(url, protocols)
    this.ws.binaryType = "arraybuffer"
    this.ws.onopen = () => (this.emit("open"), this.onopen?.())
    this.ws.onmessage = e => {
      const data = typeof e.data === "string" ? Buffer.from(e.data) : Buffer.from(e.data)
      this.emit("message", data, typeof e.data !== "string")
      this.onmessage?.({ data: e.data })
    }
    this.ws.onclose = e => (this.emit("close", e.code, Buffer.from(e.reason || "")), this.onclose?.(e))
    this.ws.onerror = () => {
      const err = Error(`WebSocket 连接错误 ${url}`)
      if (this.listenerCount("error")) this.emit("error", err)
      this.onerror?.(err)
    }
  }
  get readyState() {
    return this.ws.readyState
  }
  send(data, opts, cb) {
    if (typeof opts === "function") cb = opts
    try {
      this.ws.send(Buffer.isBuffer(data) ? data : data)
      cb?.()
    } catch (err) {
      cb?.(err)
    }
  }
  close(code, reason) {
    this.ws.close(code, reason)
  }
  terminate() {
    this.ws.close()
  }
  ping() {}
  pong() {}
}
export class WebSocketServer extends EventEmitter {
  constructor() {
    super()
    throw Error("bash-yunzai 不支持 WebSocket 服务端")
  }
}
export const Server = WebSocketServer
WebSocket.WebSocket = WebSocket
WebSocket.WebSocketServer = WebSocket.Server = WebSocketServer
export default WebSocket
