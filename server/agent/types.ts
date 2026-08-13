import type { EngineId } from '../../shared/types'

export type { EngineId }

export type AgentEvent =
  | { type: 'delta'; text: string }
  /** 道具を使い始めたところ。本文ではないので、集めるときは足さない。 */
  | { type: 'activity'; label: string }
  | { type: 'done'; text: string }

export interface RunRequest {
  /** 作業ディレクトリ。トピックのフォルダを渡す。 */
  cwd: string
  /** 会話の本体。履歴や添付画像のパスを含む。 */
  prompt: string
  /** 役割の指示。エンジンによって渡し方が違う。 */
  systemPrompt: string
  model: string
  signal?: AbortSignal
}

export interface Engine {
  id: EngineId
  /** 実行ファイルが見つからないときに投げる。 */
  run(request: RunRequest): AsyncGenerator<AgentEvent>
}
