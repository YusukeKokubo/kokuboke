import type { Effort, EngineId, EngineInfo } from '../../shared/types'

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
    note: 'AGENTS.md をそのまま読む。',
    models: [
      { id: 'claude-opus-5-5', label: 'Opus 5.5', effort: true },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', effort: true },
      { id: 'claude-haiku-5-5', label: 'Haiku 5.5', effort: true },
    ],
    efforts: [
      { id: 'low', label: '浅め' },
      { id: 'medium', label: 'ふつう' },
      { id: 'high', label: '深め' },
      { id: 'xhigh', label: 'もっと深く' },
      { id: 'max', label: 'いちばん深く' },
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
      { id: 'claude-sonnet-5-5-high', label: 'Sonnet 5.5' },
      { id: 'claude-opus-5-5-high', label: 'Opus 5.5' },
      { id: 'gpt-5.6-sol-high', label: 'GPT-5.6' },
      { id: 'gpt-5.3-codex', label: 'Codex 5.3' },
      { id: 'grok-4.7-high', label: 'Grok 4.7' },
      { id: 'kimi-k3-high', label: 'Kimi K3' },
    ],
  },
]

export function isEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && ENGINES.some((engine) => engine.id === value)
}

/** Claude Code の --effort に渡せる値。config もここから引く。 */
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
}
