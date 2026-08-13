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
    ├── profile.md             全トピック共通の覚え書き（手書き）
    └── topics/
        └── スキンケア/          トップレベル。ここでは話さない
            ├── topic.json     表示名・絵文字・作成日
            ├── CLAUDE.md      下のどれで話しても効く
            ├── summary.md     共有の記憶（画面から読み書きする）
            └── 肌の記録/        ここで話す
                ├── topic.json
                ├── CLAUDE.md   このトピックでの振る舞い
                ├── summary.md  この話に閉じた覚え書き
                ├── logs/       YYYYMMDD.md（閲覧用） / YYYYMMDD.jsonl（読み戻し用）
                └── images/     YYYYMMDD_HHMMSS.jpg
```

階層は二段で固定。トップレベルは `CLAUDE.md` と `summary.md` を置く器で、会話は必ず
その中のトピックで行う。共有したい前提を上に、その話に閉じた記憶を下に置くと、
中のどれで話しても上の記憶が一緒に読み込まれる。器では話さないので、
`logs/` と `images/` も作らない。

## 名前は後から付く

器の「＋」から始めたトピックには名前がない。`topic.json` の `name` は空で、
フォルダは `untitled-20260809-2242` のような仮の名前になる。本人が三回話したところで
会話を読ませ、短い名前と絵文字を付けてフォルダごと改名する。同じ器の中で名前が
ぶつかったら、末尾に `-2` を足して避ける。

命名に使うのは記憶と同じエンジン・モデル（`SUMMARY_ENGINE` / `SUMMARY_MODEL`）。
一度走らせたら `topic.json` に `nameTried` が立ち、名前が付かなくても二度は試さない。
気に入らなければ、チャット画面のタイトルを押していつでも変えられる。

改名するとフォルダ名が変わり、URL と画像の経路もそこに乗っているので変わる。
画面は返ってきた `slug` で経路を差し替える。

Claude Code は `CLAUDE.md` を、cursor-agent は `AGENTS.md` を、どちらも作業ディレクトリから
親を遡って読む。そこで各フォルダに `AGENTS.md` → `CLAUDE.md` のシンボリックリンクを張ってある。
人格の定義は `CLAUDE.md` 1 か所に置いたまま、どちらのエンジンでも同じ振る舞いになる。
Claude Code は `AGENTS.md` を読まないので二重に読み込まれることはない。

トピックのフォルダを cwd にするだけで、人物の設定とトピックの設定が合成される。

フォルダ名はトピックの名前そのもので、日本語も使える。パスの区切りになる文字と、
SMB で扱えない文字（`: * ? " < > |`）だけを弾く。NAS を覗いたときに中身が分かるように、
別の識別子は持たせていない。フォルダを改名すれば URL も変わる。表示名も揃えるなら
`topic.json` の `name` も直す。

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
npm test              # server/store/ の読み書きとパスの検査
npm run build         # dist/client と dist/server を吐く
npm start             # ビルド済みを本番モードで起動
npm run android:sync  # Capacitor Android へ同期（CAPACITOR_SERVER_URL 必須）
npm run android:sdk   # cmdline-tools に platform / build-tools を入れる（初回）
npm run android:apk   # sync して debug APK を作る
node scripts/generate-icons.mjs   # public/favicon.svg から PWA アイコンを再生成
```

## 手元で Docker として動かす

```sh
cp .env.example .env    # CPUS と MEM_LIMIT を手元の値に下げる
docker-compose build
docker-compose up -d
curl localhost:3000/api/health
```

`.env` はコンテナにそのまま渡している。機械ごとの値（`CPUS` `MEM_LIMIT`
`MAX_CONCURRENT` `BIND_ADDR`）は雛形の後半にまとめてあり、前半はアプリの設定。
コンテナでの置き場所など、`.env` で上書きされては困るものは compose 側で押さえてある。

colima 環境では `docker compose`（プラグイン版）が解決されないことがある。
その場合は `docker-compose` を使う。

## NAS へのデプロイ

置き場所は NAS の `docker` 共有の下。Mac からは SMB で `/Volumes/docker/kokuboke`
として見える。

**ビルドは GitHub Actions が行う**。main に push すると x86_64 のイメージを作って
`ghcr.io/yusukekokubo/kokuboke:latest` に置く。NAS はそれを引っ張るだけで、
N100 で数分かけてビルドすることはない。Mac は arm64 なので手元で作ったイメージは
NAS では動かず、クロスビルドには buildx と QEMU が要る。ランナーは元から
amd64 なので、そこを借りるのがいちばん速い。

まず Mac 側で共有へ複製し、`.env` を用意する。

```sh
git clone https://github.com/YusukeKokubo/kokuboke.git /Volumes/docker/kokuboke
cd /Volumes/docker/kokuboke
cp .env.example .env    # USERS、ADMIN_TOKEN、WATCHTOWER_TOKEN を埋める
mkdir -p data
```

鍵は二つとも `openssl rand -hex 24` で作る。`ADMIN_TOKEN` は更新の画面を開くため、
`WATCHTOWER_TOKEN` はその画面から Watchtower に頼むためのもの。

続いて NAS 側で起動する。SSH は常時開いていないので、コントロールパネルで
期限付きに開けるか、Docker アプリの端末から実行する。ここを通るのは初回と、
`docker-compose.yml` を直したときだけ。

```sh
ssh <nas>
cd <docker 共有>/kokuboke
sudo ./scripts/deploy.sh
```

`scripts/deploy.sh` は、取り込み・イメージの取得・起動確認・古いイメージの
片付けをまとめてある。`USERS` か `WATCHTOWER_TOKEN` が空のままなら先に止まる。

`sudo` を付けるのは、この NAS では一般ユーザーが `/var/run/docker.sock` に
届かないため。

コンテナは UID 1000 で動く。`ls -n data` の所有者がそれと違うとログを書けないので、
ずれていたら `sudo chown -R 1000:1000 data` で合わせる。
イメージ側は固定にしてある。機械ごとの値を焼き込むと、同じイメージを別の機械へ
持っていけなくなるため。

リポジトリは公開なので、NAS 側に GitHub の認証情報を置かなくても取り込める。
接続は HTTPS を使う（NAS に SSH 鍵を置かずに済む）。

GHCR のイメージも同じで、Actions が `GITHUB_TOKEN` で押したパッケージは
リポジトリに紐づき、公開リポジトリなら匿名で引ける。NAS に GHCR への
ログインは要らない（2026-08 に、認証なしでマニフェストが取れることを確認）。

Watchtower のログに 403 が出るときは、まだ一度もビルドが通っていないか、
パッケージが非公開になっている。GitHub のパッケージのページで visibility を
確かめる。

### 更新するとき

push して、`https://<マシン名>.<tailnet>.ts.net/admin?key=<ADMIN_TOKEN>` を開いて
ボタンを押す。SSH は要らない。

