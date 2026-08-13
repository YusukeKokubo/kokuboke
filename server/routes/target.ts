import type { Context } from 'hono'
import { NotFoundError } from '../errors'
import { assertTopicRef, assertUser, type VerifiedTopicRef, type UserName } from '../store/paths'
import { topicExists } from '../store/topic'

/**
 * トピックは一段だけ入れ子にできる。親と子で処理は変わらないので、
 * 同じハンドラを二つの経路に載せて、`sub` の有無だけで区別する。
 */
export function topicPaths(suffix = ''): string[] {
  const base = '/api/users/:user/topics/:topic'
  return [`${base}${suffix}`, `${base}/sub/:sub${suffix}`]
}

export function target(c: Context): { user: UserName; ref: VerifiedTopicRef } {
  // 経路を配列で渡すと Hono が名前を推論できないので、空文字に落として検査に回す。
  return {
    user: assertUser(c.req.param('user') ?? ''),
    ref: assertTopicRef(c.req.param('topic') ?? '', c.req.param('sub')),
  }
}

/** 経路から取り出したうえで、実体があることまで確かめる。 */
export async function requireTopic(c: Context): Promise<{ user: UserName; ref: VerifiedTopicRef }> {
  const found = target(c)
  if (!(await topicExists(found.user, found.ref))) {
    throw new NotFoundError('トピックが見つかりません')
  }
  return found
}
