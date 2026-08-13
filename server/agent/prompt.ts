import type { Message } from '../../shared/types'
import { localTime } from '../store/date'

const MAX_HISTORY_CHARS = 20_000

function renderHistory(messages: Message[]): string {
  if (messages.length === 0) return '（このトピックでの会話はまだありません）'

  const lines = messages.map((m) => {
    const who = m.role === 'user' ? '本人' : 'あなた'
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

export function chatSystemPrompt(input: { user: string; topicName: string }): string {
  // 名前なしで始めたトピックでは、まだ見出しが決まっていない。
  const where = input.topicName
    ? `いまのトピックは「${input.topicName}」です。`
    : 'いまのトピックにはまだ名前が付いていません。'

  return `あなたは家族向けのチャットアプリの中で応答しています。

- 話し相手は「${input.user}」さん。${where}
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
  profile: string
  /** 親トピックの記憶。中で分けているときだけ入る。 */
  groupSummary: string
  summary: string
  history: Message[]
  text: string
  imagePaths: string[]
}): string {
  const parts: string[] = []

  if (input.profile.trim()) {
    parts.push(`<profile>\n${input.profile.trim()}\n</profile>`)
  }
  if (input.groupSummary.trim()) {
    parts.push(`<group_memory>\n${input.groupSummary.trim()}\n</group_memory>`)
  }
  if (input.summary.trim()) {
    parts.push(`<topic_memory>\n${input.summary.trim()}\n</topic_memory>`)
  }

  parts.push(`<conversation>\n${renderHistory(input.history)}\n</conversation>`)

  const current: string[] = [input.text.trim() || '（本文なし）']
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

export function namePrompt(input: { history: Message[]; groupName: string }): string {
  return `<conversation>
${renderHistory(input.history)}
</conversation>

この会話に名前を付けてください。「${input.groupName}」の中に並ぶ見出しになります。

- 何の話かがひと目で分かる、12 文字くらいまでの短い名前にします。
- 「${input.groupName}」自体の言い換えは避け、この会話に固有の中身を拾ってください。
- 「〜について」「〜の話」のような言い回しは付けません。
- 記号や引用符は使わず、そのままフォルダ名にできる言葉にします。
- 内容に合う絵文字を一つ選びます。

次の形の JSON だけを返してください。
{"name": "見出し", "emoji": "🍳"}`
}

export function summarySystemPrompt(input: {
  user: string
  topicName: string
  /** 器の共有記憶を書くとき。会話は中のトピック側にある。 */
  group?: boolean
}): string {
  const where = input.group
    ? `対象は「${input.user}」さんの「${input.topicName}」トピックです。ここは会話をしない器で、中のどれで話しても共有したい前提を残します。`
    : `対象は「${input.user}」さんの「${input.topicName}」トピックです。`

  return `あなたは会話の記録を整理する係です。

- ${where}
- ファイルは書き換えません。新しい summary.md の全文を返すところまでが仕事です。
  保存するかどうかは人が決めます。
- 前置き・説明・報告は書かないでください。返すのは summary.md の中身だけです。`
}

export function summaryPrompt(input: {
  history: Message[]
  topicName: string
  summary: string
  /** 親トピックの記憶。書き換える対象ではなく、重複を避けるための参考。 */
  groupSummary: string
}): string {
  const parts: string[] = []

  if (input.groupSummary.trim()) {
    parts.push(
      `<group_memory>\n${input.groupSummary.trim()}\n</group_memory>`,
      'これは一つ上のトピックの記憶です。書き換える対象ではありません。' +
        'ここに既に書かれていることは繰り返さないでください。',
    )
  }
  if (input.summary.trim()) {
    parts.push(`<current_summary>\n${input.summary.trim()}\n</current_summary>`)
  }

  parts.push(`<conversation>\n${renderHistory(input.history)}\n</conversation>`)

  parts.push(`上の会話を踏まえて、「${input.topicName}」トピックの summary.md を書き直してください。

- すでに書かれている内容は消さずに、変わったところだけ直し、新しく分かったことを足します。
- 個々のやりとりを列挙するのではなく、続けて話すために必要な事実と経緯を残します。
- 会話のたびに読み込まれるので、簡潔に保ってください。
- そのままファイルに保存できる形で、本文だけを返します。全体をコードブロックで
  囲まないでください。`)

  return parts.join('\n\n')
}

export function groupSummaryPrompt(input: {
  topicName: string
  summary: string
  children: { name: string; summary: string; history: Message[] }[]
}): string {
  const parts: string[] = []

  if (input.summary.trim()) {
    parts.push(`<current_summary>\n${input.summary.trim()}\n</current_summary>`)
  }

  const blocks = input.children.map((child) => {
    const body: string[] = [`<child>`, `<name>${child.name}</name>`]
    if (child.summary.trim()) {
      body.push(`<summary>\n${child.summary.trim()}\n</summary>`)
    }
    if (child.history.length > 0) {
      body.push(`<conversation>\n${renderHistory(child.history)}\n</conversation>`)
    }
    body.push(`</child>`)
    return body.join('\n')
  })

  // 新しい順に並んでいるので、溢れたら古い方から落とす。
  while (blocks.join('\n\n').length > MAX_HISTORY_CHARS && blocks.length > 1) {
    blocks.pop()
  }
  parts.push(`<children>\n${blocks.join('\n\n')}\n</children>`)

  parts.push(`上の中のトピックの記録を踏まえて、「${input.topicName}」トピックの summary.md を書き直してください。

- ここに書くのは、中のどれで話しても効かせたい共有の前提です。
- 一つの話に閉じた経緯はそれぞれの記憶に任せ、ここでは繰り返さないでください。
- すでに書かれている内容は消さずに、変わったところだけ直し、新しく分かったことを足します。
- 会話のたびに読み込まれるので、簡潔に保ってください。
- そのままファイルに保存できる形で、本文だけを返します。全体をコードブロックで
  囲まないでください。`)

  return parts.join('\n\n')
}
