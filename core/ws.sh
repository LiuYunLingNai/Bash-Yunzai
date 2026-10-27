# WebSocket 客户端：纯 bash（/dev/tcp），仅文本帧
# 需在 LC_ALL=C 下运行，保证按字节计数

# ws_connect fd host port path [额外请求头...]
ws_connect() {
  local fd=$1 host=$2 port=$3 path=$4 line hdr=
  [[ $fd =~ ^[0-9]+$ ]] || return 1
  shift 4
  for line; do hdr+="$line"$'\r\n'; done
  { eval "exec $fd<>/dev/tcp/\$host/\$port"; } 2>/dev/null || return 1
  printf 'GET %s HTTP/1.1\r\nHost: %s:%s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n%s\r\n' \
    "$path" "$host" "$port" "$hdr" >&"$fd"
  IFS= read -r -t 10 -u "$fd" line
  [[ $line == *' 101 '* ]] || { WS_ERR=$line; return 1; }
  while IFS= read -r -t 10 -u "$fd" line && [[ $line != $'\r' ]]; do :; done
}

# 客户端帧必须带掩码，用全 0 掩码则载荷无需异或
# ws_send fd text [opcode]
ws_send() {
  local fd=$1 n=${#2} op=${3:-1} h
  if ((n < 126)); then printf -v h '\\x%02x\\x%02x' $((0x80 | op)) $((n | 0x80))
  elif ((n < 65536)); then printf -v h '\\x%02x\\xfe\\x%02x\\x%02x' $((0x80 | op)) $((n >> 8)) $((n & 255))
  else printf -v h '\\x%02x\\xff\\x00\\x00\\x00\\x00\\x%02x\\x%02x\\x%02x\\x%02x' $((0x80 | op)) \
    $((n >> 24 & 255)) $((n >> 16 & 255)) $((n >> 8 & 255)) $((n & 255))
  fi
  printf "$h"'\x00\x00\x00\x00%s' "$2" >&"$fd"
}

_ws_rb() {
  local c
  IFS= read -r -d '' -n1 -u "$1" c || return 1
  printf -v REPLY %d "'$c"
  ((REPLY < 0)) && ((REPLY += 256))
  return 0
}

# ws_recv fd：读一条完整消息到 WS_DATA，WS_OP 为操作码
# 自动拼接分片；收到 ping 自动回 pong；收到 close 返回 1
ws_recv() {
  local fd=$1 b0 len i chunk op
  WS_DATA=
  while :; do
    _ws_rb "$fd" || return 1; b0=$REPLY
    _ws_rb "$fd" || return 1; len=$((REPLY & 127))
    if ((len == 126)); then _ws_rb "$fd"; len=$REPLY; _ws_rb "$fd"; len=$((len << 8 | REPLY))
    elif ((len == 127)); then len=0; for i in 1 2 3 4 5 6 7 8; do _ws_rb "$fd"; len=$((len << 8 | REPLY)); done
    fi
    chunk=
    ((len)) && IFS= read -r -N "$len" -u "$fd" chunk
    op=$((b0 & 15))
    case $op in
      9) ws_send "$fd" "$chunk" 10; continue ;;
      10) continue ;;
      8) return 1 ;;
    esac
    ((op)) && WS_OP=$op
    WS_DATA+=$chunk
    ((b0 & 0x80)) && break
  done
}
