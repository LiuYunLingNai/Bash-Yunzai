# 渲染：用 fd 6 上的独立页面截图
# 页面发来的参数用 \n 分隔，空值用 - 占位：
#   url 选择器 类型(jpeg|png) 质量 透明背景(0|1) 分页高度(0=不分页) 缩放 视口宽度

RENDER_WAIT_JS='new Promise(r=>{const f=()=>Promise.all([document.fonts.ready,...[...document.images].map(i=>i.complete?0:new Promise(o=>{i.onload=i.onerror=o}))]).then(()=>setTimeout(()=>{const e=document.querySelector(SEL)||document.body;const b=e.getBoundingClientRect();r([b.x,b.y,b.width,b.height].map(Math.ceil).join(","))},30));document.readyState==="complete"?f():addEventListener("load",f)})'

render_page() {
  local id=$1 IFS=$'\n' f
  f=($2)
  IFS=$' \t\n'
  local url=${f[0]} sel=${f[1]} type=${f[2]} quality=${f[3]} omit=${f[4]} ph=${f[5]} scale=${f[6]} width=${f[7]}
  [[ $sel =~ ^[#.a-zA-Z0-9_-]+$ ]] || sel=body
  [[ $type == png ]] || type=jpeg
  [[ $quality =~ ^[0-9]+$ ]] || quality=90
  [[ $ph =~ ^[0-9]+$ ]] || ph=0
  [[ $scale =~ ^[0-9.]+$ ]] || scale=1
  [[ $width =~ ^[0-9]+$ ]] || width=1280
  now; local t0=$REPLY

  render_fail() { log_line error "渲染失败 $1 $CDP_ERR"; page_call resolve "\"$id\"" '"1"'; }

  cdp 6 Emulation.setDeviceMetricsOverride "{\"width\":$width,\"height\":720,\"deviceScaleFactor\":$scale,\"mobile\":false}" || { render_fail 视口; return; }
  if [[ $omit == 1 ]]; then cdp 6 Emulation.setDefaultBackgroundColorOverride '{"color":{"r":0,"g":0,"b":0,"a":0}}'
  else cdp 6 Emulation.setDefaultBackgroundColorOverride '{}'
  fi
  json_esc "$url"
  cdp 6 Page.navigate "{\"url\":\"$REPLY\"}" || { render_fail 打开页面; return; }
  json_esc "${RENDER_WAIT_JS//SEL/\"$sel\"}"
  cdp 6 Runtime.evaluate "{\"expression\":\"$REPLY\",\"awaitPromise\":true,\"returnByValue\":true,\"timeout\":30000}" || { render_fail 等待加载; return; }
  [[ $REPLY =~ \"value\":\"(-?[0-9]+),(-?[0-9]+),([0-9]+),([0-9]+)\" ]] || { render_fail "取尺寸 ${REPLY:0:200}"; return; }
  local x=${BASH_REMATCH[1]} y=${BASH_REMATCH[2]} w=${BASH_REMATCH[3]} h=${BASH_REMATCH[4]}
  ((x < 0)) && x=0; ((y < 0)) && y=0

  local q= imgs= n=1 i cy ch pre
  [[ $type == jpeg ]] && q=",\"quality\":$quality"
  ((ph > 0)) && { n=$(((h + ph / 2) / ph)); ((n < 1)) && n=1; }
  for ((i = 0; i < n; i++)); do
    if ((n == 1)); then cy=$y ch=$h
    else cy=$((y + i * ph)); ch=$ph; ((i == n - 1)) && ch=$((h - i * ph))
    fi
    cdp 6 Page.captureScreenshot "{\"format\":\"$type\"$q,\"captureBeyondViewport\":true,\"clip\":{\"x\":$x,\"y\":$cy,\"width\":$w,\"height\":$ch,\"scale\":1}}" || { render_fail 截图; return; }
    # 响应固定为 {"id":N,"result":{"data":"..."}}，按偏移切；大字符串不能用 ${x#*pat}
    pre="{\"id\":${CDP_ID[6]},\"result\":{\"data\":\""
    [[ ${REPLY:0:${#pre}} == "$pre" ]] || { render_fail "截图响应 ${REPLY:0:100}"; return; }
    imgs+=",\"${REPLY:${#pre}:${#REPLY}-${#pre}-3}\""
  done
  now
  log_line debug "渲染完成 ${w}x${h} ${n}张 $((REPLY - t0))ms"
  page_call renderDone "\"$id\"" "[${imgs:1}]"
}