画面には動いている版と main のずれ、間のコミット、更新のボタンがある。鍵は
一度開けばその端末に残る。合わない鍵では画面ごと 404 になる。押すと同居している
Watchtower が GHCR から引っ張って、同じ設定・同じボリュームでコンテナを作り直す。

定期の見回りはさせていない。話している最中に入れ替わると返事の流れが切れるので、
いつ入れ替えるかは人が決める。押すまでは古いまま動き続けるだけで、放っておいて
困ることはない。

文書だけを直した回は、ワークフローがビルドを飛ばすのでイメージは変わらない。
画面もそう出してボタンを出さない。無視する範囲を変えるときは、ワークフローの
`paths-ignore` と `server/routes/admin.ts` の判定を揃える。

自分で自分を入れ替えることはできない（止める処理ごと死ぬ）ので、差し替える役は
Watchtower に任せている。アプリには `docker.sock` を渡さず、「今見に行け」と
頼む口だけを通す。押したあと画面は少しつながらなくなり、別のコミットで
戻ってきたら成功と分かる。

**`docker-compose.yml` を直した回だけは SSH が要る。** Watchtower が差し替えるのは
イメージだけで、環境変数やメモリの上限といったコンテナの設定は今のものを
引き継ぐ。設定を変えた回は見た目は正常に上がってくるので、更新の画面が
「compose の変更が入っている」と出したときは `sudo ./scripts/deploy.sh` を叩く。

