# kokuboke

家族向けの AI チャット PWA。返答は Claude Code / cursor-agent をヘッドレスで起動して得る。

## 環境

- Node は mise 管理。`node` `npm` は PATH にない → `mise exec -- npm run ...`
- Docker は colima。`docker compose`（プラグイン版）は解決されない → `docker-compose` を使う
- colima の VM は aarch64 で buildx もない。NAS 向け（x86_64）のイメージはここでは作れない。
  ただし手元の `docker-compose build` は通る。層の並びやマウント点の所有者の確認はこれで足りる。
  逆に BuildKit 前提の書き方（`RUN --mount=type=cache` など）は入れない。
  NAS では通るが手元のビルドが丸ごと落ちて、確認の手段がなくなる

## よく使う

すべて `mise exec --` を頭に付けて実行する。

- `mise exec -- npm run dev` — Vite 5173 + API 3000。`.env` を読む（`USERS` は必須）
- `mise exec -- npm run typecheck` / `... npm test` / `... npm run build`
- テストは `server/store/` だけ。`node --test` を tsx 経由で走らせる。
  それ以外の確認は typecheck と build、あとは実際に動かして見る
- テストは環境変数を差し込んでから `await import` する。`config` は読み込んだ時点で
  環境変数を見るため。`process.loadEnvFile` は既にある値を上書きしないので `.env` には負けない
- 更新まわりの確認は、手元で compose を上げて中から叩く。ホストの 3000 は
  開発中のサーバーが握っているので、ポートと `DATA_PATH` を上書きする別の
  compose ファイルを scratchpad に置いて `-f` で重ねる。ただし `DATA_PATH` は
  colima が VM に見せている場所（ホーム配下）にする。`/tmp` の下は共有されず、
  コンテナからは空の root 持ちに見えて `EACCES` になる
- 端から端までの確認は API を直に叩く。トピック作成 → `messages`（multipart の `text`）
  → `summary` で SSE が流れる。CLI を起動する経路はこれでしか確かめられない
- UI の確認は agent-browser。`agent-browser set viewport 390 844` でスマホ幅にし、
  URL は `http://` を明示する（省略すると https になって失敗する）
- ドロップや貼り付けの確認は、ブラウザで `DragEvent` / `ClipboardEvent` を合成して流す。
  OS から実際に引きずってくる経路そのものは踏めないので、最後は手で一度試す

## どこに何があるか

- `server/agent/` — CLI をヘッドレスで起動して SSE に流す部分。エンジンごとに
  `claude-code.ts` と `cursor.ts`、共通の実行と待ち行列が `process.ts` `queue.ts`
- `server/routes/` — API。`server/store/` — data 配下の読み書き。パスの検査は `store/paths.ts` に集約
- `server/config.ts` — 環境変数と既定値はここに集約。増やすときもここ
- `shared/types.ts` — フロントとサーバーで共有する型。`Message.images` に入るのは
  ファイル名だけ。URL は返すときに `withImageUrls` で組み立てる（保存しない）
- `src/pages/` — 画面は 2 つだけ。`src/lib/api.ts` が API 呼び出しと SSE の受けの入口
- `src/components/markdown/` — Markdown と数式の描画。`src/components/ui/` は shadcn だが
  style が `base-nova` で中身は `@base-ui/react`。Radix 前提の書き方は通らない

データの構造・デプロイ・API 一覧は README.md にある。

## 間違えやすいところ

- `data/**/CLAUDE.md` はアプリが読むユーザー人格ファイル。プロジェクトへの指示ではない
- 各フォルダの `AGENTS.md` は `CLAUDE.md` へのシンボリックリンク（cursor-agent 用）
- 手元の `data/` は実際の会話が入る。動作確認で作ったトピックは消しておく
- フロントの経路は `/user/:user` と `/user/:user/:topic`。`/:user` は 404 になる
- トピック名はそのままフォルダ名で、日本語が入る。URL に埋めるときは
  `encodeURIComponent` を通す。比較と保存の前に `normalizeTopicName` で NFC に寄せる
- `package.json` の `dependencies` はサーバーが実行時に読むものだけ（hono / sharp /
  heic-convert）。画面側は vite が `dist` に畳み込むので `devDependencies` に置く。
  新しく入れるときは、どちら側で使うかで置き場所を決める
