import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { collectAgent, resolveSummaryModel } from '../agent'
import { parseName } from '../agent/name'
import { namePrompt, nameSystemPrompt } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { config } from '../config'
import { BadRequestError } from '../errors'
import { readJson } from '../lib/body'
import { readRecent } from '../store/log'
import { listFamilyRecentActivity } from '../store/activity'
import { familyUser, assertTopicName, familyBusyKey, isGroupRef, topicDir, topicRef, asTopicName } from '../store/paths'
import {
  createTopic,
  deleteTopic,
  listChildren,
  listTopics,
  markNameTried,
  readTopic,
  renameTopic,
  updateTopic,
} from '../store/topic'
import { familyTopicPaths, requireFamilyTopic } from './family-target'

export const familyTopics = new Hono()

interface CreateBody {
  name?: string
  emoji?: string
  template?: string
  engine?: string
  model?: string
}

familyTopics.get('/api/family/topics', async (c) => {
  const user = familyUser()
  return c.json(await listTopics(user))
})

familyTopics.get('/api/family/activity', async (c) => {
  return c.json({ entry: await listFamilyRecentActivity() })
})

familyTopics.post('/api/family/topics', async (c) => {
  const user = familyUser()
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
familyTopics.post('/api/family/topics/:topic/sub', async (c) => {
  const user = familyUser()
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

familyTopics.on('GET', familyTopicPaths(), async (c) => {
  const { user, ref } = await requireFamilyTopic(c)

  const topic = await readTopic(user, ref)
  if (isGroupRef(ref) && topic.kind === 'group') {
    return c.json({ ...topic, children: await listChildren(user, ref.topic) })
  }

  return c.json(topic)
})

familyTopics.on('PATCH', familyTopicPaths('/name'), async (c) => {
  const { user, ref } = await requireFamilyTopic(c)
  const body = await readJson<{ name?: string; emoji?: string }>(c.req.raw)
  if (typeof body.name !== 'string') {
    throw new BadRequestError('トピック名を入力してください')
  }
  return c.json(await renameTopic(user, ref, { name: body.name, emoji: body.emoji }))
})

familyTopics.on('PATCH', familyTopicPaths('/model'), async (c) => {
  const { user, ref } = await requireFamilyTopic(c)
  const body = await readJson<{ engine?: string; model?: string }>(c.req.raw)
  return c.json(await updateTopic(user, ref, body))
})

/**
 * 返事を書いている最中に消されると、書き終わった側が logs を作り直して
 * 残骸が残る。その人が話しているあいだだけ 409 で弾く。
 *
 * 実行の枠（acquire）は取らない。全体が満員でも削除はすぐ通す。
 * ただし送信側は requireTopic を通ってから acquire するまでの間が空くので、
 * そこに削除が挟まる窓は残る。塞ぐのは messages 側で、acquire の直後に
 * もう一度 topicExists を見る。
 */
familyTopics.on('DELETE', familyTopicPaths(), async (c) => {
  const { user, ref } = await requireFamilyTopic(c)

  if (limiter.isBusy(familyBusyKey(ref))) {
    throw new HTTPException(409, { message: '前の返答をまだ書いています' })
  }

  if (isGroupRef(ref)) {
    const children = await listChildren(user, ref.topic)
    for (const child of children) {
      const sub = asTopicName(child.slug)
      if (!sub) continue
      if (limiter.isBusy(familyBusyKey(topicRef(ref.topic, sub)))) {
        throw new HTTPException(409, { message: '前の返答をまだ書いています' })
      }
    }
  }

  await deleteTopic(user, ref)
  return c.body(null, 204)
})

/**
 * 会話を読んで名前を付ける。名前なしで始めたトピックを、何往復かしたところで
 * 画面から呼ぶ。一度走らせたら、名前が付かなくても二度は試さない。
 */
familyTopics.on('POST', familyTopicPaths('/name'), async (c) => {
  const { user, ref } = await requireFamilyTopic(c)
  if (isGroupRef(ref)) {
    throw new BadRequestError('名前を付けられるのは中のトピックだけです')
  }

  const current = await readTopic(user, ref)
  // 待っているあいだに人が付けていたら、それを尊重する。
  if (current.name) return c.json(current)

  const history = await readRecent(user, ref, Math.max(config.contextDays, 14))
  if (history.length === 0) {
    throw new BadRequestError('まだ記録がありません')
  }

  const choice = resolveSummaryModel()

  const group = await readTopic(user, topicRef(ref.topic))
  const release = await limiter.acquire(familyBusyKey(ref))

  let text: string
  try {
    text = await collectAgent(choice, {
      cwd: topicDir(user, ref),
      prompt: namePrompt({ history, groupName: group.name }),
      systemPrompt: nameSystemPrompt(),
      signal: c.req.raw.signal,
    })
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
