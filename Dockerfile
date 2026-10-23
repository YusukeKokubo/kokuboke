# syntax=docker/dockerfile:1

# ---- deps -----------------------------------------------------------------
# 実行時に要る依存だけをここで揃える。ソースを見ないステージにしておくと、
# コードを直しただけのビルドではまるごとキャッシュに当たる。
# build ステージの npm ci とは同時に走るので、待ち時間は増えない。
FROM node:22-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- build ----------------------------------------------------------------
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM node:22-slim AS runtime

# Claude Code が git を前提にする場面があるため入れておく。
# ca-certificates はログイン時の HTTPS 通信に必要。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

# npm のキャッシュはここで捨てる。--mount=type=cache は BuildKit が要り、
# buildx の無い機械（手元の colima）でビルドできなくなる。
#
# 版を固定するのは、CI が毎回まっさらな環境でビルドするため。最新を取りに行かせると
# 押すたびに CLI の版が上がり、そのたびにサブスクリプションのログインが切れる。
# 上げたいときはここを書き換えて、コンテナに入り直してログインし直す。
# 人格ファイルは AGENTS.md なので、直接読める 2.1.277 より前には戻せない。
ARG CLAUDE_VERSION=2.1.278
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_VERSION}" \
  && npm cache clean --force

# 実行ユーザーは 1000 に固定する。機械ごとの値をイメージに焼き込むと、
# 所有者の違う機械へ同じイメージを持っていけなくなる。合わせるのは data 側。
# node イメージには UID 1000 の node ユーザーが既にいるので、先にどかしてから作る。
RUN userdel -r node 2>/dev/null || true; \
  groupadd -g 1000 app 2>/dev/null || true; \
  useradd -u 1000 -g 1000 -m -d /home/app -s /bin/bash app

WORKDIR /app

ENV NODE_ENV=production
ENV HOME=/home/app

# /app は読めれば足りるので所有者を変えない。
# ここで chown すると同じ内容のレイヤーがもう一つ増えてイメージが太る。
# ボリュームを載せる場所はここで作っておく。イメージに無いパスに載せると
# Docker が root 持ちで作ってしまい、app ユーザーが書けなくなる。
RUN mkdir -p /data /home/app/.claude \
  && chown -R 1000:1000 /data /home/app

USER app

# 毎回変わるものはいちばん下に置く。ここから下だけが作り直される。
# package.json は type=module の宣言のために要る（dist は ESM）。
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist ./dist

# 診断の AI が読むソースと経緯の文書。動いているものと同じコミットを読ませたいので、
# GitHub から引かせずにここへ写す。読めれば足りるので root 持ちのまま。
# 文書だけの変更では CI がイメージを作らないので、docs はその分だけ遅れることがある。
COPY --from=build /app/server ./source/server
COPY --from=build /app/src ./source/src
COPY --from=build /app/shared ./source/shared
COPY --from=build /app/docs ./source/docs
COPY --from=build /app/AGENTS.md /app/README.md /app/Dockerfile /app/docker-compose.yml /app/package.json ./source/

# どのコミットから作ったイメージかを焼き込む。管理画面がこれと GitHub 側の main を
# 見比べて、更新があるかを出す。毎回変わるのでいちばん下に置く。
ARG GIT_SHA=""
ENV APP_COMMIT=$GIT_SHA

EXPOSE 3000

CMD ["node", "dist/server/index.js"]
