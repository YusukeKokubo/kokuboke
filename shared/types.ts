export type Role = 'user' | 'assistant'

export interface Message {
  id: string
  role: Role
  text: string
  /** /media/... 形式の URL。 */
  images: string[]
  /** ISO 8601 */
  at: string
}

export type EngineId = 'claude' | 'cursor'

export interface Topic {
  slug: string
  name: string
  emoji: string
  createdAt: string
  /** どのエンジンとモデルで話すか。未指定なら既定値に落ちる。 */
  engine: EngineId
  model: string
  /** 「Cursor / GPT-5.2」のような表示用の名前。 */
  modelLabel: string
  lastMessageAt: string | null
  /** 一覧に出すための直近の発言の抜粋。 */
  preview: string | null
}

export interface EngineInfo {
  id: EngineId
  label: string
  note: string
  models: Array<{ id: string; label: string }>
}

export interface TopicTemplate {
  id: string
  label: string
  description: string
  emoji: string
}

/** SSE で流すイベント。 */
export type ChatEvent =
  | { type: 'accepted'; message: Message }
  | { type: 'delta'; text: string }
  | { type: 'done'; message: Message }
  | { type: 'error'; message: string }

export type SummaryEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
