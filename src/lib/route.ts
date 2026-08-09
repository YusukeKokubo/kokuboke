import type { TopicRef } from '../../shared/types'

/** トピック名には日本語も空白も入るので、経路に埋める前に必ず符号化する。 */
export function topicHref(user: string, ref: TopicRef): string {
  const base = `/user/${encodeURIComponent(user)}/${encodeURIComponent(ref.topic)}`
  return ref.sub ? `${base}/${encodeURIComponent(ref.sub)}` : base
}
