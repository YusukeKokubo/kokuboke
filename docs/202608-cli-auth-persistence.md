# コンテナを作り直すと CLI のログインが切れる

デプロイのたびに cursor-agent の再ログインを求められる問題を調べた記録。
原因は認証トークンがボリュームの外に置かれていたことで、切り分けには三回の空振りがあった。

## 症状

デプロイした後、会話が動かなくなる。

```
Error: Authentication required. Please run 'agent login' first,
or set CURSOR_API_KEY environment variable.
```

コンテナに入って `cursor-agent login` をやり直せば直る。
ただし次のデプロイでまた同じことになる。

compose では認証の置き場所をボリュームにしてあるはずだった。
残るはずのものが残っていない、というのが最初の見え方である。

## ボリュームの割り当て

名前付きボリュームの実際の名前は「プロジェクト名_ボリューム名」になり、プロジェクト名は既定でディレクトリ名から決まる。
NAS の管理画面から起動したときと `deploy.sh` から起動したときで名前が食い違えば、中身の入ったボリュームが取り残されて空のほうが新しく作られる。
これならログインが消えたように見える。

確かめると外れだった。

```sh
sudo docker volume ls | grep cursor
# local  kokuboke_cursor-config        ← 一つだけ

sudo docker inspect kokuboke --format '{{json .Mounts}}'
# kokuboke_cursor-config → /home/app/.cursor

sudo docker exec kokuboke ls -la /home/app/.cursor
# -rw-r--r-- 1 app app 1680 ... cli-config.json
```

ボリュームは一つしかなく、正しい場所に当たっていて、中のファイルも `app` 持ちで残っていた。
保存の仕組み自体は動いている。
消えているのはファイルではなく、その中のセッションのほうだと分かる。

## cursor-agent の版

Dockerfile を読むと、cursor-agent を導入する行がビルド成果物を複製する行より下にあった。
Docker はある層が変われば下の層をすべて作り直すので、コードを一行直すたびに cursor-agent が入り直す。
版も固定していないから、そのときの最新が入る。
版が上がった拍子に古いセッションが無効になったのではないか。

デプロイの前後で版を控えてもらうと、据え置きのまま切れた。

```
2026.08.04-aaa8809   ← デプロイ前
2026.08.04-aaa8809   ← デプロイ後、それでも再ログインを求められる
```

これも外れである。
ただし層の並びそのものは直す価値があったので、導入をビルド成果物より上に移した。
コードだけの変更で入り直さなくなり、非力な NAS でのビルドもそのぶん短くなる。

## コンテナの同一性

ファイルが残っているのにセッションだけが無効になるなら、認証が環境の何かに紐づいている可能性がある。
コンテナを作り直すとホスト名がその都度新しいコンテナ ID に変わる。

```sh
sudo docker exec kokuboke hostname
# a1418d7ae1ef
sudo docker inspect kokuboke --format '{{.Id}}' | cut -c1-12
# a1418d7ae1ef        ← 同じ。作り直すたびに変わる
```

ここで、ビルドを挟まずにコンテナだけを作り直す実験ができることに気付いた。

```sh
sudo docker compose -f docker-compose.yml up -d --force-recreate
```

イメージもコードも版も動かないので、変わるのはコンテナの同一性だけになる。
結果は、これだけでログインが切れた。
ビルドの側は完全に無関係だと確定した一方、`authInfo` と `authId` はファイルに残ったままだった。

そこで compose にホスト名を書いて固定したが、それでも切れた。
三度目の空振りである。

## 書き込み層に何が増えたか

ここまで三つとも、症状と矛盾しない筋を立てては当てにいっていた。
観察から候補を絞るのではなく、思いついた候補を順に試していたことになる。

`docker diff` はコンテナの書き込み層に増えた差分を出す。
ボリュームはマウントであって書き込み層ではないため、その中身は出てこない。
この性質のおかげで、ログインした直後に叩けば「消える場所に何が書かれたか」がそのまま一覧になる。

```sh
sudo docker exec -it kokuboke cursor-agent login
sudo docker diff kokuboke | grep '^A /home/app'
```

```
A /home/app/.cache
A /home/app/.config
A /home/app/.config/cursor
A /home/app/.config/cursor/auth.json     ← これ
A /home/app/.local/share/cursor-agent/versions/2026.08.04-aaa8809/.running
```

cursor の認証は二か所に分かれていた。
永続化していた `~/.cursor/cli-config.json` にも `authInfo` と `authId` は入っているが、それだけでは足りない。
トークン本体は `~/.config/cursor/auth.json` にある。
ログインの最後に出る「Authentication tokens stored securely」は、この置き場所のことだろう。

三つの空振りが全部説明できる。
ボリュームは正しく当たっていたが、それは別のファイルのボリュームだった。
版もホスト名も、はじめから関係がなかった。

## 直したこと

トークンの置き場所をボリュームにする。
イメージに無いパスにマウントすると Docker が root 持ちでディレクトリを作ってしまうので、受け皿は Dockerfile で先に作って所有者を変えておく。

```yaml
volumes:
  - cursor-config:/home/app/.cursor
  - cursor-auth:/home/app/.config/cursor
```

```dockerfile
RUN mkdir -p /data /home/app/.claude /home/app/.cursor /home/app/.config/cursor \
  && chown -R ${APP_UID}:${APP_GID} /data /home/app
```

切り替えの回だけは、空のボリュームが既存のトークンを隠してしまう。
ログインし直すか、先に退避して戻せばよい。

```sh
sudo docker cp kokuboke:/home/app/.config/cursor/auth.json /tmp/cursor-auth.json
# デプロイ
sudo docker cp /tmp/cursor-auth.json kokuboke:/home/app/.config/cursor/auth.json
sudo docker exec -u 0 kokuboke chown app:app /home/app/.config/cursor/auth.json
```

コンテナは `app` で動いているので `docker exec` も `app` で入る。
所有者の変更には `-u 0` が要る。

## Claude Code 側の同じ穴

同じ疑いで Claude Code も見た。

```sh
sudo docker diff kokuboke | grep '/home/app/\.claude'
# A /home/app/.claude.json
```

設定ファイルがホームの直下に出ていて、ボリュームにしてある `~/.claude` の中ではなかった。
認証そのものは `~/.claude` の中にあるため再ログインは起きていなかったが、置かれ方は cursor と同じ形である。

`CLAUDE_CONFIG_DIR` で寄せられる。
手元のコンテナで、指定すると `~/.claude/.claude.json` に移ってホーム直下には何も残らないことを確認した（Claude Code 2.1.226）。

```yaml
environment:
  CLAUDE_CONFIG_DIR: /home/app/.claude
```

## 次に同じことが起きたら

CLI の認証をコンテナで永続化するときは、ドキュメントに書かれた置き場所を信じる前に、ログインした直後の `docker diff` を見る。
公開されている情報が一か所しか挙げていなくても、実際には複数のディレクトリに分かれていることがある。

作り直しだけを切り離す実験も早めに使いたい。
`--force-recreate` はビルドを挟まないので、イメージの側の変数を一度に全部消せる。
今回は三つ目の仮説を試す途中でようやくこれをやったが、最初にやっていれば版の話は立てずに済んだ。
