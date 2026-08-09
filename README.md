# kokuboke

家族それぞれの AI と話すための、自宅 NAS で動く PWA チャットアプリ。

応答は Anthropic API を直接叩くのではなく、コンテナ内の **Claude Code CLI** をヘッドレスで起動して得る。
ユーザーとトピックのフォルダをそのまま作業ディレクトリにするので、`CLAUDE.md` の読み込みと
ログの書き込みは CLI 側の機能に乗る。

## 構成

- フロント: Vite + React + TypeScript + Tailwind v4（PWA は `vite-plugin-pwa`）
- サーバー: Hono（静的配信と API を同一プロセスで持つ）
- 実行環境: Docker 一コンテナ、UGREEN NAS（Intel N100 / x86_64）
- 公開: ホストで動く Tailscale の `tailscale serve` 経由

## データの置き場所

NAS の `/volume1/docker/kokuboke/data` をコンテナの `/data` にマウントする。

```
/data
└── taro/
    ├── CLAUDE.md              人物の設定（手書き・全トピック共通）
    ├── profile.md             全トピック共通の要約（自動追記）
    └── topics/
        └── math/
            ├── topic.json     表示名・絵文字・作成日
            ├── CLAUDE.md      このトピックでの振る舞い
            ├── summary.md     このトピックの要約
            ├── logs/          YYYYMMDD.md（閲覧用） / YYYYMMDD.jsonl（読み戻し用）
            └── images/        YYYYMMDD_HHMMSS.jpg
```

Claude Code は作業ディレクトリの `CLAUDE.md` を読むとき親ディレクトリも遡るので、
トピックのフォルダを cwd にするだけで人物の設定とトピックの設定が合成される。

## 開発

```sh
mise install          # Node 22
npm install
cp .env.example .env
npm run dev           # http://localhost:5173（API は 3000 で並走）
```

その他のコマンド。

```sh
npm run typecheck
npm run build         # dist/client と dist/server を吐く
npm start             # ビルド済みを本番モードで起動
node scripts/generate-icons.mjs   # public/favicon.svg から PWA アイコンを再生成
```

## NAS へのデプロイ

N100 でのビルドは遅く、同居コンテナとメモリを取り合うので、**Mac 側でビルドして
イメージを送り込む**。

```sh
# 1. amd64 向けにビルド
docker buildx build --platform linux/amd64 -t kokuboke:latest --load .

# 2. 固めて NAS に送る
docker save kokuboke:latest | gzip > kokuboke.tar.gz
scp kokuboke.tar.gz nas:/volume1/docker/kokuboke/

# 3. NAS 側で読み込んで起動
ssh nas
cd /volume1/docker/kokuboke
gunzip -c kokuboke.tar.gz | docker load
docker compose up -d --no-build
```

`.env` は NAS 側の `/volume1/docker/kokuboke/.env` に置く。`APP_UID` / `APP_GID` は
`ls -n /volume1/docker/kokuboke/data` で確認した所有者に合わせる。ここがずれると
コンテナがログを書けない。

## 初回だけ必要なこと

### Claude Code のログイン

サブスクリプションの認証情報は名前付きボリューム `claude-config` に残るので、一度だけ通せばよい。

```sh
docker exec -it kokuboke claude
```

表示された URL をブラウザで開いて認証する。以降はコンテナを作り直しても再ログインは要らない。
ボリュームごと消した場合はやり直し。

### Tailscale で公開する

Tailscale はホストネットワークで動いているので、ループバックの 3000 番に前段を張るだけ。

```sh
tailscale serve --bg 3000
```

`https://<マシン名>.<tailnet>.ts.net` で届くようになる。正規の証明書が付くので、
Android のブラウザから「ホーム画面に追加」すれば PWA として動く。

## API

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/api/health` | 稼働確認と同時実行の状況 |
| GET | `/api/templates` | トピック作成時に選べる雛形 |
| GET | `/api/users/:user/topics` | トピック一覧（直近に話した順） |
| POST | `/api/users/:user/topics` | トピック作成 |
| GET | `/api/users/:user/topics/:topic/messages` | 直近の会話（既定 3 日分） |
| POST | `/api/users/:user/topics/:topic/messages` | 送信。SSE で返答を流す |
| POST | `/api/users/:user/topics/:topic/summary` | 記憶の更新。SSE で経過を流す |
| GET | `/media/:user/:topic/:file` | 保存済み画像 |

送信は `multipart/form-data` で、本文が `text`、画像が `images`（4 枚まで）。

## 安全側に倒してあるところ

- 会話中に許可するツールは `Read` だけ。`Bash` などは許可リストとは別に明示的に禁止している。
- 書き込みが要るのは記憶の更新のときだけで、そのときも触れる範囲をユーザーのフォルダに限る。
- ユーザー名は `USERS` に列挙したものだけ、トピック名は英数字とハイフンだけを受け付ける。
  組み立てたパスがデータディレクトリの外に出ていないかを最後にもう一度確かめる。
- 同じ人からの多重送信は待たせずに 409 で返す。全体の同時実行数は `MAX_CONCURRENT` で頭打ちにする。

## 開発時の注意

Mac で `npm run dev` すると、Claude Code が開発者自身の `~/.claude/CLAUDE.md` も読み込む。
`/data` 側の設定だけを効かせたい場合は、その内容が混ざっていないか確認すること。
コンテナでは `HOME=/home/app` になるのでこの混入は起きない。

## 実装の進み具合

- [x] Step 1 構成・ディレクトリ・Docker の設計
- [x] Step 2 パッケージと基本セットアップ
- [x] Step 3 ファイルベースの読み書きと Claude Code 実行
- [ ] Step 4 チャット UI
