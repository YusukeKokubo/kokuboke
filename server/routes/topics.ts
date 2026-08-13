import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { isGroupRef } from '../../shared/types'
import { ENGINES, resolveModel, runAgent } from '../agent'
import { namePrompt, nameSystemPrompt } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { config } from '../config'
import { readJson } from '../lib/body'
import { TOPIC_TEMPLATES } from '../templates'
import { readRecent } from '../store/log'
import { assertTopicName, assertUser, normalizeTopicName, topicDir } from '../store/paths'
import {
  createTopic,
  listChildren,
  listTopics,
  markNameTried,
  readTopic,
  renameTopic,
  updateTopic,
} from '../store/topic'
import { requireTopic, topicPaths } from './target'

export const topics = new Hono()

/**
 * 命名の返事から名前と絵文字を取り出す。JSON で返すよう頼んでいるが、
 * 前置きやコードブロックが混じることがあるので、緩く拾う。
 */
function parseName(raw: string): { name: string; emoji?: string } | null {
  const body = raw.replace(/```[a-z]*\n?/gi, '').trim()

  let name = ''
  let emoji: string | undefined

  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(body.slice(start, end + 1)) as { name?: unknown; emoji?: unknown }
      if (typeof parsed.name === 'string') name = parsed.name
      if (typeof parsed.emoji === 'string') emoji = parsed.emoji
    } catch {
      // JSON になっていなければ下の行拾いに任せる
    }
  }

  // JSON で返ってこなかったときは、最初の行をそのまま名前として扱う。
  if (!name) name = body.split('\n').find((line) => line.trim())?.trim() ?? ''

  name = normalizeTopicName(name.replace(/^[-*\s"'「『]+|["'」』\s]+$/g, '')).slice(0, 40)
  if (!name) return null

  // 絵文字は一文字だけ受け取る。判断できない形なら既定に任せる。
  const first = emoji ? Array.from(emoji)[0] : undefined
  return { name, emoji: first && /\p{Extended_Pictographic}/u.test(first) ? first : undefined }
}

interface CreateBody {
  name?: string
  emoji?: string
  template?: string
  engine?: string
  model?: string
}

topics.get('/api/templates', (c) => c.json(TOPIC_TEMPLATES))
topics.get('/api/engines', (c) => c.json(ENGINES))

topics.get('/api/users/:user/topics', async (c) => {
  const user = assertUser(c.req.param('user'))
  return c.json(await listTopics(user))
})

topics.post('/api/users/:user/topics', async (c) => {
  const user = assertUser(c.req.param('user'))
  const body = await readJson<CreateBody>(c.req.raw)

  const topic = await createTopic(user, {
    name: String(body.name ?? ''),
    emoji: body.emoji,
    template: body.template,
    engine: body.engine,
    model: body.model,
  })

  return c.json(topic, 201)
})

/** トピックの中をさらに分ける。作れるのは一段までなので、子の下には作れない。 */
topics.post('/api/users/:user/topics/:topic/sub', async (c) => {
  const user = assertUser(c.req.param('user'))
  const group = assertTopicName(c.req.param('topic'))
  const body = await readJson<CreateBody>(c.req.raw)

  const topic = await createTopic(
    user,
    {
      name: String(body.name ?? ''),
      emoji: body.emoji,
      template: body.template,
      engine: body.engine,
      model: body.model,
    },
    group,
  )

  return c.json(topic, 201)
})

topics.on('GET', topicPaths(), async (c) => {
  const { user, ref } = await requireTopic(c)

  const topic = await readTopic(user, ref)
  if (isGroupRef(ref)) topic.children = await listChildren(user, ref.topic)

  return c.json(topic)
})

topics.on('PATCH', topicPaths(), async (c) => {
  const { user, ref } = await requireTopic(c)
  const body = await readJson<{ engine?: string; model?: string; name?: string; emoji?: string }>(
    c.req.raw,
  )

  // 名前を変えるとフォルダが動く。返す slug も変わるので、画面は経路を差し替える。
  if (typeof body.name === 'string') {
    return c.json(await renameTopic(user, ref, { name: body.name, emoji: body.emoji }))
  }
  return c.json(await updateTopic(user, ref, body))
})

/**
 * 会話を読んで名前を付ける。名前なしで始めたトピックを、何往復かしたところで
 * 画面から呼ぶ。一度走らせたら、名前が付かなくても二度は試さない。
 */
topics.on('POST', topicPaths('/name'), async (c) => {
  const { user, ref } = await requireTopic(c)
  if (isGroupRef(ref)) {
    throw new HTTPException(400, { message: '名前を付けられるのは中のトピックだけです' })
  }

  const current = await readTopic(user, ref)
  // 待っているあいだに人が付けていたら、それを尊重する。
  if (current.name) return c.json(current)

  const history = await readRecent(user, ref, Math.max(config.contextDays, 14))
  if (history.length === 0) {
    throw new HTTPException(400, { message: 'まだ記録がありません' })
  }

  const choice =
    config.summaryEngine === 'cursor'
      ? resolveModel('cursor', config.cursorModel)
      : resolveModel('claude', config.summaryModel)

  const group = await readTopic(user, { topic: ref.topic })
  const release = await limiter.acquire(user)

  let text = ''
  try {
    const events = runAgent(choice, {
      cwd: topicDir(user, ref),
      prompt: namePrompt({ history, groupName: group.name }),
      systemPrompt: nameSystemPrompt(),
      signal: c.req.raw.signal,
    })
    for await (const event of events) {
      if (event.type === 'delta') text += event.text
      else if (event.text.trim()) text = event.text
    }
  } catch (error) {
    console.error('[name]', error)
    text = ''
  } finally {
    release()
  }

  const proposed = parseName(text)
  if (!proposed) {
    // 名前なしのまま残す。あとは人が付ける。
    await markNameTried(user, ref)
    throw new HTTPException(502, { message: '名前を作れませんでした' })
  }

  return c.json(await renameTopic(user, ref, proposed))
})
