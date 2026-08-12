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

/** 動いているイメージと GitHub の main のずれ。管理画面が見る。 */
export interface UpdateStatus {
  /** このイメージを作った元のコミット。焼き込まれていなければ null。 */
  commit: string | null
  /** main の先頭。尋ねられなければ null。 */
  latest: string | null
  /** 何コミット遅れているか。分からなければ null。 */
  behind: number | null
  /** 遅れているコミットの一行目。新しい順。 */
  commits: string[]
  /**
   * docker-compose.yml が変わっているか。Watchtower はイメージを差し替えるだけで
   * コンテナの設定は今のものを引き継ぐので、これが立っている回は SSH が要る。
   */
  composeChanged: boolean
  /**
   * 文書だけの差か。ワークフローは .md と docs/ を無視するので、ここだけの
   * 違いならイメージは作られていない。押しても入れ替わらない。
   */
  docsOnly: boolean
  /** 更新を叩ける状態か（Watchtower の設定が届いているか）。 */
  canUpdate: boolean
  /** 確認そのものに失敗したときの理由。 */
  error?: string
}

/** 更新を頼んだ結果。 */
export interface UpdateResult {
  /**
   * 差し替えが始まったか。始まると返事が返る前にこちらが止められるので、
   * 「返事が返らなかった」ことをそのまま合図として扱う。
   */
  replacing: boolean
  /** 返事が返ってきたときの内訳。何も差し替わらなければ updated が 0。 */
  summary: { scanned?: number; updated?: number; failed?: number; skipped?: number } | null
}

/** 管理画面の「最近の発言」。本人の送信だけを横断した一行。 */
export interface ActivityEntry {
  user: string
  /** 器の slug。 */
  topic: string
  /** 子トピックの slug。 */
  sub: string
  topicName: string
  subName: string
  /** 子の絵文字。 */
  emoji: string
  /** 空白を畳んだ先頭〜80字。 */
  text: string
  imageCount: number
  at: string
  id: string
}
