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
- `mise exec -- npm run typecheck` / `... npm run lint` / `... npm test` / `... npm run build`
- テストは `server/store/` と `server/agent/`。`node --test` を tsx 経由で走らせる。
  それ以外の確認は typecheck と build、あとは実際に動かして見る
- テストは環境変数を差し込んでから `await import` する。`config` は読み込んだ時点で
  環境変数を見るため。`process.loadEnvFile` は既にある値を上書きしないので `.env` には負けない
- CLI の出力の読み方は、記録を流し込んで通しで確かめる。`CURSOR_BIN` を
  `server/agent/__fixtures__/cursor/replay.sh` に向けると、`CURSOR_FIXTURE` の記録を
  そのまま吐くのでエンジンをそっくり動かせる。記録の取り直しは本物の出力を保存して
  中の絶対パスを均すだけ。増やしたら `cursor-replay.test.ts` の一覧にも足す
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
- `shared/date.ts` — 日付の整形。`server/agent/engines.ts` — エンジンとモデルの一覧
- `src/pages/` — 画面。`src/lib/api.ts` が API 呼び出しと SSE の受けの入口
- `src/components/markdown/` — Markdown と数式の描画。`src/components/ui/` は shadcn だが
  style が `base-nova` で中身は `@base-ui/react`。Radix 前提の書き方は通らない
- `android/` — Capacitor の WebView 殻。`CAPACITOR_SERVER_URL` 先の NAS UI を開く。
  Chrome の時間制限を避けるため。Studio 不要で `android:sdk` → `android:apk`

- `docs/` — 詰まって長く調べた話の記録。当てが外れた筋も残してある

データの構造・デプロイ・API 一覧は README.md にある。イメージや層の並び、
Watchtower の選び方の理由は `Dockerfile` と `docker-compose.yml` のコメントに書いてある。

## 間違えやすいところ

- `data/**/CLAUDE.md` はアプリが読むユーザー人格ファイル。プロジェクトへの指示ではない
- 各フォルダの `AGENTS.md` は `CLAUDE.md` へのシンボリックリンク（cursor-agent 用）
- 手元の `data/` は実際の会話が入る。動作確認で作ったトピックは消しておく
- フロントの経路は `/user/` から始まる。`/:user` は 404 になる
- トピック名はそのままフォルダ名で、日本語が入る。URL に埋めるときは
  `encodeURIComponent` を通す。比較と保存の前に `normalizeTopicName` で NFC に寄せる
- `package.json` の `dependencies` はサーバーが実行時に読むものだけ。画面側は
  `devDependencies`（vite が `dist` に畳み込む）。理由は `package.json` の `"//"` に
- `DATA_DIR` と `DATA_PATH` は別物。前者は手元で直接動かすときの保存先、
  後者は compose がマウント元に使う。`.env` に両方あるで取り違えやすい
- Android 殻は `server.url` で NAS を開く。APK に焼かれる URL は
  `android:sync` 時の `CAPACITOR_SERVER_URL`。PWA の「ホーム画面に追加」は
  実体が Chrome のままなので、画面時間の切り分けには使えない
- Android ビルドは cmdline-tools + JDK。`ANDROID_HOME` の既定は
  `/opt/homebrew/share/android-commandlinetools`。Studio は開けても使わない
- 差し替えたのに古い画面が出る（スーパーリロードだけ通る）なら `vite.config.ts` の
  workbox。`registerType: 'autoUpdate'` だけでは回らない
- 差し替えた直後に画面が真っ白なら `server/index.ts` の SPA フォールバック。
  古い画面が頼むハッシュ付きのファイルはもう無く、`/assets/` の取りこぼしは 404 で返す

## 進め方

CLI のフラグと出力形式は推測で書かず、実際に叩いて確かめてから実装する。
このプロジェクトで実際に踏んだ落とし穴:

- Claude Code は `AGENTS.md` を読まない。cursor-agent は親まで遡って読む
- cursor の `assistant` イベントは、道具を挟むと本文がいくつかの区切りに分かれ、
  区切りの終わりに、そこまでの差分を丸ごと繰り返した言い直しが一つ届く。
  `timestamp_ms` が無いのはいちばん最後の区切りだけで、途中の区切りの言い直しは
  キーも中身の並びも差分とまったく同じ形で来る（`model_call_id` が付く回もあるが、
  付かない回もある）。見分けずにつなぐと、道具を使った回だけ前半が二重になる。
  頼れるのは「それまで流した分と丸ごと同じ」という形だけで、短い区切りでは
  たまたま同じ差分とも区別が付かないため、いったん預かって次の行で決めている
  （`server/agent/cursor.ts` の `assistantSegment`）。`result` が持つのは
  最後の区切りだけなので、本文は区切りをつないだ方を採る
- 途中の様子（何を読んでいるか）は cursor は `tool_call` の `started`、
  Claude Code は `content_block_start` の `tool_use` で分かる。札の文言は
  `server/agent/activity.ts` に集約。道具は増えるので、知らない名前は丸める
- remark-math が独立した式として扱うのは `$$` が行頭と行末に来た形だけ
- CLI の認証をコンテナで永続化するときは、書かれている置き場所を信じる前に、
  ログインした直後の `docker diff` を見る。cursor は二か所に分かれとった
  （`docs/202608-cli-auth-persistence.md`。当てが三回外れた経緯もそこに）
- cursor-agent はヘッドレスでもウェブ検索とページ取得のたびに承認を求め、答える人が
  いないので即 `User Rejected` になる。検索は `cli-config.json` の
  `autoAcceptWebSearch` で通る（`server/agent/cursor-config.ts` が起動のたびに
  書き足す。設定はボリュームの中なのでイメージには焼けない）。ページ取得を通す道は
  `--force` だけで、`permissions` の許可リストは `--print` の経路では見ていない
  （2026.08.04-aaa8809 で確認）。`--force` を足しても ask モードなら書き込みと
  シェルは道具ごと無いままで、増えるのはウェブの読み取りだけ
- Watchtower のログの 403 は、たいてい非公開ではなくイメージがまだ無いだけ。
  引けるかどうかは `ghcr.io/token` で匿名トークンを取ってマニフェストを叩けば分かる
- NAS の管理画面が `docker-compose.yaml` を横に作ることがある。`.yml` と両方あると
  Compose がファイルを決められずに止まる
