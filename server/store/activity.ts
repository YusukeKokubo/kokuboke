import type { ActivityEntry, FamilyActivityEntry } from '../../shared/types'
import { config } from '../config'
import { readLastEntry } from './log'
import { assertUser, asTopicName, familyUser, type UserName } from './paths'
import { listTopics } from './topic'

const PREVIEW = 80

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW)
}

/**
 * そのユーザーの中でいちばん新しく話した会話を一行返す。
 * まだ話していなければ null。
 */
async function latestTopic(user: UserName): Promise<FamilyActivityEntry | null> {
  let latest: { slug: string; name: string; at: string } | null = null
  for (const topic of await listTopics(user)) {
    if (!topic.lastMessageAt) continue
    if (!latest || topic.lastMessageAt > latest.at) {
      latest = {
        slug: topic.slug,
        name: topic.name,
        at: topic.lastMessageAt,
      }
    }
  }
  if (!latest) return null

  const id = asTopicName(latest.slug)
  if (!id) return null

  const last = await readLastEntry(user, id)
  if (!last) return null

  return {
    slug: latest.slug,
    name: latest.name,
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
    const row = await latestTopic(user)
    if (row) entries.push({ ...row, user })
  }

  entries.sort((a, b) => b.at.localeCompare(a.at))
  return entries
}

/** 家族共有スペースの直近の一行。個人の会話一覧の入口に出す。 */
export function readFamilyActivity(): Promise<FamilyActivityEntry | null> {
  return latestTopic(familyUser())
}
