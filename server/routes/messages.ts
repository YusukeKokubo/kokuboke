import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import type { ChatEvent, Message } from '../../shared/types'
import { resolveModel, runAgent } from '../agent'
import { chatPrompt, chatSystemPrompt } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { appendMessage, readAll, readRecent } from '../store/log'
import { topicDir } from '../store/paths'
import { saveImage, withImageUrls } from '../store/image'
import { readGroupSummary, readSummary, readTopic, shouldAutoName } from '../store/topic'
import { readProfile } from '../store/user'
import { requireTopic, topicPaths } from './target'

export const messages = new Hono()

messages.on('GET', topicPaths('/messages'), async (c) => {
  const { user, ref } = await requireTopic(c)
  // 画面は全部見せる。AI に渡す窓は POST 側の readRecent だけが切る。
  const history = await readAll(user, ref)
  return c.json(history.map((m) => withImageUrls(user, ref, m)))
})

messages.on('POST', topicPaths('/messages'), async (c) => {
  const { user, ref } = await requireTopic(c)

  // トップレベルは要約の置き場なので、話しかける先は必ずその中のトピックになる。
  if (!ref.sub) {
    throw new HTTPException(400, { message: 'このトピックの中から選んで話しかけてね' })
  }

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
      saved.push(await saveImage(user, ref, file))
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
    await appendMessage(user, ref, userMessage)

    const meta = await readTopic(user, ref)
    const history = await readRecent(user, ref)

    choice = resolveModel(meta.engine, meta.model)
    systemPrompt = chatSystemPrompt({ user, topicName: meta.name })
    prompt = chatPrompt({
      profile: await readProfile(user),
      groupSummary: await readGroupSummary(user, ref),
      summary: await readSummary(user, ref),
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
      await send({ type: 'accepted', message: withImageUrls(user, ref, userMessage) })

      let answer = ''
      const events = runAgent(choice, {
        cwd: topicDir(user, ref),
        prompt,
        systemPrompt,
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
      await appendMessage(user, ref, assistantMessage)
      // 名前なしで始めたトピックは、何往復かしたところで画面から名前付けを頼む。
      await send({
        type: 'done',
        message: assistantMessage,
        shouldName: await shouldAutoName(user, ref),
      })
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
