#!/usr/bin/env bash
# bash-yunzai：bash 负责连接、桥接、渲染；浏览器页面作为 JS 运行时加载原版 Yunzai 插件
export LC_ALL=C
set -o pipefail
shopt -s nullglob

ROOT=${BASH_SOURCE[0]%/*}
[[ $ROOT == "${BASH_SOURCE[0]}" ]] && ROOT=.
cd -- "$ROOT" || exit 1
ROOT=$PWD

. core/ws.sh
. core/json.sh
. core/log.sh
. core/cdp.sh
. core/bridge.sh
. core/ops.sh
. core/render.sh
. core/onebot.sh
[[ -f config/bash.conf ]] && . config/bash.conf

# 浏览器里用的路径：Cygwin/MSYS 下 /cygdrive/d/x 或 /d/x → D:/x
case $OSTYPE in
  cygwin* | msys*)
    PLATFORM=win32
    if [[ $ROOT =~ ^/(cygdrive/)?([a-zA-Z])(/.*)?$ ]]; then ROOT_W=${BASH_REMATCH[2]^}:${BASH_REMATCH[3]}
    else ROOT_W=$ROOT
    fi
    ;;
  darwin*) PLATFORM=darwin ROOT_W=$ROOT ;;
  *) PLATFORM=linux ROOT_W=$ROOT ;;
esac
ROOT_URL=file:///${ROOT_W#/}

if [[ ! $BROWSER ]]; then
  for BROWSER in \
    "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    "/cygdrive/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    "/c/Program Files/Google/Chrome/Application/chrome.exe" \
    /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome /usr/bin/microsoft-edge ""; do
    [[ -x $BROWSER ]] && break
  done
fi
[[ $BROWSER ]] || { log_line error "找不到 Chromium 内核浏览器，请在 config/bash.conf 设置 BROWSER"; exit 1; }
[[ $PLATFORM == win32 ]] && PROFILE=${PROFILE:-${ROOT_W//\//\\}\\temp\\browser} || PROFILE=${PROFILE:-$ROOT/temp/browser}

cleanup() {
  browser_stop
  nap 0.5
  [[ $BROWSER_PID ]] && kill "$BROWSER_PID" 2>/dev/null
}
trap cleanup EXIT
trap 'APP_EXIT=0' INT TERM

main() {
  rm -rf -- "$BRIDGE_DIR"
  # temp/html：原版由 puppeteer 渲染器创建，部分插件（genshin 的 gcLog）直接在里面非递归 mkdir
  mkdir -p -- "$BRIDGE_DIR" logs data temp/html
  log_line mark "bash-yunzai 启动中，浏览器 $BROWSER"
  browser_start || { log_line error "浏览器启动失败 $CDP_ERR"; exit 1; }
  cdp 3 Runtime.enable >/dev/null
  cdp 3 Inspector.enable >/dev/null
  cdp 3 Log.enable >/dev/null
  cdp 3 Fetch.enable '{"patterns":[{"urlPattern":"http://bridge.local/*"}]}'
  cdp 3 Runtime.addBinding '{"name":"__bash"}'
  # 新建的浏览器配置目录首次启动时，Edge 自己的初始导航还没完成，会把这次导航 ERR_ABORTED，重试
  local tty=0
  [[ -t 0 ]] && tty=1
  json_esc "$ROOT_URL/runtime/index.html?root=$ROOT_W&platform=$PLATFORM&arch=x64&tty=$tty&force_tty=${FORCE_TTY:-}"
  local url=$REPLY i
  for i in {1..10}; do
    cdp 3 Page.navigate "{\"url\":\"$url\"}" && [[ $REPLY != *'"errorText"'* ]] && break
    log_line warn "打开运行时页面失败，重试 ${REPLY:0:120}$CDP_ERR"
    nap 0.5
  done

  local t tj=0 busy
  APP_EXIT=
  while [[ ! $APP_EXIT ]]; do
    busy=
    if read -t 0 -u 3; then
      ws_recv 3 || { log_line error "浏览器连接断开"; APP_EXIT=1; break; }
      busy=1
      if [[ $WS_DATA == '{"method":'* ]]; then on_cdp_event; else on_cdp_reply; fi
    fi
    if ((OB_UP)) && read -t 0 -u 5; then
      onebot_recv
      busy=1
    fi
    # 标准输入：页面里的 stdin 适配器开始监听后才读；read -t 0 在 EOF 时也为真
    if ((STDIN_ON)) && read -t 0 -u 0; then
      stdin_recv
      busy=1
    fi
    [[ $busy ]] && continue
    now; t=$REPLY
    if ((t >= tj)); then
      tj=$((t + 200))
      ((${#JOBS[@]})) && jobs_poll
      ((!OB_UP && OB_RETRY && t >= OB_RETRY)) && { OB_RETRY=0; onebot_connect; }
    fi
    nap 0.01
  done
}

main
code=${APP_EXIT:-0}
if [[ $code == 100 ]]; then
  log_line mark "重启中..."
  cleanup
  trap - EXIT
  exec bash "$ROOT/app.sh" "$@"
fi
exit "$code"
