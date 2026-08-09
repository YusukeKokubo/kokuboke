import { HTTPException } from 'hono/http-exception'
import { config } from '../config'
import { claudeCode } from './claude-code'
import { cursorAgent } from './cursor'
import type { AgentEvent, EngineId, RunRequest } from './types'

export type { AgentEvent, EngineId } from './types'

export interface ModelChoice {
  engine: EngineId
  model: string
  label: string
}

export interface EngineInfo {
  id: EngineId
  label: string
  note: string
  models: Array<{ id: string; label: string }>
}

/**
 * 画面に出す選択肢。cursor-agent 側は `cursor-agent --list-models` で
 * 出てくるもののうち、この用途に向くものを絞って載せている。
 */
export const ENGINES: EngineInfo[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    note: 'CLAUDE.md をそのまま読む。ツール単位で権限を絞れる。',
    models: [
      { id: 'claude-opus-5', label: 'Opus 5' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
    ],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    note: 'GPT や Grok も選べる。権限の絞り込みは粗い。',
    models: [
      { id: 'composer-2.5', label: 'Composer 2.5' },
      { id: 'claude-opus-5-thinking-high', label: 'Opus 5 Thinking' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
      { id: 'gpt-5.3-codex', label: 'Codex 5.3' },
      { id: 'cursor-grok-4.5-high', label: 'Grok 4.5' },
      { id: 'auto', label: 'おまかせ' },
    ],
  },
]

const IMPLEMENTATIONS = { claude: claudeCode, cursor: cursorAgent } as const

export function isEngineId(value: unknown): value is EngineId {
  return value === 'claude' || value === 'cursor'
}

/** 指定が無い、あるいは知らない組み合わせなら既定に落とす。 */
export function resolveModel(engine?: string | null, model?: string | null): ModelChoice {
  const id: EngineId = isEngineId(engine) ? engine : config.defaultEngine
  const info = ENGINES.find((item) => item.id === id)!

  const chosen = info.models.find((item) => item.id === model)
  if (chosen) return { engine: id, model: chosen.id, label: `${info.label} / ${chosen.label}` }

  const fallback = id === 'claude' ? config.claudeModel : config.cursorModel
  const known = info.models.find((item) => item.id === fallback)
  return {
    engine: id,
    model: fallback,
    label: `${info.label} / ${known?.label ?? fallback}`,
  }
}

export function runAgent(choice: ModelChoice, request: Omit<RunRequest, 'model'>): AsyncGenerator<AgentEvent> {
  const engine = IMPLEMENTATIONS[choice.engine]
  if (!engine) {
    throw new HTTPException(400, { message: '選べないモデルです' })
  }
  return engine.run({ ...request, model: choice.model })
}
