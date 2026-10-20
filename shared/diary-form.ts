import type { DiaryForm } from './types'

/**
 * 「いまなにしとる」の穴埋めの欄。5W1H のうち、いつ（聞いた時刻）と、なぜ（重い）は外した。
 * key は AI に候補を頼むときの名前。
 */
export const DIARY_FORM_FIELDS = [
  { key: 'where', label: 'どこで', fallback: ['家', '職場', '出先', '移動中'] },
  { key: 'who', label: 'だれと', fallback: ['ひとり', '家族と', '友だちと', '職場の人と'] },
  { key: 'what', label: 'なにを', fallback: ['仕事', '家事', 'ごはん', 'ひと休み'] },
  { key: 'mood', label: 'きぶん', fallback: ['いい感じ', 'ふつう', 'つかれた', 'ねむい'] },
] as const

export type DiaryFormKey = (typeof DIARY_FORM_FIELDS)[number]['key']

/** 一欄の候補の数と長さの上限。ボタンに載るので短く。画面が「ほか…」を一つ足す。 */
export const CHOICES_PER_FIELD = 4
export const CHOICE_CHARS = 16

/** AI が候補を出せなかった欄は、決まった候補で埋める。 */
export function buildDiaryForm(choices: Partial<Record<DiaryFormKey, string[]>> = {}): DiaryForm {
  return {
    fields: DIARY_FORM_FIELDS.map((field) => {
      const picked = choices[field.key] ?? []
      return { label: field.label, choices: picked.length > 0 ? picked : [...field.fallback] }
    }),
  }
}

/**
 * 穴埋めの答えを、会話に積む一通の本文にする。「どこで: 家」を一行ずつ、空の欄は飛ばす。
 * 日記もプロフィールの直し案も本文しか見ないので、型は残さず文字にしてしまう。
 */
export function diaryAnswerText(form: DiaryForm, values: string[], note: string): string {
  const lines = form.fields
    .map((field, i) => [field.label, values[i]?.trim() ?? ''] as const)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
  if (note.trim()) lines.push(note.trim())
  return lines.join('\n')
}
