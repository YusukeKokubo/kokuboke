import type { ActivityEntry, ChildTopic, GroupTopic } from '../../shared/types'
import { config } from '../config'
import { readLastEntry } from './log'
import { listTopics } from './topic'

const PREVIEW = 80

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW)
}

/**
 * ユーザーごとに、いちばん新しく話した子トピックを一行返す。
 * 器は会話しないので子だけ見る。詳細は各会話画面で開く前提の要約。
 */
export async function listRecentActivity(): Promise<ActivityEntry[]> {
  const entries: ActivityEntry[] = []

  for (const user of config.users) {
    const topics = await listTopics(user)
    let latest: { topic: GroupTopic; child: ChildTopic } | null = null
    for (const topic of topics) {
      for (const child of topic.children) {
        if (!child.lastMessageAt) continue
        if (!latest || child.lastMessageAt > latest.child.lastMessageAt!) {
          latest = { topic, child }
        }
      }
    }
    if (!latest) continue

    const last = await readLastEntry(user, {
      kind: 'child',
      topic: latest.topic.slug,
      sub: latest.child.slug,
    })
    if (!last) continue

    entries.push({
      user,
      topic: latest.topic.slug,
      sub: latest.child.slug,
      topicName: latest.topic.name,
      subName: latest.child.name,
      emoji: latest.child.emoji,
      text: preview(last.text),
      imageCount: last.images.length,
      at: last.at,
      id: last.id,
    })
  }

  entries.sort((a, b) => b.at.localeCompare(a.at))
  return entries
}
