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
 * 名前がまだ付いていないトピックの見出し。
 * サーバーは作った直後の CLAUDE.md / summary.md に焼き込み、画面は表示のたびに使う。
 * 文言を変えても、すでに書いたファイルの見出しは古い方のまま残る。
 */
export const NO_NAME = 'まだ名前のない話'

/**
 * トピックの位置。入れ子は一段まで。
 * 器と子を kind で分ける。slug 未定の途中状態は ref に載せない。
 * 画面・API 用。サーバーのパス組み立ては VerifiedTopicRef（store/paths）を使う。
 */
export type TopicRef =
  | { kind: 'group'; topic: string }
  | { kind: 'child'; topic: string; sub: string }

/** 器（トップレベル）を指すか。 */
export function isGroupRef(ref: TopicRef): ref is { kind: 'group'; topic: string } {
  return ref.kind === 'group'
}

interface TopicFields {
  slug: string
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
}

/** 器。会話せず、中の子の要約の置き場として扱う。 */
export interface GroupTopic extends TopicFields {
  kind: 'group'
  group: null
  children: ChildTopic[]
}

/** 器の中の子。ここで会話する。 */
export interface ChildTopic extends TopicFields {
  kind: 'child'
  /** 器のフォルダ名。 */
  group: string
}

export type Topic = GroupTopic | ChildTopic

export type TemplateId = 'study' | 'advice' | 'recipe' | 'plain'

export interface TopicTemplate {
  id: TemplateId
  label: string
  description: string
  emoji: string
}

/**
 * CLI を走らせているあいだの知らせ。会話と要約で同じ形なので、
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
  /** shouldName が立っていたら、画面から名前付けを頼む頃合い。 */
  | { type: 'done'; message: Message; shouldName?: boolean }

/**
 * 要約の下書き。AI はファイルを書き換えず、summary.md の新しい全文を返すだけ。
 * 保存するかどうかは画面で決める。
 */
export type SummaryEvent = AgentProgressEvent | { type: 'done'; text: string; modelLabel: string }

export interface Summary {
  /** summary.md の中身。無ければ空文字。 */
  summary: string
}

/** ユーザー直下の profile.md。無ければ空文字。 */
export interface Profile {
  profile: string
}

/** ユーザー直下またはトピックの CLAUDE.md。無ければ空文字。 */
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

/** いちばん新しい子トピックの一行。家族共有スペースの入口と管理画面が使う。 */
export interface FamilyActivityEntry {
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
  /** 直近の発言が user なら、その author。共有スペースだけ付く。 */
  author?: string
}

/** 管理画面の「最新の会話」。誰の会話かが付く。 */
export type ActivityEntry = FamilyActivityEntry & { user: string }
