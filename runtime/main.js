/** 对应原版 app.js：bash 负责进程，这里只创建 Bot 并运行 */
global.start_type = "bash"
global.Bot = new (await import("../lib/bot.js")).default()
await Bot.run()
