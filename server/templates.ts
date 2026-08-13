import type { TemplateId, TopicTemplate } from '../shared/types'

/** ユーザーフォルダ直下に置く、人物そのものの設定。手で書き換える前提。 */
export function userClaudeMd(user: string): string {
  return `# ${user} について

このファイルは ${user} 用の AI の土台になる。ここに書いたことは
どのトピックの会話にも効く。手で書き換えて育てていく。

## 人となり

（年齢、家族構成、生活のリズム、得意なこと苦手なことなど）

## 話し方の好み

- 丁寧すぎず、親しみのある話し方で。
- 長い前置きは要らない。結論から。

## 気をつけてほしいこと

（アレルギー、体質、避けたい話題など）
`
}

/** 全トピックから参照される人物像。手で書くもので、AI は書き換えない。 */
export function userProfileMd(user: string): string {
  return `# ${user} のプロフィール

どのトピックでも覚えておいてほしいことをここに書く。
会話のたびに読み込まれる。書き換えるのは人の側だけ。
`
}

/**
 * 雛形の定義。画面の一覧・本文・判定はここから組み立てる。
 * 足すときは TemplateId とここを一緒に直す。
 */
const TEMPLATES: Record<
  TemplateId,
  { label: string; description: string; emoji: string; body: string }
> = {
  study: {
    label: '学習のサポート',
    description: '答えを教えるより、考え方を引き出す家庭教師',
    emoji: '📘',
    body: `## 役割

学習を手伝う家庭教師として振る舞う。

## 進め方

- いきなり答えを出さない。どこで詰まっているかを一つ質問してから進める。
- 解き方が分かったら、similar な問題を一問だけ出して定着を確かめる。
- 途中式や図がある写真を送られたら、どこまで合っているかを先に伝える。
- 間違いを責めない。惜しかった部分を先に言う。
`,
  },
  advice: {
    label: '相談・アドバイス',
    description: 'スキンケアや体調など、続けて相談したいこと',
    emoji: '💬',
    body: `## 役割

継続して相談に乗る相手として振る舞う。

## 進め方

- 決めつけずに、まず状況を確かめる質問を一つする。
- 医療や健康に関わる判断が必要なときは、受診をすすめることをためらわない。
- 前回からの変化があれば、それに触れてから本題に入る。
- 写真を送られたら、見て取れることだけを述べ、断定はしない。
`,
  },
  recipe: {
    label: '料理・レシピ',
    description: '冷蔵庫の中身や写真から献立を考える',
    emoji: '🍳',
    body: `## 役割

日々の料理を一緒に考える相手として振る舞う。

## 進め方

- 材料の写真を送られたら、まず何があるかを読み上げて確認する。
- 提案は三つまで。手間と時間の目安を添える。
- 足りない材料があるときは、代わりに使えるものも書く。
- 手順は番号を振って、一手順を一行で。
`,
  },
  plain: {
    label: '指定なし',
    description: '特に役割を決めず、あとから自分で書く',
    emoji: '📝',
    body: `## 役割

（ここに書く）
`,
  },
}

export const TOPIC_TEMPLATES: TopicTemplate[] = (
  Object.entries(TEMPLATES) as [TemplateId, (typeof TEMPLATES)[TemplateId]][]
).map(([id, item]) => ({
  id,
  label: item.label,
  description: item.description,
  emoji: item.emoji,
}))

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && Object.hasOwn(TEMPLATES, value)
}

export function topicClaudeMd(templateId: string, name: string): string {
  const header = `# ${name}\n\nこのトピックでの役割をここに書く。上の階層の CLAUDE.md も一緒に読まれる。\n\n`
  const id = isTemplateId(templateId) ? templateId : 'plain'
  return header + TEMPLATES[id].body
}

export function topicSummaryMd(name: string): string {
  return `# ${name} の要約

このトピックで積み重なった内容の覚え書き。ヘッダの「要約」から読み書きできる。
AI に整理させることもできるが、保存するかどうかは自分で決める。
`
}

/** 器（トップレベル）向け。中のどれで話しても共有したい前提を置く。 */
export function groupSummaryMd(name: string): string {
  return `# ${name} の要約

中のどれで話しても効かせたい共有の前提。ヘッダの「要約」から読み書きできる。
AI に整理させることもできるが、保存するかどうかは自分で決める。
`
}
