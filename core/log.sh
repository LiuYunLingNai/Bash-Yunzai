# 日志：页面发来的日志已带时间、等级和颜色，原样输出；bash 自己的日志在这里格式化
declare -A LOG_LV=([trace]=0 [debug]=1 [info]=2 [warn]=3 [error]=4 [fatal]=5 [mark]=6 [off]=9)
LOG_LEVEL=${LOG_LEVEL:-info}

# log_line 等级 文本：文本来自页面时已格式化（以 ESC 或 [ 开头）
log_line() {
  local lv=$1 text=$2 t ms day
  # 页面日志已在页面按 bot.yaml 的 log_level 过滤过，这里只过滤 bash 自己的
  [[ $text == $'\e'* ]] || ((${LOG_LV[$lv]:-2} >= ${LOG_LV[$LOG_LEVEL]:-2})) || return 0
  if [[ $text != $'\e'* && $text != '['* ]]; then
    printf -v t '%(%H:%M:%S)T' -1
    ms=${EPOCHREALTIME#*.}
    local c=36
    case $lv in error|fatal) c=31 ;; warn) c=33 ;; mark) c=90 ;; debug|trace) c=34 ;; esac
    printf -v text '\e[%sm[%s.%s][%-4.4s]\e[0m\e[34m[  Bash  ]\e[0m %s' "$c" "$t" "${ms:0:3}" "${lv^^}" "$text"
  fi
  printf '%s\n' "$text"
  printf -v day '%(%Y-%m-%d)T' -1
  printf '%s\n' "$text" >>"$ROOT/logs/command.$day.log"
  [[ $lv == error || $lv == fatal ]] && printf '%s\n' "$text" >>"$ROOT/logs/error.log"
  return 0
}
