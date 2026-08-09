# syntax=docker/dockerfile:1

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

RUN npm install -g @anthropic-ai/claude-code \
  && npm cache clean --force

# NAS のバインドマウントに書けるよう UID を合わせられるようにしておく。
ARG APP_UID=1000
ARG APP_GID=1000

# node イメージには UID 1000 の node ユーザーが既にいるので、先にどかしてから作る。
RUN userdel -r node 2>/dev/null || true; \
  groupadd -g ${APP_GID} app 2>/dev/null || true; \
  useradd -u ${APP_UID} -g ${APP_GID} -m -d /home/app -s /bin/bash app

WORKDIR /app

ENV NODE_ENV=production
ENV HOME=/home/app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# /app は読めれば足りるので所有者を変えない。
# ここで chown すると同じ内容のレイヤーがもう一つ増えてイメージが太る。
# ボリュームを載せる場所はここで作っておく。イメージに無いパスに載せると
# Docker が root 持ちで作ってしまい、app ユーザーが書けなくなる。
RUN mkdir -p /data /home/app/.claude /home/app/.cursor \
  && chown -R ${APP_UID}:${APP_GID} /data /home/app

USER app

# cursor-agent は ~/.local/bin に入る。不要なら --build-arg INSTALL_CURSOR=false で外す。
ARG INSTALL_CURSOR=true
ENV PATH=/home/app/.local/bin:$PATH
RUN if [ "$INSTALL_CURSOR" = "true" ]; then curl -fsSL https://cursor.com/install | bash; fi

EXPOSE 3000

CMD ["node", "dist/server/index.js"]
