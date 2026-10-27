# OneBot v11 正向 WebSocket（fd 5），只支持 ws://
OB_UP=0 OB_URL= OB_TOKEN= OB_RETRY=0

onebot_open() {
  OB_URL=$1 OB_TOKEN=$2
  onebot_connect
}

onebot_connect() {
  [[ $OB_URL =~ ^ws://([^/:]+)(:([0-9]+))?(/.*)?$ ]] || { log_line error "OneBot 地址无效（只支持 ws://）：$OB_URL"; return 1; }
  local host=${BASH_REMATCH[1]} port=${BASH_REMATCH[3]:-80} path=${BASH_REMATCH[4]:-/} hdr=()
  [[ $OB_TOKEN ]] && hdr=("Authorization: Bearer $OB_TOKEN")
  log_line info "连接 OneBot $OB_URL"
  if ws_connect 5 "$host" "$port" "$path" "${hdr[@]}"; then
    OB_UP=1
    log_line mark "OneBot 已连接 $OB_URL"
    page_call wsOpen
  else
    OB_UP=0
    log_line error "OneBot 连接失败 ${WS_ERR:-$OB_URL}，5 秒后重试"
    now; OB_RETRY=$((REPLY + 5000))
  fi
}

onebot_close() {
  ((OB_UP)) && { ws_send 5 '' 8; exec 5>&-; }
  OB_UP=0 OB_URL= OB_RETRY=0
}

# 适配器请求超时等情况：断开后马上重连
onebot_reconnect() {
  ((OB_UP)) || return
  ws_send 5 '' 8
  exec 5>&-
  OB_UP=0
  log_line warn "OneBot 断开重连"
  page_call wsClose
  now; OB_RETRY=$((REPLY + 1000))
}

# 标准输入一行转给页面；EOF（Ctrl+D）时通知页面关闭，stdin 适配器会退出
STDIN_ON=0
stdin_recv() {
  local line
  if IFS= read -r line || [[ $line ]]; then
    line=${line%$'\r'}
    # 方向键等控制字符会让 JSON 无效，去掉
    line=${line//[$'\x01'-$'\x08'$'\x0b'-$'\x1f'$'\x7f']/}
    json_esc "$line"
    page_call stdinLine "\"$REPLY\""
  else
    STDIN_ON=0
    page_call stdinClose
  fi
}

# 主循环里调用：收一条消息转给页面
onebot_recv() {
  if ! ws_recv 5; then
    exec 5>&-
    OB_UP=0
    log_line error "OneBot 连接断开，5 秒后重连"
    page_call wsClose
    now; OB_RETRY=$((REPLY + 5000))
    return
  fi
  # 只接受 JSON 对象，直接作为 CDP 参数值内嵌，省去一次转义
  # 只看首尾字符，'{'*'}' 这种通配在大字符串上可能很慢
  [[ ${WS_DATA:0:1} == '{' && ${WS_DATA: -1} == '}' ]] || { log_line warn "OneBot 非 JSON 消息已忽略"; return; }
  page_call wsMessage "$WS_DATA"
}
