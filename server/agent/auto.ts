import { HTTPException } from 'hono/http-exception'
import type { Topic } from '../../shared/types'
import { config } from '../config'
import { BadRequestError } from '../errors'
import { countUserMessages, readRecent } from '../store/log'
import { topicDir, type TopicName, type UserName } from '../store/paths'
import { ensureTag, listTags } from '../store/tag'
import { markNameTried, markTagTried, readTopic, renameTopic, writeTags } from '../store/topic'
import { collectAgent } from './collect'
import { resolveModel } from './model'
import { parseName, parseTags } from './name'
import { namePrompt, nameSystemPrompt, tagPrompt, tagSystemPrompt } from './prompt'

/**
 * 会話を読んで名前を付ける。リクエストの切断信号は見ない。
 * 画面が閉じても、返答が残ったあとなら命名は最後まで走る。
 */
export async function applyAutoName(user: UserName, id: TopicName): Promise<Topic> {
  const current = await readTopic(user, id)
  const history = await readRecent(user, id, Math.max(config.contextDays, 14))
  if (history.length === 0) {
    throw new BadRequestError('まだ記録がありません')
  }

  const choice = resolveModel(current.engine, current.model)
  let text = ''
  try {
    text = await collectAgent(choice, {
      cwd: topicDir(user, id),
      prompt: namePrompt({ history, currentName: current.name || undefined }),
      systemPrompt: nameSystemPrompt(),
    })
  } catch (error) {
    console.error('[name]', error)
  }

  const proposed = parseName(text)
  if (!proposed) {
    await markNameTried(user, id)
    throw new HTTPException(502, { message: '名前を作れませんでした' })
  }

  const autoAt = await countUserMessages(user, id)
  return renameTopic(user, id, { ...proposed, autoAt })
}

/** 会話を読んでタグを付ける。命名と同じく、切断では止めない。 */
export async function applyAutoTag(user: UserName, id: TopicName): Promise<Topic> {
  const current = await readTopic(user, id)
  const history = await readRecent(user, id, Math.max(config.contextDays, 14))
  if (history.length === 0) {
    throw new BadRequestError('まだ記録がありません')
  }

  const known = (await listTags(user)).map((tag) => tag.name)
  const choice = resolveModel(current.engine, current.model)
  let text = ''
  try {
    text = await collectAgent(choice, {
      cwd: topicDir(user, id),
      prompt: tagPrompt({ history, known }),
      systemPrompt: tagSystemPrompt(),
    })
  } catch (error) {
    console.error('[tags]', error)
  }

  const proposed = parseTags(text)
  if (proposed.length === 0) {
    await markTagTried(user, id)
    return readTopic(user, id)
  }

  const names: string[] = []
  for (const raw of proposed) {
    const tag = await ensureTag(user, raw.name, raw.emoji)
    if (tag) names.push(tag)
  }
  return writeTags(user, id, [...new Set(names)])
}
