import type { DiaryEntry, Message } from '../../shared/types'
import { renderHistory } from '../agent/prompt'
import type { ProfileRevision } from '../store/diary'

/** 問いかけの長さの目安。通知の本文に頭が載るので、短いほど読まれる。 */
const QUESTION_CHARS = 120

export function questionSystemPrompt(user: string): string {
  return `あなたは家族向けのチャットアプリの中で、「${user}」さんに自分から話しかけています。

- 日中のでたらめな時刻に「今何してる？」と声をかけ、その答えを日記にためていく仕組みです。
- 返すのは、いま送る一通の本文だけです。前置き、説明、作業の報告は書きません。
- スマートフォンの通知に頭の一行が出ます。${QUESTION_CHARS} 字くらいまでの話し言葉で書きます。
- Markdown の見出し・箇条書き・リンクは使いません。
- ファイルの作成・編集・削除はしません。`
}

export function questionPrompt(input: {
  /** 現地の時刻の表示。「10月11日（日）14:12」。 */
  now: string
  profile: string
  tags: { name: string; group: string }[]
  /** この一週間の会話の見出し。興味の手がかり。 */
  recentNames: string[]
  /** 今日の会話。初めの問いかけなら空。 */
  today: Message[]
}): string {
  const parts: string[] = []
  if (input.profile.trim()) parts.push(`<profile>\n${input.profile.trim()}\n</profile>`)
  if (input.tags.length > 0) {
    const lines = input.tags.map((tag) => `- ${tag.name}${tag.group ? `（${tag.group}）` : ''}`)
    parts.push(`<tags>\n${lines.join('\n')}\n</tags>`)
  }
  if (input.recentNames.length > 0) {
    parts.push(`<recent_topics>\n${input.recentNames.map((name) => `- ${name}`).join('\n')}\n</recent_topics>`)
  }
  if (input.today.length > 0) {
    parts.push(`<today>\n${renderHistory(input.today)}\n</today>`)
  }

  const first = input.today.length === 0
  const answered = input.today.some((m) => m.role === 'user')
  const flow = first
    ? '今日はじめての声かけです。'
    : answered
      ? '<today> は今日のここまでのやり取りです。前の答えを踏まえて、続きとして聞いてかまいません。'
      : '<today> の前の声かけには、まだ答えが来ていません。前の問いを繰り返したり、答えを催促したりせず、新しく聞きます。'

  parts.push(`いまは ${input.now} です。${flow}

一通を書いてください。

- WebSearch で、今日いま話題になっているニュースを探し、本人が興味を持ちそうなものを一つ選びます。
  手がかりは <profile>、<tags>、<recent_topics> です。どれにも当たらなければ、誰にでも話しやすい明るい話題にします。
- 今日の <today> にすでに出したニュースは使いません。
- ニュースはひとことで触れるだけにして、最後は「今何してる？」の気持ちで、いまの様子を聞きます。
  ニュースへの感想を求める問いにはしません。答えてほしいのは本人のいまのことです。
- 検索がうまくいかなければ、ニュースには触れずに、いまの様子だけを聞きます。`)

  return parts.join('\n\n')
}

export function recordSystemPrompt(): string {
  return `あなたは、家族向けのチャットアプリで、本人の一日を短い記録にまとめる係です。

- ファイルは読み書きしません。記録の本文を返すところまでが仕事です。
- 前置き・説明・報告は書かないでください。返答の 1 文字目から記録の本文です。`
}

export function recordPrompt(input: { date: string; conversation: Message[] }): string {
  return `<conversation>
${renderHistory(input.conversation)}
</conversation>

上は ${input.date} の「今何してる？」のやり取りです。「本人」の答えをもとに、この日の記録を書いてください。

- 横から見た記録として、常体で書きます。主語は省きます。
- 書くのは本人が答えた出来事と様子だけです。答えに無いことは推測で足しません。
- あなた（AI）の問いかけや、そこで触れたニュースは、本人が答えの中で触れたときだけ書きます。
- 時刻の順に、2〜6 文くらいで。見出しや箇条書きは使いません。`
}

export function profileSystemPrompt(): string {
  return `あなたは、本人の覚え書き（profile.md）の直し案を出す係です。

- profile.md は、どの会話でも AI が読み込む本人の覚え書きです。会話のたびにプロンプトへ丸ごと入ります。
- ファイルは書き換えません。直し案の JSON を返すところまでが仕事です。どれを入れるかは本人が選びます。
- 前置き・説明・報告は書かないでください。返すのは指定された JSON 一つだけです。`
}

function renderEntries(entries: DiaryEntry[]): string {
  return entries
    .map((entry) => {
      const answers = entry.answers.map((answer) => `- ${answer.at} ${answer.text.replace(/\n/g, ' ')}`)
      return `<day date="${entry.date}">\n${answers.join('\n')}\n</day>`
    })
    .join('\n\n')
}

function renderProfileRevisions(revisions: ProfileRevision[]): string {
  return revisions
    .flatMap((revision) => [
      ...revision.accepted.map((line) => `- 採用: ${line}`),
      ...revision.rejected.map((line) => `- 見送り: ${line}`),
    ])
    .join('\n')
}

export function profilePrompt(input: {
  profile: string
  length: number
  limit: number
  entries: DiaryEntry[]
  revisions: ProfileRevision[]
}): string {
  const parts: string[] = []
  parts.push(`<profile chars="${input.length}" limit="${input.limit}">\n${input.profile.trim() || '（まだ何も書かれていません）'}\n</profile>`)
  parts.push(`<answers>\n${renderEntries(input.entries)}\n</answers>`)
  const revisions = renderProfileRevisions(input.revisions)
  if (revisions) parts.push(`<past_proposals>\n${revisions}\n</past_proposals>`)

  parts.push(`<answers> はこの一週間、「今何してる？」に本人が答えたものです。
これを読んで、<profile> の直し案を出してください。

- 書いてよいのは、何週たっても変わらない事実だけです。人柄、暮らしの決まり、好きなもの、続いている関心ごと。
  「今週は忙しい」「風邪をひいた」のような一時のことは書きません。それは日記の仕事です。
- 案には、根拠になった答えの日付を dates に付けます。違う日が二つ以上ない案は出しません。
- 足す行は、<profile> の書きぶり（箇条書きなら「- 」で始めるなど）に合わせた一行にします。
- 直す・消すの from と text は、<profile> の行を一字も変えずにそのまま写します。
- <profile> の字数は今 ${input.length} 字で、上限は ${input.limit} 字です。
  案を全部入れたときに上限を超えるなら、古くなった行や重なった行を消す・まとめる案を必ず一緒に出します。
- <past_proposals> で見送られた案と同じものは出しません。
- 直すことが無ければ、空の配列を返します。無理に出さないでください。

次の形の JSON だけを返してください。
{"changes":[{"type":"add","text":"- 週末は子どもとホームセンターに行くことが多い","dates":["2026-10-04","2026-10-10"]},{"type":"replace","from":"- 朝はコーヒー","to":"- 朝は紅茶","dates":["2026-10-06","2026-10-09"]},{"type":"remove","text":"- 毎朝ジョギング","reason":"今はやめたと 10/07 と 10/09 に話していた"}]}`)

  return parts.join('\n\n')
}
