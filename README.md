# kokuboke

家族それぞれの AI と話すための、自宅 NAS で動く PWA チャットアプリ。

応答は Anthropic API を直接叩くのではなく、コンテナ内の CLI をヘッドレスで起動して得る。
**Claude Code** と **cursor-agent** のどちらでも動き、トピックごとに使うモデルを選べる。

## 構成

- フロント: Vite + React + TypeScript + Tailwind v4（PWA は `vite-plugin-pwa`）
- サーバー: Hono（静的配信と API を同一プロセスで持つ）
- 実行環境: Docker 一コンテナ、UGREEN NAS（Intel N100 / x86_64）
- 公開: ホストで動く Tailscale の `tailscale serve` 経由

## データの置き場所

コンテナの `/data` に、compose ファイルの隣の `data/` をマウントする。

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

Claude Code は `CLAUDE.md` を、cursor-agent は `AGENTS.md` を、どちらも作業ディレクトリから
親を遡って読む。そこで各フォルダに `AGENTS.md` → `CLAUDE.md` のシンボリックリンクを張ってある。
人格の定義は `CLAUDE.md` 1 か所に置いたまま、どちらのエンジンでも同じ振る舞いになる。
Claude Code は `AGENTS.md` を読まないので二重に読み込まれることはない。

トピックのフォルダを cwd にするだけで、人物の設定とトピックの設定が合成される。

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

## 手元で Docker として動かす

```sh
cp .env.example .env    # DATA_PATH=./data、CPUS と MEM_LIMIT を手元の値に
docker-compose build
docker-compose up -d
curl localhost:3000/api/health
```

colima 環境では `docker compose`（プラグイン版）が解決されないことがある。
その場合は `docker-compose` を使う。

## NAS へのデプロイ

置き場所は NAS の `docker` 共有の下。Mac からは SMB で `/Volumes/docker/kokuboke`
として見える。

**ビルドは NAS 上で行う**。Mac は arm64、NAS は x86_64 で、手元で作ったイメージは
そのままでは動かない。クロスビルドには buildx と QEMU が要るうえ、約 1GB の
イメージを毎回転送することになる。

まず Mac 側で共有へ複製し、`.env` を用意する。

```sh
git clone https://github.com/YusukeKokubo/kokuboke.git /Volumes/docker/kokuboke
cd /Volumes/docker/kokuboke
cp .env.example .env    # USERS を家族の名前に
mkdir -p data
```

続いて NAS 側でビルドして起動する。ここは Mac からは実行できない。
SSH は常時開いていないので、コントロールパネルで期限付きに開けるか、
Docker アプリの端末から実行する。

```sh
ssh <nas>
cd <docker 共有>/kokuboke
./scripts/deploy.sh
```

`scripts/deploy.sh` は、取り込み・ビルド・起動確認・古いイメージの片付けを
まとめてある。`USERS` が空のままなら先に止まる。

`APP_UID` / `APP_GID` は `ls -n data` で確認した所有者に合わせる。
ここがずれるとコンテナがログを書けない。

ビルドは N100 で数分かかる。他のコンテナと重なるとメモリを取り合うので、
込み合う時間帯は避けた方がよい。

リポジトリは公開なので、NAS 側に GitHub の認証情報を置かなくても取り込める。
接続は HTTPS を使う（NAS に SSH 鍵を置かずに済む）。

### 更新するとき

SSH を開けて `./scripts/deploy.sh` を叩くだけでよい。スクリプトの中で
取り込みからビルド、起動確認まで行う。

## 初回だけ必要なこと

### 二つのログイン

会話は既定で Cursor、記憶の更新は Claude Code で走るので、どちらの認証も通しておく。

```sh
docker exec -it kokuboke claude
docker exec -it kokuboke cursor-agent login
```

表示された URL をブラウザで開いて認証する。認証情報はそれぞれ名前付きボリューム
`claude-config`（`~/.claude`）と `cursor-config`（`~/.cursor`）に残るので、
コンテナを作り直しても再ログインは要らない。ボリュームごと消した場合はやり直し。

### Tailscale で公開する

Tailscale はホストネットワークで動いているので、ループバックの 3000 番に前段を張るだけ。

```sh
tailscale serve --bg 3000
```

`https://<マシン名>.<tailnet>.ts.net` で届くようになる。マシン名は Tailscale
コンテナの `hostname` に設定したもの。正規の証明書が付くので、Android の
ブラウザから「ホーム画面に追加」すれば PWA として動く。

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

## モデルの選び方

トピックごとに「どのエンジンのどのモデルで話すか」を持つ。チャット画面のタイトル下に
出ている名前を押すと変えられる。会話の記録と記憶はそのまま引き継がれる。

| | Claude Code | cursor-agent |
| --- | --- | --- |
| 選べるモデル | Opus 5 / Sonnet 5 / Haiku 4.5 | GPT-5.x、Grok、Composer、Claude 各種 |
| 既定のモデル | Opus 5 | おまかせ（auto） |
| 人格の定義 | `CLAUDE.md` を親まで遡って読む | `AGENTS.md` を親まで遡って読む |
| 役割の指示 | `--append-system-prompt` | 本文の先頭に積む |
| 会話中の権限 | ツール単位の許可リストで `Read` だけ | `--mode ask`（読み取り専用) |
| 記憶の更新時 | `Read` `Write` `Edit` だけ許可 | `--force`。ツール単位では絞れない |

新しいトピックの既定は **Cursor のおまかせ**。`DEFAULT_ENGINE` と `CURSOR_MODEL` で変えられる。

権限の粒度は Claude Code の方が細かい。だで**記憶の更新だけは、会話にどのモデルを
選んでいても Claude Code で走らせる**。会話は読み取りだけで済むが、記憶の更新は
ファイルを書き換えるので、絞れる方に寄せておきたい。`SUMMARY_ENGINE=cursor` で
変えられるが、そのときは `--force` になる。

cursor-agent はイメージにも入れてあるが、`cursor-agent login` を一度通す必要がある。
ビルド中の導入で転ぶときや、そもそも要らないときは `.env` に `INSTALL_CURSOR=false`
を書いて deploy.sh を叩き直せば外れる。その場合エンジンは Claude Code だけになる。

## 安全側に倒してあるところ

- 会話中はファイルの読み取りだけ。書き込みもシェル実行もできない。
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
- [x] Step 4 チャット UI

## 画面

- `/user/:user` — トピック一覧。直近に話した順に並び、最後の発言を抜粋で出す。
- `/user/:user/:topic` — チャット。日付の区切り、画像付きの吹き出し、
  返答が届くにつれて伸びていく表示、ヘッダの「記憶を更新」。

返答は Markdown として組む。数式は LaTeX で書かれていれば KaTeX で描画する。
`$…$` と `$$…$$` のほか、`\(…\)` と `\[…\]` も受け付ける。KaTeX は重いので、
数式が出てきた返答でだけ読み込む。

入力欄は文字数に合わせて伸び、写真は 4 枚まで添えられる。送信は送信ボタン、
またはキーボードのある環境なら Ctrl / ⌘ + Enter。スマホでの改行を潰さないよう、
Enter 単独では送らない。
