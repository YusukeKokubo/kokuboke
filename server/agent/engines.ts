import type { EngineId, EngineInfo } from '../../shared/types'

/**
 * 画面に出す選択肢。cursor-agent 側は `cursor-agent --list-models` で
 * 出てくるもののうち、この用途に向くものを絞って載せている。
 * エンジンを足すときは `EngineId` とここを一緒に直す。
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
    models: [
      { id: 'auto', label: 'おまかせ' },
      { id: 'composer-2.5', label: 'Composer 2.5' },
      { id: 'claude-opus-5-thinking-high', label: 'Opus 5 Thinking' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
      { id: 'gpt-5.3-codex', label: 'Codex 5.3' },
      { id: 'cursor-grok-4.5-high', label: 'Grok 4.5' },
    ],
  },
]

export function isEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && ENGINES.some((engine) => engine.id === value)
}
