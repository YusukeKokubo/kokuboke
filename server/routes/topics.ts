import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { collectAgent, ENGINES, resolveModel } from '../agent'
import { parseName } from '../agent/name'
import { namePrompt, nameSystemPrompt } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { config } from '../config'
import { BadRequestError } from '../errors'
import { readJson } from '../lib/body'
import { readFamilyActivity } from '../store/activity'
import { readRecent } from '../store/log'
import { asTopicName, assertTopicName, isGroupRef, topicDir, topicRef } from '../store/paths'
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
import { requireTopic, resolveSpace, spacePaths, topicPaths } from './space'

export const topics = new Hono()

interface CreateBody {
  name?: string
  emoji?: string
  engine?: string
  model?: string
}

function createInput(body: CreateBody) {
  return {
    name: String(body.name ?? ''),
    emoji: body.emoji,
    engine: body.engine,
    model: body.model,
  }
}

topics.get('/api/engines', (c) => c.json(ENGINES))

/** 個人のトピック一覧の先頭に出す、共有スペースの入口の一行。 */
topics.get('/api/family/activity', async (c) => c.json({ entry: await readFamilyActivity() }))

topics.on('GET', spacePaths('/topics'), async (c) => {
  return c.json(await listTopics(resolveSpace(c).user))
})

topics.on('POST', spacePaths('/topics'), async (c) => {
  const { user } = resolveSpace(c)
  const body = await readJson<CreateBody>(c.req.raw)
  return c.json(await createTopic(user, createInput(body)), 201)
})

/** トピックの中をさらに分ける。作れるのは一段までなので、子の下には作れない。 */
topics.on('POST', spacePaths('/topics/:topic/sub'), async (c) => {
  const { user } = resolveSpace(c)
  const group = assertTopicName(c.req.param('topic') ?? '')
  const body = await readJson<CreateBody>(c.req.raw)
  return c.json(await createTopic(user, createInput(body), group), 201)
})

topics.on('GET', topicPaths(), async (c) => {
  const { space, ref } = await requireTopic(c)

  const topic = await readTopic(space.user, ref)
  if (isGroupRef(ref) && topic.kind === 'group') {
    return c.json({ ...topic, children: await listChildren(space.user, ref.topic) })
  }

  return c.json(topic)
})

topics.on('PATCH', topicPaths('/name'), async (c) => {
  const { space, ref } = await requireTopic(c)
  const body = await readJson<{ name?: string; emoji?: string }>(c.req.raw)
  if (typeof body.name !== 'string') {
    throw new BadRequestError('トピック名を入力してください')
  }
  return c.json(await renameTopic(space.user, ref, { name: body.name, emoji: body.emoji }))
})

topics.on('PATCH', topicPaths('/model'), async (c) => {
  const { space, ref } = await requireTopic(c)
  const body = await readJson<{ engine?: string; model?: string }>(c.req.raw)
  return c.json(await updateTopic(space.user, ref, body))
})

/**
 * 返事を書いている最中に消されると、書き終わった側が logs を作り直して
 * 残骸が残る。返答中のあいだだけ 409 で弾く。
 *
 * 実行の枠（acquire）は取らない。全体が満員でも削除はすぐ通す。
 * ただし送信側は requireTopic を通ってから acquire するまでの間が空くので、
 * そこに削除が挟まる窓は残る。塞ぐのは messages 側で、acquire の直後に
 * もう一度 topicExists を見る。
 */
topics.on('DELETE', topicPaths(), async (c) => {
  const { space, ref } = await requireTopic(c)

  if (limiter.isBusy(space.busyKey(ref))) {
    throw new HTTPException(409, { message: '前の返答をまだ書いています' })
  }

  // 鍵がトピックごとに分かれているスペースでは、器の鍵が空いていても
  // 中の子が話している最中のことがある。個人のスペースは鍵が人ごとで、
  // 器と子で同じ鍵になるので上の一度で足りる。
  if (space.busyPerTopic && isGroupRef(ref)) {
    for (const child of await listChildren(space.user, ref.topic)) {
      const sub = asTopicName(child.slug)
      if (!sub) continue
      if (limiter.isBusy(space.busyKey(topicRef(ref.topic, sub)))) {
        throw new HTTPException(409, { message: '前の返答をまだ書いています' })
      }
    }
  }

  await deleteTopic(space.user, ref)
  return c.body(null, 204)
})

/**
 * 会話を読んで名前を付ける。名前なしで始めたトピックを、何往復かしたところで
 * 画面から呼ぶ。一度走らせたら、名前が付かなくても二度は試さない。
 */
topics.on('POST', topicPaths('/name'), async (c) => {
  const { space, ref } = await requireTopic(c)
  const { user } = space
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

  const choice = resolveModel(current.engine, current.model)

  const group = await readTopic(user, topicRef(ref.topic))
  const release = await limiter.acquire(space.busyKey(ref))

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
