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
ARG CLAUDE_VERSION=2.1.226
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
RUN mkdir -p /data /home/app/.claude /home/app/.cursor /home/app/.config/cursor \
  && chown -R 1000:1000 /data /home/app

USER app

# cursor-agent は ~/.local/bin に入る。不要なら --build-arg INSTALL_CURSOR=false で外す。
# ビルド成果物より上に置く。下に置くとコードを直すたびに入り直しになり、
# そのとき版が上がって cursor のログインが切れることがある。
#
# 公式の install スクリプトは版を選べない（取得した時点の最新が埋め込まれて降りてくる）。
# CI から毎回叩くと版が勝手に上がってログインが切れるので、スクリプトが実際に
# やっていること（tar を展開して ~/.local/bin に symlink）をここに写して版を固定する。
# 上げるときは https://cursor.com/install を読んで、中の版番号をここへ持ってくる。
ARG INSTALL_CURSOR=true
ARG CURSOR_VERSION=2026.08.04-aaa8809
ENV PATH=/home/app/.local/bin:$PATH
RUN if [ "$INSTALL_CURSOR" = "true" ]; then \
      arch="$(uname -m)"; \
      case "$arch" in \
        x86_64 | amd64) arch=x64 ;; \
        arm64 | aarch64) arch=arm64 ;; \
        *) echo "cursor-agent の無い環境: $arch" >&2; exit 1 ;; \
      esac; \
      dir="$HOME/.local/share/cursor-agent/versions/${CURSOR_VERSION}"; \
      mkdir -p "$dir" "$HOME/.local/bin"; \
      curl -fsSL "https://downloads.cursor.com/lab/${CURSOR_VERSION}/linux/${arch}/agent-cli-package.tar.gz" \
        | tar --strip-components=1 -xzf - -C "$dir"; \
      ln -sf "$dir/cursor-agent" "$HOME/.local/bin/cursor-agent"; \
      ln -sf "$dir/cursor-agent" "$HOME/.local/bin/agent"; \
    fi

# 毎回変わるものはいちばん下に置く。ここから下だけが作り直される。
# 依存もここに置く。cursor より上に置くと、依存を足しただけで cursor が
# 入り直し、そのとき版が上がってログインが切れることがある。
# package.json は type=module の宣言のために要る（dist は ESM）。
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist ./dist

# どのコミットから作ったイメージかを焼き込む。管理画面がこれと GitHub 側の main を
# 見比べて、更新があるかを出す。毎回変わるのでいちばん下に置く。
ARG GIT_SHA=""
ENV APP_COMMIT=$GIT_SHA

EXPOSE 3000

CMD ["node", "dist/server/index.js"]
