#!/usr/bin/env bash
# 端到端测试：起 mock OneBot，跑 bash-yunzai，按顺序发消息，超时后收尾
# 用法：bash test/run.sh [超时秒数] [消息...]
cd "${BASH_SOURCE[0]%/*}/.." || exit 1
T=${1:-60}
shift
# 测试配置：主人 10000:20000，连 mock 的 3901 端口（已存在则不覆盖）
mkdir -p config/config temp
[[ -f config/config/other.yaml ]] || sed -e 's/- "stdin"$/- "20000"/' -e 's/- "stdin:stdin"/- "10000:20000"/' config/default_config/other.yaml >config/config/other.yaml
[[ -f config/config/bash.yaml ]] || printf 'onebot_url: ws://127.0.0.1:3901\ntoken:\nadapter: OneBotv11\n' >config/config/bash.yaml
node test/mock-onebot.mjs 3901 "$@" > temp/mock.log 2>&1 &
MOCK=$!
timeout "$T" bash app.sh > temp/app.log 2>&1
echo "app exit=$?"
kill "$MOCK" 2>/dev/null
wait "$MOCK" 2>/dev/null
# 只清理本次测试用的 profile 下的浏览器进程
if [[ $OSTYPE == cygwin* || $OSTYPE == msys* ]]; then
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { \$_.CommandLine -like '*bash-yunzai*temp*browser*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }"
fi
