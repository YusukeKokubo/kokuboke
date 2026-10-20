import type { DiaryForm } from '../../shared/types'
import {
  buildDiaryForm,
  CHOICE_CHARS,
  CHOICES_PER_FIELD,
  DIARY_FORM_FIELDS,
  type DiaryFormKey,
} from '../../shared/diary-form'

/** 書けなかったときの一通。様子を聞く言葉は穴埋めの欄が出すので、短く尋ねるだけにする。 */
export const PLAIN_QUESTION = 'いまはどんな感じ？'

function cleanChoices(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (!text || text.includes('\n') || [...text].length > CHOICE_CHARS || text === 'ほか') continue
    seen.add(text)
  }
  return [...seen].slice(0, CHOICES_PER_FIELD)
}

/**
 * 問いかけの返事を、本文と穴埋めに分ける。JSON で返らなかったときは返事を丸ごと本文にし、
 * 候補は決まったもので埋める。穴埋めが出ないと答えにくくなるので、form は必ず付ける。
 */
export function parseQuestion(raw: string): { text: string; form: DiaryForm } {
  const match = /\{[\s\S]*\}/.exec(raw)
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { text?: unknown; choices?: Record<string, unknown> }
      const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
      const choices: Partial<Record<DiaryFormKey, string[]>> = {}
      for (const field of DIARY_FORM_FIELDS) choices[field.key] = cleanChoices(parsed.choices?.[field.key])
      return { text: text || PLAIN_QUESTION, form: buildDiaryForm(choices) }
    } catch {
      // JSON の形をしていても読めなければ、本文として扱う。
    }
  }
  return { text: raw.trim() || PLAIN_QUESTION, form: buildDiaryForm() }
}
