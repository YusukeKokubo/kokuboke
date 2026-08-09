import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import type { ChatEvent, Message } from '../../shared/types'
import { config } from '../config'
import { resolveModel, runAgent } from '../agent'
import { chatPrompt, chatSystemPrompt } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { appendMessage, readRecent } from '../store/log'
import { assertTopicSlug, assertUser, topicDir } from '../store/paths'
import { saveImage, withImageUrls } from '../store/image'
import { readSummary, readTopic, topicExists } from '../store/topic'
import { readProfile } from '../store/user'

export const messages = new Hono()

async function requireTopic(user: string, topic: string): Promise<void> {
  if (!(await topicExists(user, topic))) {
    throw new HTTPException(404, { message: 'トピックが見つかりません' })
  }
}

messages.get('/api/users/:user/topics/:topic/messages', async (c) => {
  const user = assertUser(c.req.param('user'))
  const topic = assertTopicSlug(c.req.param('topic'))
  await requireTopic(user, topic)

  const days = Number(c.req.query('days')) || config.contextDays
  const history = await readRecent(user, topic, Math.min(Math.max(days, 1), 30))
  return c.json(history.map((m) => withImageUrls(user, topic, m)))
})

messages.post('/api/users/:user/topics/:topic/messages', async (c) => {
  const user = assertUser(c.req.param('user'))
  const topic = assertTopicSlug(c.req.param('topic'))
  await requireTopic(user, topic)

  const body = await c.req.parseBody({ all: true })
  const text = typeof body.text === 'string' ? body.text : ''
  const files = ([] as unknown[])
    .concat(body['images'] ?? [])
    .filter((f): f is File => f instanceof File && f.size > 0)

  if (!text.trim() && files.length === 0) {
    throw new HTTPException(400, { message: 'メッセージが空です' })
  }
  if (files.length > 4) {
    throw new HTTPException(400, { message: '画像は一度に 4 枚までです' })
  }

  // 空きが無ければここで待つ。同じ人の多重送信はここで 409 になる。
  // 解放はストリームを閉じるときに行う。
  const release = await limiter.acquire(user)

  let userMessage: Message
  let prompt: string
  let systemPrompt: string
  let choice: ReturnType<typeof resolveModel>

  try {
    const saved = []
    for (const file of files) {
      saved.push(await saveImage(user, topic, file))
    }

    userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: text.trim(),
      // ログに残すのはファイル名だけ。URL は返すときに組み立てる。
      images: saved.map((s) => s.name),
      at: new Date().toISOString(),
    }

    // 返答が失敗しても発言そのものは残す。あとから読み返せる方が大事。
    await appendMessage(user, topic, userMessage)

    const meta = await readTopic(user, topic)
    const history = await readRecent(user, topic)

    choice = resolveModel(meta.engine, meta.model)
    systemPrompt = chatSystemPrompt({ user, topicName: meta.name })
    prompt = chatPrompt({
      profile: await readProfile(user),
      summary: await readSummary(user, topic),
      // いま追記した分は current_message として別に渡すので履歴から外す。
      history: history.filter((m) => m.id !== userMessage.id),
      text: userMessage.text,
      imagePaths: saved.map((s) => s.absPath),
    })
  } catch (error) {
    release()
    throw error
  }

  return streamSSE(c, async (stream) => {
    const send = (event: ChatEvent) => stream.writeSSE({ data: JSON.stringify(event) })

    try {
      await send({ type: 'accepted', message: withImageUrls(user, topic, userMessage) })

      let answer = ''
      const events = runAgent(choice, {
        cwd: topicDir(user, topic),
        prompt,
        systemPrompt,
        task: 'chat',
        signal: c.req.raw.signal,
      })

      for await (const event of events) {
        if (event.type === 'delta') {
          answer += event.text
          await send({ type: 'delta', text: event.text })
        } else if (event.text.trim()) {
          // 差分を取りこぼしていても最終結果で辻褄を合わせる。
          answer = event.text
        }
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: answer.trim(),
        images: [],
        at: new Date().toISOString(),
      }
      await appendMessage(user, topic, assistantMessage)
      await send({ type: 'done', message: assistantMessage })
    } catch (error) {
      console.error('[chat]', error)
      await send({
        type: 'error',
        message: error instanceof Error ? error.message : '返答を作れませんでした',
      }).catch(() => {})
    } finally {
      release()
    }
  })
})
