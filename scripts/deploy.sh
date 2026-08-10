#!/bin/sh
# NAS 上で実行する。ふだんの更新は管理画面から Watchtower に頼めば済むので、
# ここを叩くのは次の三つの場合だけ。
#
#   - はじめて立てるとき
#   - docker-compose.yml を直したとき（Watchtower はイメージを差し替えるだけで、
#     コンテナの設定は今のものを引き継ぐ。設定の変更はここを通さないと効かない）
#   - 差し替えが失敗して手で直したいとき
#
#   cd <docker 共有>/kokuboke && sudo ./scripts/deploy.sh
#
# イメージは GitHub Actions が x86_64 で作って GHCR に置く。ここではビルドせず
# 引っ張るだけなので、N100 でも数十秒で終わる。

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
# Watchtower の待ち受けはこの鍵で守る。空のまま立てると、コンテナ間の
# ネットワークに届く相手なら誰でも入れ替えを起こせる。
if ! grep -qE '^WATCHTOWER_TOKEN=[^[:space:]]+' .env; then
  echo ".env の WATCHTOWER_TOKEN が空です。適当な長い文字列を入れてください" >&2
  echo "  例: openssl rand -hex 24" >&2
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

echo "==> イメージを引っ張る"
$DC pull

# --no-build を付けるのは、GHCR に届かなかったときに N100 で数分のビルドが
# 黙って始まらないようにするため。compose には手元用の build も残してある。
echo "==> 起動する"
$DC up -d --no-build

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

# 引っ張るたびに 1GB 近い層が残る。ふだんの差し替えでは Watchtower が
# CLEANUP で消すが、ここを通ったときは自分で片付ける。
echo "==> 古いイメージを片付ける"
docker image prune -f >/dev/null

echo "==> 完了"
echo "   ログイン確認: sudo docker exec -it kokuboke claude"
echo "   公開:         tailscale serve --bg 3000"
echo "   更新の画面:   /admin?key=<ADMIN_TOKEN>"
