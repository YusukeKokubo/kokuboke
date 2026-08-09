#!/bin/sh
# NAS 上で実行する。SSH を開けている間の作業を 1 コマンドにまとめたもの。
#
#   cd <docker 共有>/kokuboke && ./scripts/deploy.sh
#
# origin から取り込めるならここで取り込む。取り込めなくても、置いてある
# コードでそのまま進む。NAS に GitHub の認証情報を置いていない場合は、
# Mac 側から先に取り込んでおく（共有は SMB で見えている）。
#   git -C /Volumes/docker/kokuboke pull

set -eu
cd "$(dirname "$0")/.."

# NAS の管理画面が docker-compose.yaml を横に作ることがある。両方あると
# Compose は名前を決められずに止まるので、読むファイルを指定しておく。
if docker compose version >/dev/null 2>&1; then
  DC="docker compose -f docker-compose.yml"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose -f docker-compose.yml"
else
  echo "docker compose が見つかりません" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo ".env がありません。.env.example をもとに作ってください" >&2
  exit 1
fi
if ! grep -qE '^USERS=[^[:space:]]+' .env; then
  echo ".env の USERS が空です。家族の名前を入れてください" >&2
  exit 1
fi

mkdir -p data

echo "==> 最新を取り込む"
if git rev-parse --git-dir >/dev/null 2>&1; then
  if git pull --ff-only 2>&1; then
    :
  else
    echo "   取り込めなかったので、置いてあるコードで進む"
  fi
else
  echo "   git の管理下ではないので飛ばす"
fi

echo "==> ビルドして起動する（N100 では数分かかる）"
$DC up -d --build

echo "==> 立ち上がりを待つ"
ok=""
i=0
while [ "$i" -lt 45 ]; do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  i=$((i + 1))
  sleep 2
done

if [ -z "$ok" ]; then
  echo "起動を確認できませんでした。直近のログ:" >&2
  $DC logs --tail=40
  exit 1
fi

curl -s http://127.0.0.1:3000/api/health
echo

# ビルドのたびに 1GB 近い層が積まれる。NAS の空きを食うので片付ける。
echo "==> 古いイメージを片付ける"
docker image prune -f >/dev/null

echo "==> 完了"
echo "   ログイン確認: docker exec -it kokuboke claude"
echo "   公開:         tailscale serve --bg 3000"
