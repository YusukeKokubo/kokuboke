import type { Message } from '../../shared/types'
import { localTime } from '../../shared/date'

const MAX_HISTORY_CHARS = 20_000

function renderHistory(messages: Message[]): string {
  if (messages.length === 0) return '（このトピックでの会話はまだありません）'

  const lines = messages.map((m) => {
    const who = m.role === 'user' ? (m.author ?? '本人') : 'あなた'
    const time = localTime(new Date(m.at))
    const attached = m.images.length > 0 ? `（画像 ${m.images.length} 枚）` : ''
    return `[${m.at.slice(5, 10)} ${time}] ${who}${attached}: ${m.text}`
  })

  // 長くなりすぎたら古い方から落とす。直近のやりとりの方が効く。
  let text = lines.join('\n')
  while (text.length > MAX_HISTORY_CHARS && lines.length > 1) {
    lines.shift()
    text = lines.join('\n')
  }
  return text
}

/**
 * 誰と話しているか。個人のスペースは本人と一対一で、共有スペースは家族の複数人。
 * ここが唯一の違いなので、プロンプトは一本で済む。
 */
export type Audience = { kind: 'personal'; user: string } | { kind: 'family' }

export function chatSystemPrompt(input: { audience: Audience; topicName: string }): string {
  // 名前なしで始めたトピックでは、まだ見出しが決まっていない。
  const where = input.topicName
    ? `いまのトピックは「${input.topicName}」です。`
    : 'いまのトピックにはまだ名前が付いていません。'

  const [place, who] =
    input.audience.kind === 'family'
      ? [
          'の家族共有スペース',
          `- 家族みんなが使う共有の場です。${where}
- 会話には複数の家族メンバーの発言が混ざります。誰が何を言ったかを踏まえて答えてください。`,
        ]
      : ['', `- 話し相手は「${input.audience.user}」さん。${where}`]

  return `あなたは家族向けのチャットアプリ${place}の中で応答しています。

${who}
- 返答はスマートフォンのチャットの吹き出しに表示されます。話し言葉で簡潔に書いてください。
- Markdown として整形されます。強調、箇条書き、表、コードブロックは使えます。
  ただし画面が狭いので、見出しや入り組んだ表は控えめに。
- 数式は LaTeX で書けます。文中に混ぜるときは $...$、行を分けて見せたいときは $$...$$
  で囲んでください。式が主役になる説明では、素の文字で書くより読みやすくなります。
- ファイルの作成・編集・削除はしないでください。読み取りだけ行えます。
- 添付画像がある場合は、示された絶対パスを Read ツールで開いて内容を踏まえて答えてください。
- 「承知しました」のような前置きや、返答の要約は書かないでください。本文だけを返します。`
}

export function chatPrompt(input: {
  /** スペース直下の profile.md。無ければ空文字。 */
  profile: string
  /** 付いているタグの覚え書き。無ければ空。 */
  tags: { name: string; text: string }[]
  history: Message[]
  text: string
  /** 共有スペースの発言者。個人のスペースでは付かない。 */
  author?: string
  imagePaths: string[]
}): string {
  const parts: string[] = []

  if (input.profile.trim()) {
    parts.push(`<profile>\n${input.profile.trim()}\n</profile>`)
  }
  for (const tag of input.tags) {
    if (!tag.text.trim()) continue
    parts.push(`<tag name="${tag.name}">\n${tag.text.trim()}\n</tag>`)
  }

  parts.push(`<conversation>\n${renderHistory(input.history)}\n</conversation>`)

  const body = input.text.trim() || '（本文なし）'
  const current: string[] = [input.author ? `${input.author}: ${body}` : body]
  if (input.imagePaths.length > 0) {
    current.push('', '添付画像（Read ツールで開いてください）:')
    for (const p of input.imagePaths) current.push(`- ${p}`)
  }
  parts.push(`<current_message>\n${current.join('\n')}\n</current_message>`)

  parts.push('上のメッセージに対する返答だけを書いてください。')

  return parts.join('\n\n')
}

export function nameSystemPrompt(): string {
  return `あなたは会話に短い見出しを付ける係です。

- ファイルは読み書きしません。見出しを決めるところまでが仕事です。
- 前置き・説明・報告は書かないでください。返すのは指定された JSON 一つだけです。`
}

export function namePrompt(input: { history: Message[]; currentName?: string }): string {
  const refine = input.currentName
    ? `いまの名前は「${input.currentName}」です。会話を踏まえて、このままでよければ同じ名前を、より適切なら付け直してください。`
    : 'この会話に名前を付けてください。'

  return `<conversation>
${renderHistory(input.history)}
</conversation>

${refine}

- 何の話かがひと目で分かる、12 文字くらいまでの短い名前にします。
- 「〜について」「〜の話」のような言い回しは付けません。
- 記号や引用符は使わず、短い言葉にします。

次の形の JSON だけを返してください。
{"name": "見出し"}`
}

export function tagSystemPrompt(): string {
  return `あなたは会話に大分類のタグを付ける係です。

- タグは会話の見出しではなく、また話すテーマの覚え書きです。同じタグの会話をまたいで積みます。
- 大分類だけで足ります。中分類や小分類は作りません。
- ファイルは読み書きしません。タグを決めるところまでが仕事です。
- 前置き・説明・報告は書かないでください。返すのは指定された JSON 一つだけです。`
}

/** 既存タグの本文から、分類の手がかりになる一行を取る。 */
export function tagNote(text: string): string | undefined {
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  return line.slice(0, 40)
}

