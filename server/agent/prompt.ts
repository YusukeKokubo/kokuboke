import type { Message } from '../../shared/types'
import { localTime } from '../../shared/date'
import { formatRevisions, type Revision } from '../store/revision'

const MAX_HISTORY_CHARS = 20_000

function renderHistory(messages: Message[]): string {
  if (messages.length === 0) return '（このトピックでの会話はまだありません）'

  const lines = messages.map((m) => {
    const who = m.role === 'user' ? (m.author ?? '本人') : 'あなた'
    const time = localTime(new Date(m.at))
    const nImg = m.images.length
    const nFile = m.files?.length ?? 0
    const attached =
      nImg + nFile === 0
        ? ''
        : nFile === 0
          ? `（画像 ${nImg} 枚）`
          : nImg === 0
            ? `（ファイル ${nFile}）`
            : `（画像 ${nImg} 枚・ファイル ${nFile}）`
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
- 添付（画像・PDF・テキスト）がある場合は、示された絶対パスを Read ツールで開いて内容を踏まえて答えてください。
- 「承知しました」のような前置きや、返答の要約は書かないでください。本文だけを返します。${
    input.audience.kind === 'personal'
      ? '\n- 家族の事実や好みを知ったら remember で覚える。'
      : ''
  }`
}

export function chatPrompt(input: {
  /** スペース直下の profile.md。無ければ空文字。 */
  profile: string
  /** AI が前の会話で覚えたもの。無ければ空文字。 */
  memory?: string
  /** 付いているタグの覚え書き。無ければ空。 */
  tags: { name: string; text: string }[]
  history: Message[]
  text: string
  /** 共有スペースの発言者。個人のスペースでは付かない。 */
  author?: string
  imagePaths: string[]
  filePaths?: string[]
}): string {
  const parts: string[] = []

  if (input.profile.trim()) {
    parts.push(`<profile>\n${input.profile.trim()}\n</profile>`)
  }
  if (input.memory?.trim()) {
    parts.push(
      `<memory>\nあなたが前の会話で覚えたもの。間違いは人が直す。\n\n${input.memory.trim()}\n</memory>`,
    )
  }
  for (const tag of input.tags) {
    if (!tag.text.trim()) continue
    parts.push(
      `<tag name="${tag.name}">\nこのタグの話をするときの指示。AGENTS.md と同じように守る。\n\n${tag.text.trim()}\n</tag>`,
    )
  }

  parts.push(`<conversation>\n${renderHistory(input.history)}\n</conversation>`)

  const body = input.text.trim() || '（本文なし）'
  const current: string[] = [input.author ? `${input.author}: ${body}` : body]
  const attachments = [
    ...input.imagePaths.map((p) => ({ kind: '画像', p })),
    ...(input.filePaths ?? []).map((p) => ({ kind: 'ファイル', p })),
  ]
  if (attachments.length > 0) {
    current.push('', '添付（Read ツールで開いてください）:')
    for (const { kind, p } of attachments) current.push(`- ${p}（${kind}）`)
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

export type ClassifyHints = {
  revisions?: Revision[]
  policy?: string
}

/** 手直しログと整理の方針。会話のプロンプトには載せない。 */
export function classifyBlock(input: ClassifyHints): string {
  const parts: string[] = []
  const revisions = formatRevisions(input.revisions ?? [])
  if (revisions) parts.push(`<revisions>\n${revisions}\n</revisions>`)
  const policy = input.policy?.trim()
  if (policy) parts.push(`<organize_policy>\n${policy}\n</organize_policy>`)
  if (parts.length === 0) return ''
  return `${parts.join('\n\n')}\n\n`
}

export function namePrompt(input: { history: Message[]; currentName?: string } & ClassifyHints): string {
  const refine = input.currentName
    ? `いまの名前は「${input.currentName}」です。会話を踏まえて、このままでよければ同じ名前を、より適切なら付け直してください。`
    : 'この会話に名前を付けてください。'

  return `<conversation>
${renderHistory(input.history)}
</conversation>

${classifyBlock(input)}${refine}

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
} & ClassifyHints): string {
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

${classifyBlock(input)}${aboutName}この会話に大分類のタグを付けてください。

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

  return `あなたは、チャットの AI に渡す指示書を書く係です。

- 対象は${whose}「${input.tagName}」タグです。このタグが付いた会話では、
  タグの本文が AGENTS.md と同じように毎回 AI に渡されます。${mixed}
- ファイルは書き換えません。新しい本文の全文を返すところまでが仕事です。
  保存するかどうかは人が決めます。
- 前置き・説明・報告・作業の宣言は書かないでください。返答の 1 文字目から
  保存する本文です。見出しか箇条書きで始めてください。`
}

export function tagDraftPrompt(input: {
  tagName: string
  current: string
  /** スペース全体に効く AGENTS.md。ここにあることは書かない。 */
  agents: string
  /** profile.md。同じく繰り返さない。 */
  profile: string
  /** 新しい順。長すぎるときは古い方から落とす。 */
  chats: { name: string; history: Message[] }[]
}): string {
  const parts: string[] = []

  if (input.agents.trim()) {
    parts.push(`<agents_md>\n${input.agents.trim()}\n</agents_md>`)
  }
  if (input.profile.trim()) {
    parts.push(`<profile>\n${input.profile.trim()}\n</profile>`)
  }
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

  parts.push(`上の会話を読んで、「${input.tagName}」の話をするときに AI が守る指示書を書き直してください。

- 書くのは、次にこの分野の話をするときに効くことだけです。
  - 本人が繰り返し求めている深さ・形式・出典の扱い
  - 会話の中で本人が直した点や、嫌がった点
  - 関心の向き（どの地域・分野・切り口をよく追っているか）
  - 前提として知っておいてほしい背景や、本人の立ち位置
- 個々の話題の要約や、ニュースの内容そのものは書きません。事実は覚え書き.md の側に残るので、ここには書きません。
- <agents_md> と <profile> に既に書いてあることは繰り返しません。このタグに固有のことだけです。
- <current> にすでに書かれている内容は消さずに、変わったところだけ直し、新しく分かったことを足します。
  人が手で書いた指示はそのまま残します。
- 会話のたびに読み込まれるので、箇条書きで簡潔に。根拠の薄い推測は書きません。
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
} & ClassifyHints): string {
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

${classifyBlock(input)}この一覧を大分類へ寄せる提案をしてください。

- 会話名まがいを大分類へ寄せます。「大英博物館展」なら「美術館博物館巡り」です。
- 既にある大分類で足りるなら、そちらへ寄せます。新しい大分類は、これから何度も話しそうなテーマが無いときだけです。
- 棚を付ける・寄せます。「生活」と「暮らし」が並んでいたら一つにします。
- 使っていない一度きりのタグは消す候補にします。会話が付いているタグは、寄せずに消さないでください。
- 直さなくてよいものは出しません。空の配列にしてよいです。

次の形の JSON だけを返してください。
{"actions":[{"type":"merge","from":"大英博物館展","to":"美術館博物館巡り"},{"type":"shelf","name":"美術館博物館巡り","group":"文化"},{"type":"remove","name":"動作確認用"}]}`
}

export function organizeDraftSystemPrompt(): string {
  return `あなたは分類の方針を短くまとめる係です。

- ファイルは書き換えません。新しい本文の全文を返すところまでが仕事です。
  保存するかどうかは人が決めます。
- 繰り返した直しだけを規則にします。一回だけの例外は書きません。
- 会話の見出しや一度きりの出来事、献立や予定は書きません。それらはタグ本文の仕事です。
- 前置き・説明・報告は書かないでください。返すのは本文だけです。`
}

export function organizeDraftPrompt(input: {
  current: string
  revisions: Revision[]
  tags: { name: string; group: string; note?: string }[]
}): string {
  const parts: string[] = []
  if (input.current.trim()) {
    parts.push(`<current>\n${input.current.trim()}\n</current>`)
  }
  const revisions = formatRevisions(input.revisions)
  if (revisions) parts.push(`<revisions>\n${revisions}\n</revisions>`)
  const tags =
    input.tags.length > 0
      ? input.tags
          .map((tag) => {
            const shelf = tag.group || '棚なし'
            const note = tag.note ? `: ${tag.note}` : ''
            return `- ${tag.name}（${shelf}）${note}`
          })
          .join('\n')
      : '（まだ無い）'
  parts.push(`<tags>\n${tags}\n</tags>`)
  parts.push(`上の手直しとタグ一覧を踏まえて、分類の方針を書き直してください。

- すでに書かれている方針は消さずに、変わったところだけ直し、繰り返した直しを足します。
- 一回の例外は規則にしないでください。同じ直しがまだ一度だけなら、今の本文のままでよいです。
- イベント名や献立、一度きりの予定は書かないでください。
- そのままファイルに保存できる形で、本文だけを返します。全体をコードブロックで
  囲まないでください。`)
  return parts.join('\n\n')
}
