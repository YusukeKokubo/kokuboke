import type {
  ChatEvent,
  EngineInfo,
  Memory,
  Message,
  SummaryEvent,
  Topic,
  TopicRef,
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

/** 子トピックは経路の途中に sub を挟んで親と区別する。 */
function topicUrl(user: string, ref: TopicRef, suffix = ''): string {
  const base = `/api/users/${path(user)}/topics/${path(ref.topic)}`
  return (ref.sub ? `${base}/sub/${path(ref.sub)}` : base) + suffix
}

interface NewTopic {
  name: string
  emoji: string
  template: string
  engine: string
  model: string
}

export const api = {
  templates: () => fetch('/api/templates').then((r) => unwrap<TopicTemplate[]>(r)),

  engines: () => fetch('/api/engines').then((r) => unwrap<EngineInfo[]>(r)),

  listTopics: (user: string) =>
    fetch(`/api/users/${path(user)}/topics`).then((r) => unwrap<Topic[]>(r)),

  getTopic: (user: string, ref: TopicRef) => fetch(topicUrl(user, ref)).then((r) => unwrap<Topic>(r)),

  createTopic: (user: string, input: NewTopic) =>
    fetch(`/api/users/${path(user)}/topics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => unwrap<Topic>(r)),

  /** トピックの中をさらに分ける。 */
  createChild: (user: string, topic: string, input: NewTopic) =>
    fetch(`/api/users/${path(user)}/topics/${path(topic)}/sub`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => unwrap<Topic>(r)),

  updateTopic: (user: string, ref: TopicRef, input: { engine: string; model: string }) =>
    fetch(topicUrl(user, ref), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => unwrap<Topic>(r)),

  listMessages: (user: string, ref: TopicRef, days = 3) =>
    fetch(topicUrl(user, ref, `/messages?days=${days}`)).then((r) => unwrap<Message[]>(r)),

  getMemory: (user: string, ref: TopicRef) =>
    fetch(topicUrl(user, ref, '/memory')).then((r) => unwrap<Memory>(r)),

  saveMemory: (user: string, ref: TopicRef, summary: string) =>
    fetch(topicUrl(user, ref, '/memory'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary }),
    }).then((r) => unwrap<Memory>(r)),
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
  ref: TopicRef,
  input: { text: string; images: File[] },
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const form = new FormData()
  form.set('text', input.text)
  for (const image of input.images) form.append('images', image)

  const res = await fetch(topicUrl(user, ref, '/messages'), {
    method: 'POST',
    body: form,
    signal,
  })
  yield* readSSE<ChatEvent>(res)
}

/**
 * 記憶の下書きを作らせる。ここではファイルは変わらない。
 * 保存するのは api.saveMemory を呼んだとき。
 */
export async function* draftSummary(
  user: string,
  ref: TopicRef,
  choice: { engine: string; model: string } | null,
  signal?: AbortSignal,
): AsyncGenerator<SummaryEvent> {
  const res = await fetch(topicUrl(user, ref, '/summary'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(choice ?? {}),
    signal,
  })
  yield* readSSE<SummaryEvent>(res)
}