CLI の版は Dockerfile で固定してある（`CLAUDE_VERSION` / `CURSOR_VERSION`）。
CI は毎回まっさらな環境でビルドするので、固定しないと push のたびに CLI が
上がり、そのたびにサブスクリプションのログインが切れる。上げたいときは
Dockerfile を書き換えて、下の「二つのログイン」をやり直す。

## 初回だけ必要なこと

### 二つのログイン

会話は既定で Cursor、記憶の更新は Claude Code で走るので、どちらの認証も通しておく。

```sh
sudo docker exec -it kokuboke claude
sudo docker exec -it kokuboke cursor-agent login
```

表示された URL をブラウザで開いて認証する。認証情報は名前付きボリュームに残るので、
コンテナを作り直しても再ログインは要らない。ボリュームごと消した場合はやり直し。

cursor は置き場所が二つに分かれていて、`~/.cursor` に設定と履歴、
`~/.config/cursor/auth.json` にトークン本体が入る。両方をボリュームにしてある。
ここに行き着くまでの切り分けは `docs/202608-cli-auth-persistence.md` に残してある。

### Tailscale で公開する

Tailscale はホストネットワークで動いているので、ループバックの 3000 番に前段を張るだけ。

```sh
tailscale serve --bg 3000
```

`https://<マシン名>.<tailnet>.ts.net` で届くようになる。マシン名は Tailscale
コンテナの `hostname` に設定したもの。正規の証明書が付く。

誰の画面かは `/user/名前` という URL でしか区別していない。この URL そのものが鍵なので、
誰がいるかを答える API は置いていない。名前の一覧も出さない。入口では自分の名前を
手で入れるか、名前入り URL を直接開く。

Android で Chrome を時間制限したまま使いたいときは、下の Capacitor シェルを使う。
ブラウザの「ホーム画面に追加」（PWA）でも見た目はアプリになるが、実体は Chrome の
ままなので画面時間の制限を一緒に受ける。

### Android アプリ（Capacitor）

別パッケージ `app.kokuboke` の WebView で、上の Tailscale URL を開く薄い殻。
UI と API は NAS 上のままなので、サーバーを更新すればアプリも追従する。
Android Studio は不要。JDK と command line tools だけで APK を出す。

一度だけ入れるもの:

```sh
brew install openjdk@21 android-commandlinetools
# Java を macOS に認識させる（案内に出る通り）
sudo ln -sfn /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk \
  /Library/Java/JavaVirtualMachines/openjdk-21.jdk

# platform / build-tools / ライセンス
mise exec -- npm run android:sdk
```

`.env` に家庭の URL を書く（末尾スラッシュなし）:

```
CAPACITOR_SERVER_URL=https://<マシン名>.<tailnet>.ts.net
```

APK を作る:

