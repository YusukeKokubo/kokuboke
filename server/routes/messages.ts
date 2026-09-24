import { Hono } from 'hono'
import type { ChatEvent, Message } from '../../shared/types'
import { resolveModel } from '../agent'
import { applyAutoName, applyAutoTag } from '../agent/auto'
import { chatPrompt, chatSystemPrompt } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { BadRequestError, NotFoundError } from '../errors'
import { streamAgent } from '../lib/agent-stream'
import { appendMessage, readAll, readRecent } from '../store/log'
import { isDocument, saveFile } from '../store/file'
import { saveImage, withImageUrls } from '../store/image'
import { assertUser, topicDir } from '../store/paths'
import { readTagTexts } from '../store/tag'
import { readTopic, shouldAutoName, shouldAutoTag, topicExists } from '../store/topic'
import { notifyReply } from '../push/notify'
import { requireTopic, topicPaths } from './space'

export const messages = new Hono()

messages.on('GET', topicPaths('/messages'), async (c) => {
  const { space, id, slug } = await requireTopic(c)
  const history = await readAll(space.user, id)
  return c.json(history.map((m) => withImageUrls(space.mediaSegment, slug, m)))
})

messages.on('POST', topicPaths('/messages'), async (c) => {
  const { space, id, slug } = await requireTopic(c)
  const { user } = space

  const body = await c.req.parseBody({ all: true })
  const text = typeof body.text === 'string' ? body.text : ''
  const author = space.authorOf(body)
  const incoming = ([] as unknown[])
    .concat(body['images'] ?? [], body['files'] ?? [])
    .filter((f): f is File => f instanceof File && f.size > 0)

  if (!text.trim() && incoming.length === 0) {
    throw new BadRequestError('メッセージが空です')
  }
  if (incoming.length > 4) {
    throw new BadRequestError('添付は一度に 4 つまでです')
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

    const savedImages = []
    const savedFiles = []
    for (const file of incoming) {
      if (isDocument(file)) savedFiles.push(await saveFile(user, id, file))
      else savedImages.push(await saveImage(user, id, file))
    }

    userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: text.trim(),
      images: savedImages.map((s) => s.name),
      files: savedFiles.map((s) => s.name),
      at: new Date().toISOString(),
      author,
    }

    await appendMessage(user, id, userMessage)

    const meta = await readTopic(user, id)
    const history = await readRecent(user, id)

    choice = resolveModel(meta.engine, meta.model, meta.effort)
    systemPrompt = chatSystemPrompt({ audience: space.audience, topicName: meta.name })
    prompt = chatPrompt({
      profile: await space.profile(),
      memory: await space.memory(),
      tags: await readTagTexts(user, meta.tags),
      history: history.filter((m) => m.id !== userMessage.id),
      text: userMessage.text,
      author,
      imagePaths: savedImages.map((s) => s.absPath),
      filePaths: savedFiles.map((s) => s.absPath),
    })
  } catch (error) {
    release()
    throw error
  }

  let autoAfter = false

  return streamAgent<ChatEvent>(c, {
    choice,
    cwd: topicDir(user, id),
    prompt,
    systemPrompt,
    extraEnv: space.kind === 'personal' ? { KOKUBOKE_REMEMBER_USER: user } : undefined,
    release,
    tag: 'chat',
    fallback: '返答を作れませんでした',
    surviveDisconnect: true,
    open: (send) =>
      send({ type: 'accepted', message: withImageUrls(space.mediaSegment, slug, userMessage) }),
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
      const shouldName = await shouldAutoName(user, id)
      const shouldTag = await shouldAutoTag(user, id)
      autoAfter = shouldName || shouldTag
      await send({
        type: 'done',
        message: assistantMessage,
        shouldName,
        shouldTag,
      }).catch(() => {})

      const recipient = author ? assertUser(author) : space.kind === 'personal' ? user : undefined
      if (recipient) {
        const topic = await readTopic(user, id).catch(() => null)
        void notifyReply({
          recipient,
          topicName: topic?.name ?? '',
          path: space.kind === 'family' ? `/family/${slug}` : `/user/${user}/${slug}`,
        }).catch((error) => console.error('[push]', error))
      }
    },
    followUp: async () => {
      if (!autoAfter) return
      const hold = await limiter.acquireWhenFree(space.busyKey(id))
      try {
        if (await shouldAutoName(user, id)) {
          await applyAutoName(user, id).catch((error) => console.error('[name]', error))
        }
        if (await shouldAutoTag(user, id)) {
          await applyAutoTag(user, id).catch((error) => console.error('[tags]', error))
        }
      } finally {
        hold()
      }
    },
  })
})
