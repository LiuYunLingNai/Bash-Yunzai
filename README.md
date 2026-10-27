# Bash-Yunzai

用 Bash 跑 [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai)：进程、OneBot 连接、文件与命令桥接、截图都由 Bash 完成，浏览器（Edge / Chrome）页面作为 JS 运行时，直接加载原版 Yunzai 的 lib 和插件，不需要 Node.js 运行时。

已测试可加载：原版 system / other 插件、7 个适配器（含标准输入）、miao-plugin、genshin、yenai-plugin、what2eat-plugin。

## 工作方式

```
OneBot 协议端 ──ws──> bash (app.sh) ──CDP──> 浏览器页面（Yunzai + 插件）
                       │                         │
                       ├ 文件写入 / 命令执行 <────┤ 同步 XHR 拦截、binding
                       └ 截图（独立页面）<───────┘ Renderer
```

- `core/`：纯 Bash 实现的 WebSocket 客户端（`/dev/tcp`）、CDP 客户端、桥接、渲染、OneBot 连接
- `runtime/`：浏览器里的 Node 兼容层（fs、path、events、stream、child_process、crypto、Buffer 等）、CommonJS 加载器、import map 生成，以及 redis / sequelize / node-schedule 等替身
- `lib/`：原版 Yunzai，只改了 `lib/bot.js`（去掉 HTTP 服务器，OneBot 连接交给 Bash）
- `renderers/bash`：截图渲染后端，接口与 puppeteer 后端一致

## 使用

需要：bash 5（Linux / Git Bash / Cygwin）、Chromium 内核浏览器、pnpm（只用来安装插件依赖的 JS 文件）。

```bash
pnpm i
bash app.sh
```

首次启动后编辑 `config/config/bash.yaml`：

```yaml
onebot_url: ws://127.0.0.1:3001   # 协议端需开启正向 WebSocket，只支持 ws://
token:
adapter: OneBotv11
```

在终端里直接运行时会启用标准输入适配器，可以像原版一样输入指令。浏览器路径、调试端口在 `config/bash.conf` 里设置。

## 限制

- 只能作为 WebSocket 客户端：反向 WS、HTTP 上报、Web 面板（锅巴等）、`Bot.express` 路由不可用
- 原生模块（sqlite3 等）不可用；sequelize 用 JSON 文件替身实现，已有的 sqlite 数据库不会读取
- 浏览器 fetch 会丢弃 Cookie / Referer / User-Agent 等受限请求头
- 不监听文件变化，插件热重载不可用
- 子进程不支持交互式读写（stdin 写完才执行）

## 安全

浏览器以 `--disable-web-security --allow-file-access-from-files` 启动，页面脚本可以读取本地文件。模板若用 `{{@ }}` 原样输出用户内容，有注入风险。OneBot 消息直接嵌入 CDP 参数，前提是信任协议端。

## 测试

```bash
bash test/run.sh 60 "#状态" "#测试渲染" "#测试文件"
```

`test/mock-onebot.mjs` 是用 Node 跑的模拟协议端，仅用于开发测试。

## 许可

基于 TRSS-Yunzai 修改，沿用 [GPL-3.0](LICENSE)。
