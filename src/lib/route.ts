import { isGroupRef, type TopicRef } from '../../shared/types'

/** トピック名には日本語も空白も入るので、経路に埋める前に必ず符号化する。 */
export function topicHref(user: string, ref: TopicRef): string {
  const base = `/user/${encodeURIComponent(user)}/${encodeURIComponent(ref.topic)}`
  return isGroupRef(ref) ? base : `${base}/${encodeURIComponent(ref.sub!)}`
}
