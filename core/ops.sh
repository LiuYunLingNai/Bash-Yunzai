# 桥操作实现

# 第一字段（到第一个换行）放 F1，其余放 REST；不用 ${x#*pat}，那在大字符串上很慢
split1() {
  # 第一字段（路径等）很短，只在前 4096 字节里找换行
  local h=${1:0:4096}
  F1=${h%%$'\n'*}
  REST=${1:${#F1}+1}
}

# Cygwin/MSYS 路径 /d/x、/cygdrive/d/x → 浏览器用的 D:/x
to_win() {
  if [[ $PLATFORM == win32 && $1 =~ ^/(cygdrive/)?([a-zA-Z])(/.*)?$ ]]; then REPLY=${BASH_REMATCH[2]^}:${BASH_REMATCH[3]:-/}
  else REPLY=$1
  fi
}

bridge_op() {
  local op=$1 id=$2 data=$3 err=$BRIDGE_DIR/$2
  case $op in
    log)
      bx_pass1 "$data"; split1 "$REPLY"; bx_pass2 "$REST"
      log_line "$F1" "$REPLY" ;;
    ready)
      # 不能在事件处理里阻塞等待（会吞掉别的响应），挂回调
      YZ_OBJ=
      cdp_send 3 Runtime.evaluate '{"expression":"__yz"}'
      PENDING[$REPLY]=on_yz_obj ;;
    ws.open)
      bx_pass1 "$data"; split1 "$REPLY"; bx_pass2 "$F1"; local url=$REPLY; bx_pass2 "$REST"
      onebot_open "$url" "$REPLY" ;;
    ws.send)
      bx_pass1 "$data"; bx_pass2 "$REPLY"
      ((OB_UP)) && ws_send 5 "$REPLY" ;;
    out)
      # 原样写终端：第一个字段是 1/2，内容可能是二进制（catimg 的输出）
      bx_pass1 "$data"; split1 "$REPLY"
      if [[ $F1 == 2 ]]; then bx_pass2_file "$REST" >&2; else bx_pass2_file "$REST"; fi ;;
    stdin.on) STDIN_ON=1 ;;
    ws.close) onebot_close ;;
    ws.reconnect) onebot_reconnect ;;
    fs.write|fs.append)
      bx_pass1 "$data"; split1 "$REPLY"; bx_pass2 "$F1"
      if [[ $op == fs.write ]]; then bx_pass2_file "$REST" 2>"$err" >"$REPLY"
      else bx_pass2_file "$REST" 2>"$err" >>"$REPLY"
      fi
      op_done "$id" $? ;;
    fs.mkdir|fs.rm)
      bx_pass1 "$data"; bx_pass2 "$REPLY"
      if [[ $op == fs.mkdir ]]; then mkdir -p -- "$REPLY" 2>"$err"; else rm -rf -- "$REPLY" 2>"$err"; fi
      op_done "$id" $? ;;
    fs.mv|fs.cp)
      bx_pass1 "$data"; split1 "$REPLY"; bx_pass2 "$F1"; local src=$REPLY; bx_pass2 "$REST"
      if [[ $op == fs.mv ]]; then mv -f -- "$src" "$REPLY" 2>"$err"; else cp -rf -- "$src" "$REPLY" 2>"$err"; fi
      op_done "$id" $? ;;
    fs.realpath)
      # cd -P 解开符号链接 / NTFS junction（pnpm 的依赖都是链接），在当前 shell 里做，不开子进程
      bx_pass1 "$data"; bx_pass2 "$REPLY"
      local p=$REPLY here=$PWD base=
      if [[ -d $p ]]; then cd -P -- "$p" 2>"$err" && p=$PWD
      elif [[ -e $p ]]; then base=${p##*/}; cd -P -- "${p%/*}" 2>"$err" && p=$PWD/$base
      else printf 'No such file or directory' >"$err"; op_done "$id" 1; return
      fi
      cd -- "$here"
      to_win "$p"; printf '%s' "$REPLY" >"$err.path"
      op_done "$id" 0 ;;
    exec)
      bx_pass1 "$data"; split1 "$REPLY"; bx_pass2 "$F1"; local cwd=$REPLY; bx_pass2 "$REST"
      job_start "$id" "$cwd" "$REPLY" ;;
    render)
      bx_pass1 "$data"; bx_pass2 "$REPLY"
      render_page "$id" "$REPLY" ;;
    exit)
      APP_EXIT=${data:-0} ;;
    *) log_line warn "未知桥操作 $op" ;;
  esac
}

# 后台执行命令，完成后写 <id>.code；主循环轮询
job_start() {
  local id=$1 cwd=$2 cmd=$3 f=$BRIDGE_DIR/$1
  (
    exec 3>&- 4>&- 5>&- 6>&-
    cd -- "$cwd" 2>/dev/null
    bash -c "$cmd" >"$f.out" 2>"$f.err" </dev/null
    printf '%s' $? >"$f.code.tmp"
    mv -f "$f.code.tmp" "$f.code"
  ) &
  JOBS[$id]=1
}

jobs_poll() {
  local id code
  for id in "${!JOBS[@]}"; do
    [[ -f $BRIDGE_DIR/$id.code ]] || continue
    read -r code <"$BRIDGE_DIR/$id.code"
    unset "JOBS[$id]"
    op_done "$id" "$code"
  done
}