```sh
mise exec -- npm run android:apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

端末へは `adb install -r` か、ファイルを渡してサイドロード。初回起動で名前を
入れると、その端末の localStorage に残る。アイコンを差し替えるときは
`mise exec -- npm run android:icons` のあと、もう一度 `android:apk`。

Chrome の Digital Wellbeing / ファミリーリンクでは Chrome だけ制限し、kokuboke は
制限なしにする。

環境変数の既定（Homebrew 前提）:

- `JAVA_HOME` … 未設定なら `openjdk@21` か `java_home -v 21`
- `ANDROID_HOME` … 未設定なら `/opt/homebrew/share/android-commandlinetools`

ただし Android の Chrome で PWA をホーム画面に貼るときも manifest の `start_url` を
採るので、貼った URL のうち `/user/名前` が落ちて `/` から始まってしまう。そこで、
一度開けた名前だけをその端末の localStorage に残しておいて、`/` に着いたらそこへ
送り返している（アプリの名前入力も同じ仕組み）。

## API

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/api/health` | 稼働確認と同時実行の状況 |
| GET | `/api/templates` | トピック作成時に選べる雛形 |
| GET | `/api/engines` | 選べるエンジンとモデルの一覧 |
| GET | `/api/users/:user/topics` | トピック一覧（直近に話した順）。中のトピックは `children` に入る |
| POST | `/api/users/:user/topics` | トップレベル（器）の作成 |
| POST | `/api/users/:user/topics/:topic/sub` | そのトピックの中に作る。話せるのはこちら。`name` は省略できる |
| PATCH | `/api/users/:user/topics/:topic` | エンジンとモデル、または名前と絵文字を変える |
| POST | `/api/users/:user/topics/:topic/name` | 会話を読ませて名前を付ける。付いた名前で改名まで行う |
| GET | `/api/users/:user/topics/:topic/messages` | 保存されている会話すべて |
| POST | `/api/users/:user/topics/:topic/messages` | 送信。SSE で返答を流す |
| GET | `/api/users/:user/topics/:topic/memory` | 記憶（`summary.md`）を読む |
| PUT | `/api/users/:user/topics/:topic/memory` | 記憶を保存する。書き換えはここだけ |
| POST | `/api/users/:user/topics/:topic/summary` | 記憶の下書きを作らせる。SSE で流す（保存はしない） |
| GET | `/api/users/:user/profile` | プロフィール（`profile.md`）を読む |
| PUT | `/api/users/:user/profile` | プロフィールを保存する |
| GET | `/api/users/:user/claude` | 話し方（ユーザーの `CLAUDE.md`）を読む |
| PUT | `/api/users/:user/claude` | 話し方を保存する |
| GET | `/api/users/:user/topics/:topic/claude` | 振る舞い（トピックの `CLAUDE.md`）を読む |
| PUT | `/api/users/:user/topics/:topic/claude` | 振る舞いを保存する |
| GET | `/media/:user/:topic/:file` | 保存済み画像 |

トピックを指す経路はどれも、`:topic` のうしろに `/sub/:sub` を足すと中で分けたほうを指す。
たとえば `/api/users/taro/topics/スキンケア/sub/肌の記録/messages`。画像も
`/media/:user/:topic/sub/:sub/:file` になる。トップレベルへの送信は 400 を返す。

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
| 権限 | ツール単位の許可リストで `Read` だけ | `--mode ask`（読み取り専用) |

新しいトピックの既定は **Cursor のおまかせ**。`DEFAULT_ENGINE` と `CURSOR_MODEL` で変えられる。

会話も記憶の整理も読み取りだけで走る。記憶を整理させるときのモデルは「記憶」の画面で
その場で選べて、選ばなければ `SUMMARY_ENGINE` と `SUMMARY_MODEL` の既定に落ちる。
既定は Claude Code の Sonnet で、会話より軽いモデルを充てている。

cursor-agent はイメージにも入れてあるが、`cursor-agent login` を一度通す必要がある。
ビルド中の導入で転ぶときや、そもそも要らないときは `.env` に `INSTALL_CURSOR=false`
を書いて deploy.sh を叩き直せば外れる。その場合エンジンは Claude Code だけになる。

## 安全側に倒してあるところ

- AI に渡すのはファイルの読み取りだけ。会話でも記憶の整理でも、書き込みもシェル実行もできない。
- 記憶を整理させても、返ってくるのは新しい本文の案だけ。人が確かめて保存を押したときに、
  サーバーが `summary.md` を書き換える。承認しなければ何も起きない。
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
  返答が届くにつれて伸びていく表示、ヘッダの「記憶」。

「記憶」はそのトピックの `summary.md` を開く画面。そのまま手で直せるし、モデルを選んで
AI に整理させることもできる。AI が返すのは案で、保存を押すまでファイルは変わらない。
気に入らなければ「元に戻す」で開いたときの内容に戻る。

返答は Markdown として組む。数式は LaTeX で書かれていれば KaTeX で描画する。
`$…$` と `$$…$$` のほか、`\(…\)` と `\[…\]` も受け付ける。KaTeX は重いので、
数式が出てきた返答でだけ読み込む。

入力欄は文字数に合わせて伸び、写真は 4 枚まで添えられる。送信は送信ボタン、
またはキーボードのある環境なら Ctrl / ⌘ + Enter。スマホでの改行を潰さないよう、
Enter 単独では送らない。
