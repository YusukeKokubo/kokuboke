import type {
  ActivityEntry,
  ChildTopic,
  FamilyActivityEntry,
  GroupTopic,
} from '../../shared/types'
import { config } from '../config'
import { readLastEntry } from './log'
import { assertUser, asTopicName, familyUser, topicRef, type UserName } from './paths'
import { listTopics } from './topic'

const PREVIEW = 80

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW)
}

/**
 * そのユーザーの中でいちばん新しく話した子トピックを一行返す。
 * 器は会話しないので子だけ見る。詳細は各会話画面で開く前提の要約。
 * まだ話していなければ null。
 */
async function latestChild(user: UserName): Promise<FamilyActivityEntry | null> {
  let latest: { topic: GroupTopic; child: ChildTopic } | null = null
  for (const topic of await listTopics(user)) {
    for (const child of topic.children) {
      if (!child.lastMessageAt) continue
      if (!latest || child.lastMessageAt > latest.child.lastMessageAt!) {
        latest = { topic, child }
      }
    }
  }
  if (!latest) return null

  const topic = asTopicName(latest.topic.slug)
  const sub = asTopicName(latest.child.slug)
  if (!topic || !sub) return null

  const last = await readLastEntry(user, topicRef(topic, sub))
  if (!last) return null

  return {
    topic: latest.topic.slug,
    sub: latest.child.slug,
    topicName: latest.topic.name,
    subName: latest.child.name,
    emoji: latest.child.emoji,
    text: preview(last.text),
    imageCount: last.images.length,
    at: last.at,
    id: last.id,
    author: last.role === 'user' ? last.author : undefined,
  }
}

/** 管理画面の「最新の会話」。ユーザーごとに一行、新しい順。 */
export async function listRecentActivity(): Promise<ActivityEntry[]> {
  const entries: ActivityEntry[] = []

  for (const name of config.users) {
    const user = assertUser(name)
    const row = await latestChild(user)
    if (row) entries.push({ ...row, user })
  }

  entries.sort((a, b) => b.at.localeCompare(a.at))
  return entries
}

/** 家族共有スペースの直近の一行。個人のトピック一覧の入口に出す。 */
export function readFamilyActivity(): Promise<FamilyActivityEntry | null> {
  return latestChild(familyUser())
}
