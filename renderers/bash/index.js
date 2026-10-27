/**
 * bash 渲染后端：模板由 Renderer.dealTpl 生成 html，截图由 bash 在独立页面完成
 * 参数与 puppeteer 后端一致：imgType quality omitBackground multiPage multiPageHeight
 */
export default function (config = {}) {
  const renderer = new Renderer({ id: "bash", type: "image", render: "screenshot" })
  renderer.screenshot = async function (name, data = {}) {
    const savePath = this.dealTpl(name, data)
    if (!savePath) return false
    const file = __node.path.resolve(savePath)
    const fields = [
      __bridge.toURL(file),
      config.selector || "#container",
      data.imgType === "png" ? "png" : "jpeg",
      String(data.quality || config.quality || 90),
      data.omitBackground ? "1" : "0",
      String(data.multiPage ? data.multiPageHeight || 4000 : 0),
      String(data.deviceScaleFactor || config.deviceScaleFactor || 1),
      String(config.width || 1280),
    ]
    const start = Date.now()
    const r = await __bridge.call("render", fields.join("\n"))
    if (r.code !== "0" || !r.imgs?.length) {
      logger.error(`[图片生成][${name}] 失败`)
      return false
    }
    const imgs = r.imgs.map(i => Buffer.from(i, "base64"))
    logger.mark(`[图片生成][${name}][${imgs.length}张] ${(imgs.reduce((n, i) => n + i.length, 0) / 1024).toFixed(2)}KB ${Date.now() - start}ms`)
    return data.multiPage ? imgs : imgs[0]
  }
  renderer.render = renderer.screenshot
  return renderer
}
