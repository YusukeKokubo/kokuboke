export type EngineId = 'claude' | 'cursor'

export type AgentEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string }

export interface RunRequest {
  /** 作業ディレクトリ。トピックのフォルダを渡す。 */
  cwd: string
  /** 会話の本体。履歴や添付画像のパスを含む。 */
  prompt: string
  /** 役割の指示。エンジンによって渡し方が違う。 */
  systemPrompt: string
  /**
   * 人物とトピックの CLAUDE.md をつないだもの。
   * Claude Code は自分で読むので使わないが、cursor-agent には本文に混ぜて渡す。
   */
  persona: string
  /** chat は読み取りのみ。summary はファイルの書き換えを伴う。 */
  task: 'chat' | 'summary'
  model: string
  /** cwd の外にも触らせたいときに渡す。 */
  addDirs?: string[]
  signal?: AbortSignal
}

export interface Engine {
  id: EngineId
  /** 実行ファイルが見つからないときに投げる。 */
  run(request: RunRequest): AsyncGenerator<AgentEvent>
}
