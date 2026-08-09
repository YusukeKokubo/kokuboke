import type { Message } from '../../shared/types'
import { localTime } from '../store/log'

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
  return `あなたは家族向けのチャットアプリの中で応答しています。

- 話し相手は「${input.user}」さん。いまのトピックは「${input.topicName}」です。
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
  summary: string
  history: Message[]
  text: string
  imagePaths: string[]
}): string {
  const parts: string[] = []

  if (input.profile.trim()) {
    parts.push(`<profile>\n${input.profile.trim()}\n</profile>`)
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

export function summarySystemPrompt(input: { user: string; topicName: string }): string {
  return `あなたは会話の記録を整理する係です。

- 対象は「${input.user}」さんの「${input.topicName}」トピックです。
- 作業対象は summary.md と、一つ上の階層にある profile.md の 2 つだけです。
  それ以外のファイルは変更しないでください。
- 作業が終わったら、何を書き足したかを 2〜3 行で報告してください。`
}

export function summaryPrompt(input: { history: Message[]; topicName: string }): string {
  return `<conversation>
${renderHistory(input.history)}
</conversation>

上の会話を踏まえて、次の 2 つのファイルを更新してください。

1. summary.md — この「${input.topicName}」トピックで積み重なった内容の要約。
   会話のたびに読み込まれるので、簡潔に保ってください。すでに書かれている内容は
   消さずに、更新が必要なところだけ書き換え、新しく分かったことを足します。
   個々のやりとりを列挙するのではなく、続けて話すために必要な事実と経緯を残します。

2. ../../profile.md — トピックに関係なく覚えておくべき人物像だけを足します。
   このトピック限りの話は書かないでください。足すことが無ければ触らなくて構いません。`
}
