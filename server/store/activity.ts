import type { ActivityEntry } from '../../shared/types'
import { config } from '../config'
import { readRecent } from './log'
import { listTopics } from './topic'

/** readLastEntry と同じ地平。これより古い発言は管理の一覧では見ない。 */
const WINDOW_DAYS = 30

const PREVIEW = 80

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW)
}

/**
 * 全ユーザーの子トピックから、本人の送信だけを新しい順に集める。
 * 器は会話しないので子だけ見る。詳細は各会話画面で開く前提の要約。
 */
export async function listRecentActivity(limit: number): Promise<ActivityEntry[]> {
  const entries: ActivityEntry[] = []

  for (const user of config.users) {
    const topics = await listTopics(user)
    for (const topic of topics) {
      for (const child of topic.children) {
        const ref = { topic: topic.slug, sub: child.slug }
        const messages = await readRecent(user, ref, WINDOW_DAYS)
        for (const message of messages) {
          if (message.role !== 'user') continue
          entries.push({
            user,
            topic: topic.slug,
            sub: child.slug,
            topicName: topic.name,
            subName: child.name,
            emoji: child.emoji,
            text: preview(message.text),
            imageCount: message.images.length,
            at: message.at,
            id: message.id,
          })
        }
      }
    }
  }

  entries.sort((a, b) => b.at.localeCompare(a.at))
  return entries.slice(0, Math.max(0, limit))
}
