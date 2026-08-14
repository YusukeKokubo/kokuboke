import { Hono } from 'hono'
import type { ChatEvent, Message } from '../../shared/types'
import { resolveModel } from '../agent'
import { chatPrompt, chatSystemPrompt } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { BadRequestError, NotFoundError } from '../errors'
import { streamAgent } from '../lib/agent-stream'
import { appendMessage, readAll, readRecent } from '../store/log'
import { saveImage, withImageUrls } from '../store/image'
import { topicDir } from '../store/paths'
import { readTagTexts } from '../store/tag'
import { readTopic, shouldAutoName, shouldAutoTag, topicExists } from '../store/topic'
import { requireTopic, topicPaths } from './space'

export const messages = new Hono()

messages.on('GET', topicPaths('/messages'), async (c) => {
  const { space, id } = await requireTopic(c)
  const history = await readAll(space.user, id)
  return c.json(history.map((m) => withImageUrls(space.mediaSegment, id, m)))
})

messages.on('POST', topicPaths('/messages'), async (c) => {
  const { space, id } = await requireTopic(c)
  const { user } = space

  const body = await c.req.parseBody({ all: true })
  const text = typeof body.text === 'string' ? body.text : ''
  const author = space.authorOf(body)
  const files = ([] as unknown[])
    .concat(body['images'] ?? [])
    .filter((f): f is File => f instanceof File && f.size > 0)

  if (!text.trim() && files.length === 0) {
    throw new BadRequestError('メッセージが空です')
  }
  if (files.length > 4) {
    throw new BadRequestError('画像は一度に 4 枚までです')
  }

  const release = await limiter.acquire(space.busyKey(id))

  let userMessage: Message
  let prompt: string
  let systemPrompt: string
  let choice: ReturnType<typeof resolveModel>

  try {
    if (!(await topicExists(user, id))) {
      throw new NotFoundError('この会話は削除されたよ')
    }

    const saved = []
    for (const file of files) {
      saved.push(await saveImage(user, id, file))
    }

    userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: text.trim(),
      images: saved.map((s) => s.name),
      at: new Date().toISOString(),
      author,
    }

    await appendMessage(user, id, userMessage)

    const meta = await readTopic(user, id)
    const history = await readRecent(user, id)

    choice = resolveModel(meta.engine, meta.model)
    systemPrompt = chatSystemPrompt({ audience: space.audience, topicName: meta.name })
    prompt = chatPrompt({
      profile: await space.profile(),
      tags: await readTagTexts(user, meta.tags),
      history: history.filter((m) => m.id !== userMessage.id),
      text: userMessage.text,
      author,
      imagePaths: saved.map((s) => s.absPath),
    })
  } catch (error) {
    release()
    throw error
  }

  return streamAgent<ChatEvent>(c, {
    choice,
    cwd: topicDir(user, id),
    prompt,
    systemPrompt,
    release,
    tag: 'chat',
    fallback: '返答を作れませんでした',
    open: (send) =>
      send({ type: 'accepted', message: withImageUrls(space.mediaSegment, id, userMessage) }),
    close: async (answer, send) => {
      if (!(await topicExists(user, id))) {
        await send({ type: 'error', message: 'この会話は削除されたよ' }).catch(() => {})
        return
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: answer.trim(),
        images: [],
        at: new Date().toISOString(),
      }
      await appendMessage(user, id, assistantMessage)
      await send({
        type: 'done',
        message: assistantMessage,
        shouldName: await shouldAutoName(user, id),
        shouldTag: await shouldAutoTag(user, id),
      })
    },
  })
})
