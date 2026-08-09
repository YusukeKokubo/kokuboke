# kokuboke

家族向けの AI チャット PWA。返答は Claude Code / cursor-agent をヘッドレスで起動して得る。

## 環境

- Node は mise 管理。`node` `npm` は PATH にない → `mise exec -- npm run ...`
- Docker は colima。`docker compose`（プラグイン版）は解決されない → `docker-compose` を使う
- colima の VM は aarch64 で buildx もない。NAS 向け（x86_64）のイメージはここでは作れない

## よく使う

- `npm run dev` — Vite 5173 + API 3000。`.env` を読む（`USERS` は必須）
- `npm run typecheck` / `npm run build`
- UI の確認は agent-browser。`agent-browser set viewport 390 844` でスマホ幅にし、
  URL は `http://` を明示する（省略すると https になって失敗する）

## 間違えやすいところ

- `data/**/CLAUDE.md` はアプリが読むユーザー人格ファイル。プロジェクトへの指示ではない
- 各フォルダの `AGENTS.md` は `CLAUDE.md` へのシンボリックリンク（cursor-agent 用）
- 手元の `data/` は実際の会話が入る。動作確認で作ったトピックは消しておく

## 進め方

CLI のフラグと出力形式は推測で書かず、実際に叩いて確かめてから実装する。
このプロジェクトで実際に踏んだ落とし穴:

- Claude Code は `AGENTS.md` を読まない。cursor-agent は親まで遡って読む
- cursor の `assistant` イベントは `timestamp_ms` 付きが差分、無しが完成形。
  見分けずに連結すると本文が二重になる
- cursor は `--force` を付けると `--sandbox` が無効になる
- remark-math が独立した式として扱うのは `$$` が行頭と行末に来た形だけ
- `node:22-slim` には UID 1000 の `node` ユーザーが既にいる