- `DATA_DIR` と `DATA_PATH` は別物。前者は手元で直接動かすときの保存先、
  後者は compose がマウント元に使う。`.env` に両方あるで取り違えやすい

## 進め方

CLI のフラグと出力形式は推測で書かず、実際に叩いて確かめてから実装する。
このプロジェクトで実際に踏んだ落とし穴:

- Claude Code は `AGENTS.md` を読まない。cursor-agent は親まで遡って読む
- cursor の `assistant` イベントは `timestamp_ms` 付きが差分、無しが完成形。
  見分けずに連結すると本文が二重になる
- cursor は `--force` を付けると `--sandbox` が無効になる
- remark-math が独立した式として扱うのは `$$` が行頭と行末に来た形だけ
- `node:22-slim` には UID 1000 の `node` ユーザーが既にいる
- cursor の認証は二か所に分かれる。`~/.cursor/cli-config.json` にあるのは素性の情報で、
  トークン本体は `~/.config/cursor/auth.json`。前者だけ永続化してもコンテナを
  作り直すたびに再ログインになる。切り分けは `docker diff`（ボリュームの中身は出ない）
- Claude Code の `~/.claude.json` はホーム直下に出る。`~/.claude` の中ではない。
  `CLAUDE_CONFIG_DIR` で寄せられる（2.1.226 で確認）
- コンテナは `USER app` で動く。`docker exec` も `app` で入るので、
  chown など root が要る作業は `-u 0` を付ける
- イメージは Actions が作って GHCR に置く。差し替えるのは NAS に同居する Watchtower で、
  `/admin` から頼まれたときだけ動く（定期の見回りはさせていない。話している最中に
  入れ替わると返事の流れが切れるため）。手元でコミットしただけでは何も起きないので、
  まず push する。`deploy.sh` を通すのは初回と compose を直したときだけ
- Watchtower が差し替えるのはイメージだけで、コンテナの設定は今のものを引き継ぐ。
  `docker-compose.yml` を直した回は見た目は正常に上がってくるのに設定が古いまま残る。
  管理画面は GitHub の compare で `docker-compose.yml` の変更を見つけて知らせる
- `containrrr/watchtower` は止まっていて Docker API 1.25 で話しかける。今の Docker は
  1.40 以上しか受け付けないので起動直後から回り続ける。`nickfedor/watchtower` を使う。
  こちらの `/v1/update` は POST のみ（元家は GET でも受けた）。口は
  `WATCHTOWER_HTTP_API_ENDPOINTS` で選び、鍵が無いと開かない
- ワークフローは `.md` と `docs/` を無視するので、そこだけのコミットではイメージが
  作られない。管理画面はその差を `docsOnly` として見分けてボタンを出さない。
  無視する範囲を変えるときは `server/routes/admin.ts` の判定も合わせる
- Watchtower のログの 403 は、たいてい非公開ではなくイメージがまだ無いだけ。
  Actions が押したパッケージは公開リポジトリなら匿名で引ける。引けるかどうかは
  `ghcr.io/token` で匿名トークンを取ってマニフェストを叩けば分かる
- CLI の版は Dockerfile で固定する（`CLAUDE_VERSION` / `CURSOR_VERSION`）。CI は
  毎回まっさらなので、留めないと push のたびに版が上がってログインが切れる。
  cursor の install スクリプトは版を選べない（取得時の最新が埋め込まれて降りてくる）ので、
  中の版番号と `downloads.cursor.com` の経路を Dockerfile に写して使う
- Dockerfile の runtime は、CLI のインストールより下に依存とビルド成果物を置く。
  依存を上に置くと `package.json` を触るたびに cursor が入り直し、そのとき版が
  上がってログインが切れる。実行時の依存は deps ステージで揃えて持ってくる。
  build ステージで `npm prune` すると、コードを一行直すたびに走って無駄になる
- 層のどこが崩れるかは頭で予想せず、ビルドログの CACHED を見て確かめる。
  Dockerfile を直したとき、崩れる範囲は思ったより狭いことが多い
- NAS の管理画面が `docker-compose.yaml` を横に作ることがある。`.yml` と両方あると
  Compose がファイルを決められずに止まる
