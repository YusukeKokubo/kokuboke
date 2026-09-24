import { HTTPException } from 'hono/http-exception'
import type { Topic } from '../../shared/types'
import { config } from '../config'
import { BadRequestError } from '../errors'
import { countUserMessages, readRecent } from '../store/log'
import { topicDir, type TopicName, type UserName } from '../store/paths'
import { readRevisions } from '../store/revision'
import { ensureTag, listTags, renameTag } from '../store/tag'
import { markNameTried, markTagTried, readTopic, renameTopic, writeTags } from '../store/topic'
import { readOrganize } from '../store/user'
import { collectAgent } from './collect'
import { lightModel } from './model'
import { parseName, parseTags } from './name'
import { namePrompt, nameSystemPrompt, tagNote, tagPrompt, tagSystemPrompt } from './prompt'

async function classifyHints(user: UserName) {
  return { revisions: await readRevisions(user), policy: await readOrganize(user) }
}

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

  const choice = lightModel(current.engine)
  let text = ''
  try {
    text = await collectAgent(choice, {
      cwd: topicDir(user, id),
      prompt: namePrompt({
        history,
        currentName: current.name || undefined,
        ...(await classifyHints(user)),
      }),
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

/**
 * 会話を読んでタグを付ける。命名と同じく、切断では止めない。
 * `retag` は人が付け直したとき。既存タグの棚も更新してよい。
 * 日常の自動 1 回では、人が直した棚は戻さない。
 */
export async function applyAutoTag(
  user: UserName,
  id: TopicName,
  input: { retag?: boolean } = {},
): Promise<Topic> {
  const retag = input.retag === true
  const current = await readTopic(user, id)
  const history = await readRecent(user, id, Math.max(config.contextDays, 14))
  if (history.length === 0) {
    throw new BadRequestError('まだ記録がありません')
  }

  const known = (await listTags(user)).map((tag) => ({
    name: tag.name,
    note: tagNote(tag.text),
    group: tag.group || undefined,
  }))
  const choice = lightModel(current.engine)
  let text = ''
  try {
    text = await collectAgent(choice, {
      cwd: topicDir(user, id),
      prompt: tagPrompt({
        history,
        known,
        topicName: current.name || undefined,
        ...(await classifyHints(user)),
      }),
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
    const tag = await ensureTag(user, raw.name, raw.emoji, raw.group)
    if (!tag) continue
    if (retag && raw.group) {
      await renameTag(user, tag, { group: raw.group })
    }
    names.push(tag)
  }
  return writeTags(user, id, [...new Set(names)], { proposed: true })
}
