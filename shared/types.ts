export type Role = 'user' | 'assistant'

export interface Message {
  id: string
  role: Role
  text: string
  /** /media/... 形式の URL。 */
  images: string[]
  /** ISO 8601 */
  at: string
  /** 共有スペースの user 発言だけ。個人スペースでは付けない。 */
  author?: string
}

export type EngineId = 'claude' | 'cursor'

export interface EngineInfo {
  id: EngineId
  label: string
  note: string
  models: Array<{ id: string; label: string }>
}

/**
 * 名前がまだ付いていない会話の見出し。
 * 画面は表示のたびに使う。
 */
export const NO_NAME = 'まだ名前のない話'

export interface Topic {
  /** URL の id（uuid）。 */
  slug: string
  /** まだ名前を付けていないときは空文字。画面側で仮の見出しを出す。 */
  name: string
  createdAt: string
  engine: EngineId
  model: string
  modelLabel: string
  tags: string[]
  lastMessageAt: string | null
  preview: string | null
}

export interface Tag {
  name: string
  emoji: string
  /** tags/{name}.md の中身。無ければ空文字。 */
  text: string
}

/**
 * CLI を走らせているあいだの知らせ。会話とタグの下書きで同じ形なので、
 * サーバーの流す側（streamAgent）も画面の受ける側もここを共有する。
 */
export type AgentProgressEvent =
  | { type: 'delta'; text: string }
  /**
   * 「ファイルを見ています」のような途中の様子。本文ではないので溜めずに、
   * 届いた最後の一つだけを出す。
   */
  | { type: 'activity'; label: string }
  | { type: 'error'; message: string }

/** SSE で流すイベント。 */
export type ChatEvent =
  | AgentProgressEvent
  | { type: 'accepted'; message: Message }
  /** shouldName / shouldTag が立っていたら、画面から命名・タグ付けを頼む頃合い。 */
  | { type: 'done'; message: Message; shouldName?: boolean; shouldTag?: boolean }

/**
 * タグ本文の下書き。AI はファイルを書き換えず、新しい全文を返すだけ。
 * 保存するかどうかは画面で決める。
 */
export type SummaryEvent = AgentProgressEvent | { type: 'done'; text: string; modelLabel: string }

/** ユーザー直下の profile.md。無ければ空文字。 */
export interface Profile {
  profile: string
}

/** ユーザー直下の CLAUDE.md。無ければ空文字。 */
export interface Claude {
  claude: string
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

/** いちばん新しい会話の一行。家族共有スペースの入口と管理画面が使う。 */
export interface FamilyActivityEntry {
  slug: string
  name: string
  /** 空白を畳んだ先頭〜80字。 */
  text: string
  imageCount: number
  at: string
  id: string
  /** 直近の発言が user なら、その author。共有スペースだけ付く。 */
  author?: string
}

/** 管理画面の「最新の会話」。誰の会話かが付く。 */
export type ActivityEntry = FamilyActivityEntry & { user: string }
