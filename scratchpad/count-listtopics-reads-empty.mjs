/** ログ無し（変更前の最悪ケース）での readFile 回数。 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(root, 'bench-data-empty')

fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(dataDir, { recursive: true })

process.env.DATA_DIR = dataDir
process.env.USERS = 'bench'
process.env.TZ = 'Asia/Tokyo'

const { createTopic, listTopics } = await import('../server/store/topic.ts')
const { assertUser, asTopicName } = await import('../server/store/paths.ts')

const USER = assertUser('bench')
for (let g = 0; g < 10; g++) {
  const group = await createTopic(USER, { name: `器${g}`, emoji: '📁' })
  const groupName = asTopicName(group.slug)
  for (let c = 0; c < 3; c++) {
    await createTopic(USER, { name: `子${c}` }, groupName)
  }
}

let reads = 0
const orig = fsp.readFile
fsp.readFile = async function (...args) {
  reads++
  return orig.apply(this, args)
}
await listTopics(USER)
fsp.readFile = orig
console.log(JSON.stringify({ label: 'after-empty-logs', readFile: reads }, null, 2))
