# JSON 工具：纯 bash
# patsub_replacement 会让替换串里的 & 变成匹配文本，统一关掉
shopt -u patsub_replacement 2>/dev/null

# json_esc 文本 → REPLY（不含两侧引号）
json_esc() {
  local s=${1//'\'/'\\'}
  s=${s//'"'/'\"'}
  s=${s//$'\n'/'\n'}
  s=${s//$'\r'/'\r'}
  REPLY=${s//$'\t'/'\t'}
}

# json_unesc JSON 字符串内容 → REPLY
# 用 printf %b 处理 \n \t \\ \uXXXX，再补上 %b 不认识的 \" 和 \/
# 代理对 😀 需先合并成 \UXXXXXXXX
json_unesc() {
  # 全局是 LC_ALL=C（按字节读帧），\u 输出 UTF-8 需临时切 locale
  local LC_ALL=C.UTF-8 s=$1 hi lo cp
  # 先把 \\ 换成 %b 能识别的 \x5c，剩下的 \ 必然是单个转义的开头，后续替换就不会误伤
  s=${s//'\\'/'\x5c'}
  while [[ $s =~ \\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2}) ]]; do
    hi=$((16#${BASH_REMATCH[1]})) lo=$((16#${BASH_REMATCH[2]}))
    printf -v cp '\\U%08x' $((0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)))
    s=${s//"${BASH_REMATCH[0]}"/"$cp"}
  done
  s=${s//'\"'/'\x22'}
  s=${s//'\/'/'/'}
  printf -v REPLY %b "$s"
}

# json_str 键 JSON → REPLY（取第一个匹配的字符串字段，原始转义形式）
json_str() {
  local re='"'$1'":"(([^"\\]|\\.)*)"'
  [[ $2 =~ $re ]] && REPLY=${BASH_REMATCH[1]}
}

# json_num 键 JSON → REPLY
json_num() {
  local re='"'$1'":(-?[0-9]+)'
  [[ $2 =~ $re ]] && REPLY=${BASH_REMATCH[1]}
}
