import { NO_NAME } from '../../shared/types'
import { listDeviceTokens, removeDevices } from '../store/device'
import type { UserName } from '../store/paths'
import { sendFcm } from './fcm'

export interface ReplyNotice {
  recipient: UserName
  topicName: string
  path: string
}

/**
 * 返答が書き終わったあと、その人の端末へ知らせる。
 * アプリが前面にいるときは OS が出さない。設定が無ければ何もしない。
 */
export async function notifyReply(notice: ReplyNotice): Promise<void> {
  const tokens = await listDeviceTokens(notice.recipient)
  if (tokens.length === 0) return

  const title = notice.topicName.trim() || NO_NAME
  const payload = {
    title,
    body: '返答が届いたよ',
    path: notice.path,
  }

  const gone: string[] = []
  for (const token of tokens) {
    try {
      const result = await sendFcm(token, payload)
      if (result === 'gone') gone.push(token)
    } catch (error) {
      console.error('[push]', error)
    }
  }
  await removeDevices(notice.recipient, gone)
}
