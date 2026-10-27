/**
 * 测试用 OneBot v11 正向 WS 服务端（开发工具，用原版 Yunzai 的 node 跑，不属于 bash-yunzai 运行时）
 * 用法：node test/mock-onebot.mjs [端口] [消息1] [消息2] ...
 * 连接后按顺序以主人身份发群消息，记录机器人发出的 send_msg，结束后输出汇总
 */
import { createRequire } from "node:module"
const require = createRequire(new URL("../../package.json", import.meta.url))
const { WebSocketServer } = require("ws")

const port = Number(process.argv[2]) || 3001
const msgs = process.argv.slice(3)
const SELF = 10000, MASTER = 20000, GROUP = 30000
const sent = []
const log = (...a) => console.log(`[mock ${new Date().toISOString().slice(11, 23)}]`, ...a)

const api = {
  get_login_info: () => ({ user_id: SELF, nickname: "测试机器人" }),
  get_version_info: () => ({ app_name: "MockOneBot", app_version: "1.0.0", protocol_version: "v11" }),
  get_friend_list: () => [{ user_id: MASTER, nickname: "主人", remark: "" }],
  get_group_list: () => [{ group_id: GROUP, group_name: "测试群", member_count: 2, max_member_count: 200 }],
  get_group_member_list: () => [
    { group_id: GROUP, user_id: SELF, nickname: "测试机器人", card: "", role: "member" },
    { group_id: GROUP, user_id: MASTER, nickname: "主人", card: "", role: "owner" },
  ],
  get_group_info: () => ({ group_id: GROUP, group_name: "测试群", member_count: 2, max_member_count: 200 }),
  get_stranger_info: () => ({ user_id: MASTER, nickname: "主人" }),
  get_cookies: () => ({ cookies: "" }),
  get_csrf_token: () => ({ token: 0 }),
  get_status: () => ({ online: true, good: true }),
}

const wss = new WebSocketServer({ port })
log(`监听 ws://127.0.0.1:${port}`)
wss.on("connection", (ws, req) => {
  log("连接", req.headers.authorization || "")
  const send = d => ws.send(JSON.stringify(d))
  send({ time: Date.now() / 1000 | 0, self_id: SELF, post_type: "meta_event", meta_event_type: "lifecycle", sub_type: "connect" })
  let msgId = 1
  ws.on("message", raw => {
    const req = JSON.parse(raw)
    if (/^send_(group_|private_)?forward_msg$/.test(req.action)) {
      const n = req.params.messages?.length || 0
      sent.push(`[转发 ${n} 条]`)
      log(`机器人发送: [转发 ${n} 条]`, JSON.stringify(req.params.messages).slice(0, 200))
      return send({ status: "ok", retcode: 0, data: { message_id: 1000 + msgId++ }, echo: req.echo })
    }
    if (req.action === "send_msg" || req.action === "send_group_msg" || req.action === "send_private_msg") {
      const m = req.params.message
      for (const i of Array.isArray(m) ? m : [])
        if (i.type === "image" && String(i.data.file).startsWith("base64://")) {
          const f = new URL(`../temp/mock-img-${sent.length}.bin`, import.meta.url)
          require("node:fs").writeFileSync(f, Buffer.from(i.data.file.slice(9), "base64"))
          log("图片已保存", f.pathname)
        }
      const brief = (Array.isArray(m) ? m : [m]).map(i => typeof i === "string" ? i : i.type === "text" ? i.data.text : i.type === "image" ? `[图片 ${String(i.data.file).slice(0, 30)}... ${String(i.data.file).length}B]` : `[${i.type}]`).join("")
      sent.push(brief)
      log("机器人发送:", brief.slice(0, 300))
      return send({ status: "ok", retcode: 0, data: { message_id: 1000 + msgId++ }, echo: req.echo })
    }
    const fn = api[req.action]
    send({ status: fn ? "ok" : "failed", retcode: fn ? 0 : 1404, data: fn ? fn(req.params) : null, msg: fn ? "" : "不支持", echo: req.echo })
  })

  /** 等适配器连上后依次发消息 */
  let i = 0
  const next = () => {
    if (i >= msgs.length) return setTimeout(finish, Number(process.env.MOCK_TAIL) || 4000)
    const text = msgs[i++]
    log("发送消息:", text)
    send({
      time: Date.now() / 1000 | 0, self_id: SELF, post_type: "message", message_type: "group", sub_type: "normal",
      message_id: msgId++, group_id: GROUP, user_id: MASTER, raw_message: text, font: 0,
      message: [{ type: "text", data: { text } }],
      sender: { user_id: MASTER, nickname: "主人", card: "", role: "owner" },
    })
    setTimeout(next, 3000)
  }
  setTimeout(next, 4000)
})

const finish = () => {
  log(`完成，机器人共发送 ${sent.length} 条`)
  console.log(JSON.stringify({ sent }))
  process.exit(0)
}
setTimeout(finish, 120000)
