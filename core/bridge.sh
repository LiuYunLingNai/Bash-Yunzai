# 页面 ↔ bash 桥
#
# 页面 → bash：__bash("op id data")，id 以 s 开头表示同步（页面随后同步 XHR 到
#   http://bridge.local/wait/<id> 阻塞等待），以 a 开头表示异步（完成后回调 __yz.resolve）
# data 编码（页面侧 bx 编码）：字段用真实 \n 分隔，字段内的 " \ 控制字符 代理对 二进制字节
#   都写成 \xHH，经 CDP 再转义一次。bash 先 %b（UTF-8，解 CDP 转义），再对字段 %b 得到原始字节
# 结果：状态放在 x-ret 头或 resolve 参数里，附加输出写到 temp/bridge/<id>，页面用 file:// 读

declare -A SYNC_RET=() SYNC_PARK=() JOBS=() PENDING=()
BRIDGE_DIR=$ROOT/temp/bridge
YZ_OBJ=

# 第一遍解码：CDP 的 JSON 转义 → 页面的 bx 文本
bx_pass1() { local LC_ALL=C.UTF-8; printf -v REPLY %b "$1"; }
# 第二遍解码：bx 文本 → 原始文本（不能含 NUL，二进制请用 bx_pass2_file）
bx_pass2() { printf -v REPLY %b "$1"; }
bx_pass2_file() { printf %b "$1"; }

# page_call 方法 参数JSON...：调用页面 __yz.<方法>(...)，不等待
# 页面就绪（拿到 __yz 的 objectId）之前的调用先排队
# functionDeclaration 放在 arguments 之后：参数里的 JSON 即使带同名键也覆盖不了它
PAGE_QUEUE=()
page_call() {
  local fn=$1 args= a
  shift
  for a; do args+=",{\"value\":$a}"; done
  if [[ ! $YZ_OBJ ]]; then
    PAGE_QUEUE+=("$fn"$'\n'"${args:1}")
    return
  fi
  cdp_send 3 Runtime.callFunctionOn "{\"objectId\":\"$YZ_OBJ\",\"arguments\":[${args:1}],\"functionDeclaration\":\"function(...a){return this.$fn(...a)}\"}"
}

# Runtime.evaluate("__yz") 的响应
on_yz_obj() {
  [[ $WS_DATA =~ \"objectId\":\"([^\"]+)\" ]] || { log_line error "取 __yz 失败 ${WS_DATA:0:200}"; return; }
  YZ_OBJ=${BASH_REMATCH[1]}
  local i
  for i in "${PAGE_QUEUE[@]}"; do
    cdp_send 3 Runtime.callFunctionOn "{\"objectId\":\"$YZ_OBJ\",\"arguments\":[${i#*$'\n'}],\"functionDeclaration\":\"function(...a){return this.${i%%$'\n'*}(...a)}\"}"
  done
  PAGE_QUEUE=()
}

# 同步请求结果：已挂起则立刻放行，否则先存着
sync_done() {
  local id=$1 st=$2
  if [[ ${SYNC_PARK[$id]} ]]; then
    fulfill "${SYNC_PARK[$id]}" "$st"
    unset "SYNC_PARK[$id]"
  else
    SYNC_RET[$id]=$st
  fi
}

fulfill() {
  cdp_send 3 Fetch.fulfillRequest "{\"requestId\":\"$1\",\"responseCode\":200,\"responseHeaders\":[{\"name\":\"x-ret\",\"value\":\"$2\"},{\"name\":\"Access-Control-Allow-Origin\",\"value\":\"*\"},{\"name\":\"Access-Control-Expose-Headers\",\"value\":\"x-ret\"}],\"body\":\"\"}"
}

# 操作完成：同步 id 放行 XHR，异步 id 回调页面
op_done() {
  if [[ $1 == s* ]]; then sync_done "$1" "$2"
  else page_call resolve "\"$1\"" "\"$2\""
  fi
}

# CDP 事件分发
on_cdp_event() {
  case $WS_DATA in
    '{"method":"Runtime.bindingCalled"'*) on_binding ;;
    '{"method":"Fetch.requestPaused"'*) on_paused ;;
    '{"method":"Runtime.exceptionThrown"'*)
      [[ $WS_DATA =~ \"description\":\"(([^\"\\]|\\.)*) ]] && { json_unesc "${BASH_REMATCH[1]}"; log_line error "[页面异常] $REPLY"; } ;;
    '{"method":"Inspector.targetCrashed"'*) log_line error "运行时页面崩溃"; APP_EXIT=1 ;;
    '{"method":"Log.entryAdded"'*)
      # 模块解析 / 加载失败的真实原因只出现在这里（import() 只报 Failed to fetch）
      [[ $WS_DATA == *'"level":"error"'* ]] || return
      local text= url=
      [[ $WS_DATA =~ \"text\":\"(([^\"\\]|\\.)*) ]] && { json_unesc "${BASH_REMATCH[1]}"; text=$REPLY; }
      [[ $WS_DATA =~ \"url\":\"([^\"]*) ]] && url=${BASH_REMATCH[1]}
      [[ $url == http://bridge.local/* ]] && return
      # 运行时自己用 XHR 探测文件是否存在，ERR_FILE_NOT_FOUND 是预期的
      [[ $text == *ERR_FILE_NOT_FOUND* && $url == */runtime/* ]] && return
      log_line error "[浏览器] $text${url:+ ($url)}" ;;
  esac
}

# 未被 cdp() 等待的响应：按 PENDING 回调
on_cdp_reply() {
  [[ $WS_DATA =~ ^\{\"id\":([0-9]+), ]] || return
  local id=${BASH_REMATCH[1]} cb=${PENDING[${BASH_REMATCH[1]}]}
  [[ $cb ]] || return
  unset "PENDING[$id]"
  $cb
}

on_paused() {
  [[ $WS_DATA =~ \"requestId\":\"([^\"]+)\" ]] || return
  local rid=${BASH_REMATCH[1]}
  [[ $WS_DATA =~ \"url\":\"http://bridge\.local/wait/([a-z0-9]+)\" ]] || { fulfill "$rid" "bad"; return; }
  local id=${BASH_REMATCH[1]}
  if [[ ${SYNC_RET[$id]} ]]; then
    fulfill "$rid" "${SYNC_RET[$id]}"
    unset "SYNC_RET[$id]"
  else
    SYNC_PARK[$id]=$rid
  fi
}

on_binding() {
  local pre='{"method":"Runtime.bindingCalled","params":{"name":"__bash","payload":"'
  [[ ${WS_DATA:0:${#pre}} == "$pre" ]] || return
  local p=${WS_DATA:${#pre}}
  # 页面数据里没有裸引号，"executionContextId" 前的 "," 就是 payload 结束
  # 必须用 %（从尾部找最短后缀）：%% 从头扫，大字符串上是 O(n²)，64 万字节要 10 秒
  p=${p%\",\"executionContextId\":*}
  # op、id 都很短：在前 64 字节里找空格，再按偏移切，避免对大字符串做模式匹配
  local head=${p:0:64}
  local op=${head%% *}
  head=${head:${#op}+1}
  local id=${head%% *}
  local data=${p:${#op}+${#id}+2}
  bridge_op "$op" "$id" "$data"
}
