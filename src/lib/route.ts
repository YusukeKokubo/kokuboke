import { isGroupRef, type TopicRef } from '../../shared/types'

/** トピック画面への経路。子なら器の下に続ける。 */
export function topicHref(user: string, ref: TopicRef): string {
  const base = `/user/${encodeURIComponent(user)}/${encodeURIComponent(ref.topic)}`
  return isGroupRef(ref) ? base : `${base}/${encodeURIComponent(ref.sub)}`
}

/** 家族共有スペースのトピック画面への経路。 */
export function familyTopicHref(ref: TopicRef): string {
  const base = `/family/${encodeURIComponent(ref.topic)}`
  return isGroupRef(ref) ? base : `${base}/${encodeURIComponent(ref.sub)}`
}
