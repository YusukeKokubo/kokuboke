import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { api } from '@/lib/api'

const CHANNEL = 'kokuboke'

let pendingPath: string | null = null
const listeners = new Set<(path: string) => void>()
let started = false
let registeredFor: string | null = null

function safePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (!raw.startsWith('/user/') && !raw.startsWith('/family/')) return null
  if (raw.startsWith('//')) return null
  return raw
}

function open(path: string): void {
  if (listeners.size === 0) {
    pendingPath = path
    return
  }
  pendingPath = null
  for (const listener of listeners) listener(path)
}

/** 通知を押した先。リスナーより先に届いた分は、着いたときに渡す。 */
export function onPushOpen(listener: (path: string) => void): () => void {
  listeners.add(listener)
  if (pendingPath) {
    const path = pendingPath
    pendingPath = null
    listener(path)
  }
  return () => {
    listeners.delete(listener)
  }
}

function dataPath(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null
  return safePath(data.path)
}

/** 通知を押して起動したときに取りこぼさないよう、描画より先に付ける。 */
export async function preparePush(): Promise<void> {
  if (started) return
  started = true

  await PushNotifications.addListener('registration', (event) => {
    const user = registeredFor
    if (!user) return
    void api.registerDevice(user, event.value).catch((error) => {
      console.warn('[push] トークンを送れませんでした', error)
    })
  })

  await PushNotifications.addListener('registrationError', (event) => {
    console.warn('[push] 登録に失敗しました', event.error)
  })

  await PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
    const path = dataPath(event.notification.data as Record<string, unknown> | undefined)
    if (path) open(path)
  })

  try {
    await PushNotifications.createChannel({
      id: CHANNEL,
      name: '返答',
      description: 'アプリを閉じているあいだに返答が終わったとき',
      importance: 5,
      visibility: 1,
      vibration: true,
    })
  } catch {
    // ブラウザや古い端末ではチャンネルが無い。
  }
}

/**
 * 名前が分かってから呼ぶ。許可を取ってトークンをその人に付ける。
 * ブラウザと、許可されなかった端末では何もしない。
 */
export async function registerPush(user: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || !user) return
  registeredFor = user
  await preparePush()

  const permission = await PushNotifications.requestPermissions()
  if (permission.receive !== 'granted') return
  await PushNotifications.register()
}

/** スペースに入った人の端末を、その人へ紐づける。 */
export function usePush(user: string): void {
  useEffect(() => {
    void registerPush(user)
  }, [user])
}
