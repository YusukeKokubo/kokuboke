import { runAgent, type ModelChoice } from './model'
import type { RunRequest } from './types'

/**
 * エージェントを回して全文を集める。途中の差分は要れば横に流す。
 * 最終結果が空なら、差分の積み上げを守る。
 */
export async function collectAgent(
  choice: ModelChoice,
  request: Omit<RunRequest, 'model'>,
  onDelta?: (text: string) => Promise<void>,
): Promise<string> {
  let text = ''
  for await (const event of runAgent(choice, request)) {
    if (event.type === 'delta') {
      text += event.text
      await onDelta?.(event.text)
    } else if (event.text.trim()) {
      // 差分を取りこぼしていても最終結果で辻褄を合わせる。空なら積み上げを守る。
      text = event.text
    }
  }
  return text
}

/**
 * 本文だけを返すよう頼んでも、全体をコードブロックで囲んでくることがある。
 * 中身が丸ごと囲まれている場合だけ剥がす。文中のコードブロックには触らない。
 */
export function unfence(text: string): string {
  const body = text.trim()
  const match = /^```[^\n]*\n([\s\S]*)\n```$/.exec(body)
  if (!match) return body
  // 途中で閉じて開き直している場合は、囲みではなく本文の一部。
  return match[1]!.includes('```') ? body : match[1]!
}
