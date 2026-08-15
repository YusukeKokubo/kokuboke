import type {
  ActivityEntry,
  ChatEvent,
  Claude,
  EngineInfo,
  FamilyActivityEntry,
  Message,
  Profile,
  SummaryEvent,
  Tag,
  Topic,
  UpdateResult,
  UpdateStatus,
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

/** `{ text: … }` のように一つだけ包んで返る口から、中身を取り出す。 */
function only<K extends string>(key: K) {
  return (doc: Record<K, string>) => doc[key]
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
  name?: string
  engine?: string
  model?: string
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

/**
 * スペースに縛った API の面。どのスペースかは経路の根（`base`）だけの違いなので、
 * 呼ぶ側は会話の id だけ渡せばよい。共有スペースでは発言に名前が付く。
 */
export function spaceApi(base: string, author?: string) {
  const at = (id: string, suffix = ''): string => `${base}/topics/${path(id)}${suffix}`
  const tagAt = (tag: string, suffix = ''): string => `${base}/tags/${path(tag)}${suffix}`

  return {
    listTopics: () => json.get<Topic[]>(`${base}/topics`),

    getTopic: (id: string) => json.get<Topic>(at(id)),

    createTopic: (input: NewTopic = {}) => json.send<Topic>('POST', `${base}/topics`, input),

    updateTopic: (id: string, input: { engine: string; model: string }) =>
      json.send<Topic>('PATCH', at(id, '/model'), input),

    /** 見出しを変える。URL は動かない。新しい会話はフォルダ名も合わせる。 */
    renameTopic: (id: string, input: { name: string }) =>
      json.send<Topic>('PATCH', at(id, '/name'), input),

    autoName: (id: string) => json.send<Topic>('POST', at(id, '/name')),

    writeTags: (id: string, tags: string[]) =>
      json.send<Topic>('PATCH', at(id, '/tags'), { tags }),

    autoTag: (id: string) => json.send<Topic>('POST', at(id, '/tags')),

    deleteTopic: (id: string) => json.send<void>('DELETE', at(id)),

    listMessages: (id: string) => json.get<Message[]>(at(id, '/messages')),

    listTags: () => json.get<Tag[]>(`${base}/tags`),

    createTag: (input: { name: string; text?: string; emoji?: string }) =>
      json.send<Tag>('POST', `${base}/tags`, input),

    getTag: (tag: string) => json.get<Tag>(tagAt(tag)),

    saveTag: (tag: string, text: string) =>
      json.send<Tag>('PUT', tagAt(tag), { text }).then((doc) => doc.text),

    renameTag: (tag: string, input: { name?: string; emoji?: string }) =>
      json.send<Tag>('PATCH', tagAt(tag), input),

    deleteTag: (tag: string) => json.send<void>('DELETE', tagAt(tag)),

    getClaude: () => json.get<Claude>(`${base}/claude`).then(only('claude')),

    saveClaude: (claude: string) =>
      json.send<Claude>('PUT', `${base}/claude`, { claude }).then(only('claude')),

    /**
     * 発言を送って、返答を受け取りながら流す。
     * 返答中に重ねて送ると 409 が返り、readSSE がその文言のまま投げる。
     */
    sendMessage: async function* (
      id: string,
      input: { text: string; images: File[] },
      signal?: AbortSignal,
    ): AsyncGenerator<ChatEvent> {
      const form = new FormData()
      form.set('text', input.text)
      if (author) form.set('author', author)
      for (const image of input.images) form.append('images', image)

      const res = await fetch(at(id, '/messages'), { method: 'POST', body: form, signal })
      yield* readSSE<ChatEvent>(res)
    },

    /**
     * タグ本文の下書きを作らせる。ここではファイルは変わらない。
     * 保存するのは saveTag を呼んだとき。
     */
    draftTag: async function* (tag: string, signal?: AbortSignal): AsyncGenerator<SummaryEvent> {
      const res = await fetch(tagAt(tag, '/draft'), { method: 'POST', signal })
      yield* readSSE<SummaryEvent>(res)
    },
  }
}

export type SpaceApi = ReturnType<typeof spaceApi>

/** どのスペースにも属さない口。エンジンの一覧と、管理画面と、profile.md。 */
export const api = {
  engines: () => json.get<EngineInfo[]>('/api/engines'),

  /** 共有スペースの直近の一行。個人の会話一覧の入口に出す。 */
  familyActivity: () =>
    json
      .get<{ entry: FamilyActivityEntry | null }>('/api/family/activity')
      .then((doc) => doc.entry),

  // profile.md は本人の人物像なので個人のスペースだけ。共有スペースには無い。
  getProfile: (user: string) =>
    json.get<Profile>(`/api/users/${path(user)}/profile`).then(only('profile')),

  saveProfile: (user: string, profile: string) =>
    json.send<Profile>('PUT', `/api/users/${path(user)}/profile`, { profile }).then(only('profile')),

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
    json.get<{ ok: boolean; users: string[]; commit: string | null }>('/api/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    }),
}
