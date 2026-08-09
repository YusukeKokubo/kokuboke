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

/**
 * トピックの位置。`sub` があれば、そのトピックの中の子トピックを指す。
 * 入れ子は一段までで、それ以上は掘らない。
 */
export interface TopicRef {
  topic: string
  sub?: string
}

export interface Topic {
  slug: string
  /** 子トピックなら親のフォルダ名。トップレベルなら null。 */
  parent: string | null
  /** まだ名前を付けていないサブトピックでは空文字。画面側で仮の見出しを出す。 */
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
  /**
   * 中で分けている子トピック。一つでもあれば、そのトピック自身では会話せず、
   * 記憶の置き場として扱う。子トピックの側では常に空。
   */
  children: Topic[]
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
  /** shouldName が立っていたら、画面から名前付けを頼む頃合い。 */
  | { type: 'done'; message: Message; shouldName?: boolean }
  | { type: 'error'; message: string }

/**
 * 記憶の下書き。AI はファイルを書き換えず、summary.md の新しい全文を返すだけ。
 * 保存するかどうかは画面で決める。
 */
export type SummaryEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string; modelLabel: string }
  | { type: 'error'; message: string }

export interface Memory {
  /** summary.md の中身。無ければ空文字。 */
  summary: string
}
