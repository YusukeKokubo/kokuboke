import type { ProfileChange } from './types'

/**
 * profile.md の上限（字）。会話のたびにプロンプトへ丸ごと入るので、トークンの嵩みで決めている。
 * 日本語で 1,500 トークン前後の見込み。直し案の採用は、これを超える組み合わせを受け付けない。
 */
export const PROFILE_LIMIT = 2000

const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' })

/** 見た目の字数。絵文字の異体字セレクタや結合を一字に数える。 */
export function charCount(text: string): number {
  return Array.from(graphemes.segment(text.trim())).length
}

function lines(text: string): string[] {
  const body = text.replace(/\s+$/, '')
  return body ? body.split('\n') : []
}

/**
 * 選んだ案を当てる。直す・消すは元の行を探して差し替え、足すは末尾に並べる。
 * 元の行が見つからない案は飛ばす（案を作ったあとに人が手で直したとき）。
 * 画面は採用前の字数を出すのに、サーバーは書き込みに使う。
 */
export function applyProfileChanges(profile: string, changes: ProfileChange[]): string {
  const out = lines(profile)
  for (const change of changes) {
    if (change.type === 'add') {
      out.push(change.text)
      continue
    }
    const target = change.type === 'replace' ? change.from : change.text
    const at = out.findIndex((line) => line.trim() === target)
    if (at < 0) continue
    if (change.type === 'replace') out[at] = change.to
    else out.splice(at, 1)
  }
  return out.length > 0 ? out.join('\n') + '\n' : ''
}
