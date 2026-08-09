import type {
  ChatEvent,
  EngineInfo,
  Message,
  SummaryEvent,
  Topic,
  TopicTemplate,
} from '../../shared/types'

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await errorMessage(res))
  return (await res.json()) as T
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    // JSON で返ってこないこともある
  }
  return `通信に失敗しました (${res.status})`
}

/** 名前に日本語や空白が入るので、経路に埋める前に必ず通す。 */
function path(segment: string): string {
  return encodeURIComponent(segment)
}

export const api = {
  templates: () => fetch('/api/templates').then((r) => unwrap<TopicTemplate[]>(r)),

  engines: () => fetch('/api/engines').then((r) => unwrap<EngineInfo[]>(r)),

  listTopics: (user: string) =>
    fetch(`/api/users/${path(user)}/topics`).then((r) => unwrap<Topic[]>(r)),

  getTopic: (user: string, topic: string) =>
    fetch(`/api/users/${path(user)}/topics/${path(topic)}`).then((r) => unwrap<Topic>(r)),

  createTopic: (
    user: string,
    input: { name: string; emoji: string; template: string; engine: string; model: string },
  ) =>
    fetch(`/api/users/${path(user)}/topics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => unwrap<Topic>(r)),

  updateTopic: (user: string, topic: string, input: { engine: string; model: string }) =>
    fetch(`/api/users/${path(user)}/topics/${path(topic)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => unwrap<Topic>(r)),

  listMessages: (user: string, topic: string, days = 3) =>
    fetch(`/api/users/${path(user)}/topics/${path(topic)}/messages?days=${days}`).then((r) =>
      unwrap<Message[]>(r),
    ),
}

/** fetch のボディから SSE の data 行だけを取り出す。 */
async function* readSSE<T>(res: Response): AsyncGenerator<T> {
  if (!res.ok) throw new Error(await errorMessage(res))
  if (!res.body) throw new Error('応答を受け取れませんでした')

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value

      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue
          try {
            yield JSON.parse(line.slice(5).trim()) as T
          } catch {
            // 壊れた行は読み飛ばす
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

export async function* sendMessage(
  user: string,
  topic: string,
  input: { text: string; images: File[] },
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const form = new FormData()
  form.set('text', input.text)
  for (const image of input.images) form.append('images', image)

  const res = await fetch(`/api/users/${path(user)}/topics/${path(topic)}/messages`, {
    method: 'POST',
    body: form,
    signal,
  })
  yield* readSSE<ChatEvent>(res)
}

export async function* updateSummary(
  user: string,
  topic: string,
  signal?: AbortSignal,
): AsyncGenerator<SummaryEvent> {
  const res = await fetch(`/api/users/${path(user)}/topics/${path(topic)}/summary`, {
    method: 'POST',
    signal,
  })
  yield* readSSE<SummaryEvent>(res)
}
