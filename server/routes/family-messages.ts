import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { ChatEvent, Message } from '../../shared/types'
import { collectAgent, resolveModel } from '../agent'
import { familyChatPrompt, familyChatSystemPrompt } from '../agent/prompt'
import { limiter } from '../agent/queue'
import { BadRequestError, NotFoundError } from '../errors'
import { sse } from '../lib/sse'
import { appendMessage, readAll, readRecent } from '../store/log'
import { saveImage, withFamilyImageUrls } from '../store/image'
import { assertAuthor, familyBusyKey, isGroupRef, topicDir } from '../store/paths'
import { readGroupSummary, readSummary, readTopic, shouldAutoName, topicExists } from '../store/topic'
import { familyTopicPaths, requireFamilyTopic } from './family-target'

export const familyMessages = new Hono()

familyMessages.on('GET', familyTopicPaths('/messages'), async (c) => {
  const { user, ref } = await requireFamilyTopic(c)
  // 画面は全部見せる。AI に渡す窓は POST 側の readRecent だけが切る。
  const history = await readAll(user, ref)
  return c.json(history.map((m) => withFamilyImageUrls(ref, m)))
})

familyMessages.on('POST', familyTopicPaths('/messages'), async (c) => {
  const { user, ref } = await requireFamilyTopic(c)

  // トップレベルは要約の置き場なので、話しかける先は必ずその中のトピックになる。
  if (isGroupRef(ref)) {
    throw new BadRequestError('このトピックの中から選んで話しかけてね')
  }

  const body = await c.req.parseBody({ all: true })
  const text = typeof body.text === 'string' ? body.text : ''
  const authorRaw = typeof body.author === 'string' ? body.author.trim() : ''
  if (!authorRaw) {
    throw new BadRequestError('発言者を指定してください')
  }
  const author = assertAuthor(authorRaw)

  const files = ([] as unknown[])
    .concat(body['images'] ?? [])
    .filter((f): f is File => f instanceof File && f.size > 0)

  if (!text.trim() && files.length === 0) {
    throw new BadRequestError('メッセージが空です')
  }
  if (files.length > 4) {
    throw new BadRequestError('画像は一度に 4 枚までです')
  }

  // 空きが無ければここで待つ。同じ人の多重送信はここで 409 になる。
  // 解放はストリームを閉じるときに行う。
  const release = await limiter.acquire(familyBusyKey(ref))

  let userMessage: Message
  let prompt: string
  let systemPrompt: string
  let choice: ReturnType<typeof resolveModel>

  try {
    // 入口の requireTopic から順番待ちを抜けるまでの間に削除が挟まりうる。
    // saveImage も appendMessage も mkdir するので、確かめずに書くと
    // topic.json の無いフォルダが復活し、同じ名前で作り直したときに紛れ込む。
    if (!(await topicExists(user, ref))) {
      throw new NotFoundError('このトピックは削除されたよ')
    }

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
      author,
    }

    // 返答が失敗しても発言そのものは残す。あとから読み返せる方が大事。
    await appendMessage(user, ref, userMessage)

    const meta = await readTopic(user, ref)
    const history = await readRecent(user, ref)

    choice = resolveModel(meta.engine, meta.model)
    systemPrompt = familyChatSystemPrompt({ topicName: meta.name })
    prompt = familyChatPrompt({
      groupSummary: await readGroupSummary(user, ref),
      summary: await readSummary(user, ref),
      // いま追記した分は current_message として別に渡すので履歴から外す。
      history: history.filter((m) => m.id !== userMessage.id),
      text: userMessage.text,
      author,
      imagePaths: saved.map((s) => s.absPath),
    })
  } catch (error) {
    release()
    throw error
  }

  return streamSSE(c, async (stream) => {
    const send = sse<ChatEvent>(stream)

    try {
      await send({ type: 'accepted', message: withFamilyImageUrls(ref, userMessage) })

      const answer = await collectAgent(
        choice,
        {
          cwd: topicDir(user, ref),
          prompt,
          systemPrompt,
          signal: c.req.raw.signal,
        },
        {
          onDelta: async (text) => {
            await send({ type: 'delta', text })
          },
          onActivity: async (label) => {
            await send({ type: 'activity', label })
          },
        },
      )

      // 待っているあいだにトピックが消されていることがある。appendMessage は
      // logs を作り直してしまうので、書く前に実体があるかを見る。
      if (!(await topicExists(user, ref))) {
        await send({ type: 'error', message: 'このトピックは削除されたよ' }).catch(() => {})
        return
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
