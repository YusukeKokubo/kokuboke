import { NO_NAME } from '../../shared/types'
import { listDeviceTokens, removeDevices } from '../store/device'
import type { UserName } from '../store/paths'
import { sendFcm } from './fcm'

export interface ReplyNotice {
  recipient: UserName
  topicName: string
  path: string
}

export interface Notice {
  recipient: UserName
  title: string
  body: string
  path: string
}

/**
 * その人の端末へ知らせる。アプリが前面にいるときは OS が出さない。
 * 設定が無ければ何もしない。届いた端末の数を返す。
 */
export async function notifyUser(notice: Notice): Promise<number> {
  const tokens = await listDeviceTokens(notice.recipient)
  if (tokens.length === 0) return 0

  const payload = { title: notice.title, body: notice.body, path: notice.path }

  let sent = 0
  const gone: string[] = []
  for (const token of tokens) {
    try {
      const result = await sendFcm(token, payload)
      if (result === 'gone') gone.push(token)
      if (result === 'ok') sent++
    } catch (error) {
      console.error('[push]', error)
    }
  }
  await removeDevices(notice.recipient, gone)
  return sent
}

/** 返答が書き終わったあと、その人の端末へ知らせる。本文は載せない。 */
export async function notifyReply(notice: ReplyNotice): Promise<void> {
  await notifyUser({
    recipient: notice.recipient,
    title: notice.topicName.trim() || NO_NAME,
    body: '返答が届いたよ',
    path: notice.path,
  })
}
