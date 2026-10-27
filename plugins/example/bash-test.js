import fs from "node:fs"

/** bash-yunzai 自测插件：渲染、命令、文件、redis、上下文 */
export class bashTest extends plugin {
  constructor() {
    super({
      name: "bash测试",
      dsc: "bash-yunzai 自测",
      event: "message",
      priority: 1,
      rule: [
        { reg: "^#测试渲染$", fnc: "render" },
        { reg: "^#测试命令$", fnc: "cmd" },
        { reg: "^#测试文件$", fnc: "file" },
        { reg: "^#测试上下文$", fnc: "ctx" },
      ],
    })
  }

  async render() {
    return this.e.runtime.render("example", "bash-test", {
      title: "bash-yunzai 渲染测试 <转义> & \"引号\"",
      list: [
        { name: "胡桃", lv: 90 },
        { name: "雷电将军", lv: 90 },
        { name: "纳西妲", lv: 80 },
        { name: "钟离", lv: 70 },
      ],
    })
  }

  async cmd() {
    const r = await Bot.exec("echo 你好 $((6 * 7)); uname -s")
    const sync = (await import("node:child_process")).execSync("echo sync-ok", { encoding: "utf8" }).trim()
    return this.reply(`异步：${r.stdout.replace(/\n/g, " | ")}\n同步：${sync}`)
  }

  async file() {
    const dir = "data/bash-test"
    const text = '中文 😀 "q" \\ %s \\c\n第二行\t制表'
    const bin = Buffer.from([0, 1, 2, 255, 0x22, 0x5c, 10, 13, 0x25])
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/a.txt`, text)
    fs.writeFileSync(`${dir}/b.bin`, bin)
    await fs.promises.appendFile(`${dir}/a.txt`, "+追加")
    await redis.set("bash-test", "1", { EX: 60 })
    const ok = [
      `文本 ${fs.readFileSync(`${dir}/a.txt`, "utf8") === `${text}+追加`}`,
      `二进制 ${fs.readFileSync(`${dir}/b.bin`).equals(bin)}`,
      `stat ${fs.statSync(`${dir}/b.bin`).size === bin.length}`,
      `列表 ${fs.readdirSync(dir).sort().join(",")}`,
      `redis ${await redis.get("bash-test")} ttl ${await redis.ttl("bash-test")}`,
      `不存在 ${fs.existsSync(`${dir}/nope`) === false}`,
    ]
    fs.rmSync(dir, { recursive: true })
    ok.push(`删除 ${!fs.existsSync(dir)}`)
    return this.reply(ok.join("\n"))
  }

  ctx() {
    this.setContext("ctxReply")
    return this.reply("请回复任意内容")
  }

  ctxReply() {
    this.finish("ctxReply")
    return this.reply(`上下文收到：${this.e.msg}`)
  }
}
