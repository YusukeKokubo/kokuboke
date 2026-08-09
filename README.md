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

## 実装の進み具合

- [x] Step 1 構成・ディレクトリ・Docker の設計
- [x] Step 2 パッケージと基本セットアップ
- [ ] Step 3 ファイルベースの読み書きと Claude Code 実行
- [ ] Step 4 チャット UI
