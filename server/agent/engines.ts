import type { EngineId, EngineInfo } from '../../shared/types'

/**
 * 画面に出す選択肢。cursor-agent 側は `cursor-agent --list-models` で
 * 出てくるもののうち、この用途に向くものを絞って載せている。
 * エンジンを足すときは `EngineId` とここを一緒に直す。
 *
 * 向こうの一覧は入れ替わりが早い。ここに無い id をトピックが持っていても
 * resolveModel が既定に落とすので落ちはしないが、黙って別のモデルになる。
 * 消すときは data の下で使われていないかを見てから消す。
 *
 * ここでは config を読まない。config がこのファイルを読むため（循環になる）。
 */
export const ENGINES: EngineInfo[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    note: 'CLAUDE.md をそのまま読む。',
    models: [
      { id: 'claude-opus-5', label: 'Opus 5' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
    ],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    note: 'GPT や Grok も選べる。',
    // 思考の深さは id に埋まっている（low / medium / high / xhigh / max）。
    // 家族が選ぶ画面なので段は並べず、用途ごとに一つずつ載せる。
    models: [
      { id: 'auto', label: 'おまかせ' },
      { id: 'composer-2.5', label: 'Composer 2.5' },
      { id: 'claude-sonnet-5-thinking-high', label: 'Sonnet 5 Thinking' },
      { id: 'claude-opus-5-thinking-high', label: 'Opus 5 Thinking' },
      { id: 'gpt-5.6-sol-high', label: 'GPT-5.6' },
      { id: 'gpt-5.3-codex', label: 'Codex 5.3' },
      { id: 'cursor-grok-4.6-high', label: 'Grok 4.6' },
      { id: 'kimi-k3-high', label: 'Kimi K3' },
    ],
  },
]

export function isEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && ENGINES.some((engine) => engine.id === value)
}