function formatKnownTag(tag: { name: string; note?: string; group?: string }): string {
  const shelf = tag.group ? `（${tag.group}）` : ''
  return tag.note ? `- ${tag.name}${shelf}: ${tag.note}` : `- ${tag.name}${shelf}`
}

export function tagPrompt(input: {
  history: Message[]
  known: { name: string; note?: string; group?: string }[]
  topicName?: string
}): string {
  const known = input.known.length > 0 ? input.known.map(formatKnownTag).join('\n') : '（まだ無い）'
  const aboutName = input.topicName
    ? `いまの会話名は「${input.topicName}」です。これをタグ名にしないでください。\n\n`
    : ''

  return `<conversation>
${renderHistory(input.history)}
</conversation>

<known_tags>
${known}
</known_tags>

${aboutName}この会話に大分類のタグを付けてください。

- 既にある大分類で当たるなら、それを使います。新しくは作りません。
- 新しいタグを足してよいのは、これから何度も話しそうな大分類がまだ無いときだけです。
- 会話の見出しや一度きりの出来事はタグにしません。
  「大英博物館展予習」なら「美術館博物館巡り」です。「大英博物館展」は付けません。
  「四国の宿を探す」なら「旅行」です。
- 一度きりの質問や雑談には付けません。空の配列にします。
- 1 つまで。どうしても二つ必要なときだけ 2 つ。3 つは付けません。
- 記号や引用符は使いません。
- 新しいタグには、内容に合う絵文字を一つと、一覧用の棚を付けます。
  既にある棚で当たるならそれを使い、無ければ新しい棚名を付けてよいです。
- 既にあるタグの絵文字は変えません。

次の形の JSON だけを返してください。
{"tags": [{"name": "美術館博物館巡り", "emoji": "🖼️", "group": "文化"}]}`
}

export function tagDraftSystemPrompt(input: { audience: Audience; tagName: string }): string {
  const whose =
    input.audience.kind === 'family' ? '家族共有スペースの' : `「${input.audience.user}」さんの`
  const mixed = input.audience.kind === 'family' ? '\n- 会話には複数の家族メンバーの発言が混ざります。' : ''

  return `あなたは会話の記録を整理する係です。

- 対象は${whose}「${input.tagName}」タグです。${mixed}
- ファイルは書き換えません。新しい本文の全文を返すところまでが仕事です。
  保存するかどうかは人が決めます。
- 前置き・説明・報告は書かないでください。返すのは本文だけです。`
}

export function tagDraftPrompt(input: {
  tagName: string
  current: string
  chats: { name: string; history: Message[] }[]
}): string {
  const parts: string[] = []

  if (input.current.trim()) {
    parts.push(`<current>\n${input.current.trim()}\n</current>`)
  }

  const blocks = input.chats.map((chat) => {
    const body = [`<chat>`, `<name>${chat.name}</name>`]
    if (chat.history.length > 0) {
      body.push(`<conversation>\n${renderHistory(chat.history)}\n</conversation>`)
    }
    body.push(`</chat>`)
    return body.join('\n')
  })

  while (blocks.join('\n\n').length > MAX_HISTORY_CHARS && blocks.length > 1) {
    blocks.pop()
  }
  if (blocks.length > 0) {
    parts.push(`<chats>\n${blocks.join('\n\n')}\n</chats>`)
  }

  parts.push(`上の会話を踏まえて、「${input.tagName}」タグの覚え書きを書き直してください。

- すでに書かれている内容は消さずに、変わったところだけ直し、新しく分かったことを足します。
- 個々のやりとりを列挙するのではなく、続けて話すために必要な事実と経緯を残します。
- 会話のたびに読み込まれるので、簡潔に保ってください。
- そのままファイルに保存できる形で、本文だけを返します。全体をコードブロックで
  囲まないでください。`)

  return parts.join('\n\n')
}

export function organizeSystemPrompt(): string {
  return `あなたはタグ一覧を大分類へ寄せる係です。

- タグは会話の見出しではなく、また話すテーマの覚え書きです。大分類だけで足ります。
- 棚は一覧の見出しです。本文は持ちません。
- ファイルは書き換えません。提案の JSON を返すところまでが仕事です。
- 前置き・説明・報告は書かないでください。返すのは指定された JSON 一つだけです。`
}

export function organizePrompt(input: {
  tags: { name: string; group: string; note?: string; topics: string[] }[]
}): string {
  const lines =
    input.tags.length > 0
      ? input.tags
          .map((tag) => {
            const shelf = tag.group || '棚なし'
            const chats = tag.topics.length > 0 ? tag.topics.join('、') : '会話なし'
            const note = tag.note ? ` / ${tag.note}` : ''
            return `- ${tag.name}（${shelf}）会話: ${chats}${note}`
          })
          .join('\n')
      : '（まだ無い）'

  return `<tags>
${lines}
</tags>

この一覧を大分類へ寄せる提案をしてください。

- 会話名まがいを大分類へ寄せます。「大英博物館展」なら「美術館博物館巡り」です。
- 既にある大分類で足りるなら、そちらへ寄せます。新しい大分類は、これから何度も話しそうなテーマが無いときだけです。
- 棚を付ける・寄せます。「生活」と「暮らし」が並んでいたら一つにします。
- 使っていない一度きりのタグは消す候補にします。会話が付いているタグは、寄せずに消さないでください。
- 直さなくてよいものは出しません。空の配列にしてよいです。

次の形の JSON だけを返してください。
{"actions":[{"type":"merge","from":"大英博物館展","to":"美術館博物館巡り"},{"type":"shelf","name":"美術館博物館巡り","group":"文化"},{"type":"remove","name":"動作確認用"}]}`
}
