/**
 * listTopics 一回あたりの fs.readFile 回数を数える捨てスクリプト。
 * DATA_DIR は scratchpad 配下。本物の data/ には触らない。
 *
 *   mise exec -- node --import tsx scratchpad/count-listtopics-reads.mjs [label]
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(root, 'bench-data')

fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(dataDir, { recursive: true })

process.env.DATA_DIR = dataDir
process.env.USERS = 'bench'
process.env.TZ = 'Asia/Tokyo'

const { createTopic, listTopics } = await import('../server/store/topic.ts')
const { appendMessage } = await import('../server/store/log.ts')
const { assertUser, asTopicName, topicRef } = await import('../server/store/paths.ts')
const { localDate } = await import('../server/store/date.ts')

const USER = assertUser('bench')

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

// 器 10 × 子 3。最終発言は 7 日前（今日から遡ると何回か空振りする形）。
for (let g = 0; g < 10; g++) {
  const group = await createTopic(USER, { name: `器${g}`, emoji: '📁' })
  const groupName = asTopicName(group.slug)
  for (let c = 0; c < 3; c++) {
    const child = await createTopic(USER, { name: `子${c}` }, groupName)
    await appendMessage(USER, topicRef(group.slug, child.slug), {
      id: crypto.randomUUID(),
      role: 'user',
      text: `器${g}-子${c} の発言`,
      images: [],
      at: daysAgo(7).toISOString(),
    })
  }
}

let reads = 0
const orig = fsp.readFile
fsp.readFile = async function (...args) {
  reads++
  return orig.apply(this, args)
}

const topics = await listTopics(USER)
fsp.readFile = orig

const children = topics.reduce((n, t) => n + t.children.length, 0)
console.log(JSON.stringify({
  label: process.argv[2] ?? 'run',
  groups: topics.length,
  children,
  readFile: reads,
  sampleLastAt: topics[0]?.children[0]?.lastMessageAt ?? null,
  today: localDate(),
}, null, 2))
