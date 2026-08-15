/** タグに絵文字がまだ無いときの既定。会話の見出しには使わない。 */
export const DEFAULT_TAG_EMOJI = '🏷️'

/** 絵文字として受け取れる一文字だけを返す。判断できない形なら捨てる。 */
export function takeEmoji(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const first = Array.from(value)[0]
  return first && /\p{Extended_Pictographic}/u.test(first) ? first : undefined
}
