import {
  isGroupRef,
  type ActivityEntry,
  type ChatEvent,
  type EngineInfo,
  type GroupTopic,
  type Message,
  type SummaryEvent,
  type TemplateId,
  type Topic,
  type TopicRef,
  type TopicTemplate,
  type UpdateResult,
  type UpdateStatus,
} from '../../shared/types'

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await errorMessage(res))
  if (res.status === 204) return undefined as T
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
  return (isGroupRef(ref) ? base : `${base}/sub/${path(ref.sub)}`) + suffix
}

const json = {
  get: <T>(url: string, init?: RequestInit) => fetch(url, init).then((r) => unwrap<T>(r)),
  send: <T>(method: string, url: string, body?: unknown, init?: RequestInit) =>
    fetch(url, {
      ...init,
      method,
      headers: {
        ...init?.headers,
        ...(body === undefined ? undefined : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => unwrap<T>(r)),
}

interface NewTopic {
  name: string
  emoji: string
  template: TemplateId
  engine: string
  model: string
}

export const api = {
  templates: () => json.get<TopicTemplate[]>('/api/templates'),

  engines: () => json.get<EngineInfo[]>('/api/engines'),

  listTopics: (user: string) => json.get<GroupTopic[]>(`/api/users/${path(user)}/topics`),

  getTopic: (user: string, ref: TopicRef) => json.get<Topic>(topicUrl(user, ref)),

  createTopic: (user: string, input: NewTopic) =>
    json.send<Topic>('POST', `/api/users/${path(user)}/topics`, input),

  /** 名前も雛形も決めずに始める。フォルダ名は仮のもので、あとから付け直される。 */
  startChild: (user: string, topic: string) =>
    json.send<Topic>('POST', `/api/users/${path(user)}/topics/${path(topic)}/sub`, {}),

  updateTopic: (user: string, ref: TopicRef, input: { engine: string; model: string }) =>
    json.send<Topic>('PATCH', topicUrl(user, ref, '/model'), input),

  /** 名前を付け直す。フォルダごと動くので、返ってきた slug で経路を差し替える。 */
  renameTopic: (user: string, ref: TopicRef, input: { name: string; emoji?: string }) =>
    json.send<Topic>('PATCH', topicUrl(user, ref, '/name'), input),

  /** 会話を読んで名前を付けてもらう。こちらも slug が変わる。 */
  autoName: (user: string, ref: TopicRef) =>
    json.send<Topic>('POST', topicUrl(user, ref, '/name')),

  deleteTopic: (user: string, ref: TopicRef) => json.send<void>('DELETE', topicUrl(user, ref)),

  listMessages: (user: string, ref: TopicRef) =>
    json.get<Message[]>(topicUrl(user, ref, '/messages')),

  getSummary: (user: string, ref: TopicRef) =>
    json.get<{ summary: string }>(topicUrl(user, ref, '/summary')).then((doc) => doc.summary),

  saveSummary: (user: string, ref: TopicRef, summary: string) =>
    json
      .send<{ summary: string }>('PUT', topicUrl(user, ref, '/summary'), { summary })
      .then((doc) => doc.summary),

  getProfile: (user: string) =>
    json.get<{ profile: string }>(`/api/users/${path(user)}/profile`).then((doc) => doc.profile),

  saveProfile: (user: string, profile: string) =>
    json
      .send<{ profile: string }>('PUT', `/api/users/${path(user)}/profile`, { profile })
      .then((doc) => doc.profile),

  getClaude: (user: string) =>
    json.get<{ claude: string }>(`/api/users/${path(user)}/claude`).then((doc) => doc.claude),

  saveClaude: (user: string, claude: string) =>
    json
      .send<{ claude: string }>('PUT', `/api/users/${path(user)}/claude`, { claude })
      .then((doc) => doc.claude),

  getTopicClaude: (user: string, ref: TopicRef) =>
    json.get<{ claude: string }>(topicUrl(user, ref, '/claude')).then((doc) => doc.claude),

  saveTopicClaude: (user: string, ref: TopicRef, claude: string) =>
    json
      .send<{ claude: string }>('PUT', topicUrl(user, ref, '/claude'), { claude })
      .then((doc) => doc.claude),

  /** 動いているイメージと main のずれ。鍵が合わなければ 404 になる。 */
  updateStatus: (key: string) =>
    json.get<UpdateStatus>('/api/admin/status', { headers: { 'x-admin-token': key } }),

  /** ユーザーごとの最新の会話。詳細は各会話画面で見る。 */
  activity: (key: string) =>
    json.get<{ entries: ActivityEntry[] }>('/api/admin/activity', {
      headers: { 'x-admin-token': key },
    }),

  /**
   * Watchtower に「今見に行け」と頼む。差し替えが始まると、返事が返る前に
   * こちらが止められて接続が切れる。それは失敗ではないので、繋がらなかった
   * ときは差し替えが始まったものとして扱う（null を返す）。設定が足りない
   * などのはっきりした失敗は、サーバーが本文で返すのでそちらを投げる。
   */
  requestUpdate: (key: string): Promise<UpdateResult | null> =>
    fetch('/api/admin/update', {
      method: 'POST',
      headers: { 'x-admin-token': key },
    }).then(
      async (r) => {
        if (!r.ok) throw new Error(await errorMessage(r))
        return (await r.json()) as UpdateResult
      },
      () => null,
    ),

  /**
   * 戻ってきたかどうかと、どのコミットで動いているか。
   *
   * 期限を付けているのは、入れ替えの最中に掴んだ接続が、切れたことも返って
   * こないまま宙ぶらりんになることがあるため。期限が無いと待ちの輪がそこで
   * 止まって、いつまでも「入れ替え中」のままになる。
   */
  health: () =>
    json.get<{ ok: boolean; commit: string | null }>('/api/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    }),
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
 * 要約の下書きを作らせる。ここではファイルは変わらない。
 * 保存するのは api.saveSummary を呼んだとき。
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
