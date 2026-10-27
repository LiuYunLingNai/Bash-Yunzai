# CDP 客户端：纯 bash
# fd 3 = 运行时页面（跑 JS 插件），fd 6 = 渲染页面（截图）
# 依赖 core/ws.sh

CDP_PORT=${CDP_PORT:-9333}
declare -A CDP_ID=([3]=0 [4]=0 [6]=0)

# 永不写入的管道，read -t 代替 sleep
coproc NAP { read -r; }
nap() { read -rt "$1" -u "${NAP[0]}"; }
now() { local t=${EPOCHREALTIME/./}; REPLY=$((t / 1000)); }

# 简单 HTTP GET（DevTools 接口），按 Content-Length 读，服务端不会主动断开
http_get() {
  { exec 7<>"/dev/tcp/127.0.0.1/$CDP_PORT"; } 2>/dev/null || return 1
  printf 'GET %s HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n' "$1" >&7
  local line body= len=0
  while IFS= read -r -t 5 -u 7 line && [[ $line != $'\r' ]]; do
    [[ $line =~ ^[Cc]ontent-[Ll]ength:\ *([0-9]+) ]] && len=${BASH_REMATCH[1]}
  done
  ((len)) && IFS= read -r -t 5 -N "$len" -u 7 body
  exec 7<&-
  REPLY=$body
}

# 启动浏览器，连接浏览器级端点（fd 4），自建运行时页面（fd 3）和渲染页面（fd 6）
# 不用 /json/list 里的现成页面：新配置目录下第一个可能是扩展后台页，无法打开 file://
browser_start() {
  "$BROWSER" --headless=new --remote-debugging-port="$CDP_PORT" --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check --disable-gpu \
    --allow-file-access-from-files --disable-web-security \
    "${BROWSER_ARGS[@]}" about:blank >/dev/null 2>&1 &
  BROWSER_PID=$!
  local i
  for i in {1..50}; do
    http_get /json/version && [[ $REPLY =~ \"webSocketDebuggerUrl\":\ \"ws://[^/]+(/devtools/browser/[^\"]+)\" ]] && break
    nap 0.2
  done
  [[ ${BASH_REMATCH[1]} == /devtools/browser/* ]] || { CDP_ERR="找不到浏览器调试端点"; return 1; }
  ws_connect 4 127.0.0.1 "$CDP_PORT" "${BASH_REMATCH[1]}" || { CDP_ERR="连接浏览器失败 $WS_ERR"; return 1; }
  page_open 3 || return 1
  page_open 6 || return 1
}

# page_open fd：新建空白页面并连接到 fd
page_open() {
  cdp 4 Target.createTarget '{"url":"about:blank"}' || return 1
  [[ $REPLY =~ \"targetId\":\"([0-9A-F]+)\" ]] || { CDP_ERR="创建页面失败 $REPLY"; return 1; }
  ws_connect "$1" 127.0.0.1 "$CDP_PORT" "/devtools/page/${BASH_REMATCH[1]}"
}

browser_stop() {
  { ws_send 4 '{"id":999999,"method":"Browser.close","params":{}}'; } 2>/dev/null
  exec 3>&- 4>&- 6>&- 2>/dev/null
}

# cdp_send fd 方法 参数：只发不等，id 在 REPLY
cdp_send() {
  # 默认值不能直接写在双引号里：${3:-'{}'} 在双引号中单引号不会被去掉
  local p=${3:-'{}'}
  REPLY=$((++CDP_ID[$1]))
  ws_send "$1" "{\"id\":$REPLY,\"method\":\"$2\",\"params\":$p}"
}

# cdp fd 方法 参数：发送并等待对应 id 的响应，结果在 REPLY
# 等待期间 fd 3 上的事件交给 on_cdp_event，其中不能再调用 cdp（只能 cdp_send）
cdp() {
  cdp_send "$1" "$2" "$3"
  local fd=$1 id=$REPLY
  while ws_recv "$fd"; do
    if [[ $WS_DATA == "{\"id\":$id,"* ]]; then
      [[ ${#WS_DATA} -lt 4000 && $WS_DATA == *'"error":{'* ]] && { CDP_ERR=$WS_DATA; return 1; }
      REPLY=$WS_DATA
      return 0
    fi
    [[ $fd == 3 ]] || continue
    if [[ $WS_DATA == '{"method":'* ]]; then on_cdp_event; else on_cdp_reply; fi
  done
  CDP_ERR="连接断开"
  return 1
}
