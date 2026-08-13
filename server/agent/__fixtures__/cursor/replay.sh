#!/bin/sh
# cursor-agent の代わりに、記録しておいた出力をそのまま吐く。
# 引数は本物と同じものが渡ってくるが、ここでは見ない。
exec cat "$CURSOR_FIXTURE"
