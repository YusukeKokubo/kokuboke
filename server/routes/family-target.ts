import type { Context } from 'hono'
import { NotFoundError } from '../errors'
import {
  assertTopicRef,
  familyUser,
  type VerifiedTopicRef,
  type UserName,
} from '../store/paths'
import { topicExists } from '../store/topic'

/**
 * 家族共有スペースのトピック経路。個人向け topicPaths と同じ形で、
 * `/api/users/:user` の代わりに `/api/family` を使う。
 */
export function familyTopicPaths(suffix = ''): string[] {
  const base = '/api/family/topics/:topic'
  return [`${base}${suffix}`, `${base}/sub/:sub${suffix}`]
}

export function familyTarget(c: Context): { user: UserName; ref: VerifiedTopicRef } {
  return {
    user: familyUser(),
    ref: assertTopicRef(c.req.param('topic') ?? '', c.req.param('sub')),
  }
}

/** 経路から取り出したうえで、実体があることまで確かめる。 */
export async function requireFamilyTopic(c: Context): Promise<{
  user: UserName
  ref: VerifiedTopicRef
}> {
  const found = familyTarget(c)
  if (!(await topicExists(found.user, found.ref))) {
    throw new NotFoundError('トピックが見つかりません')
  }
  return found
}
