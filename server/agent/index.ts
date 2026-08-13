import { HTTPException } from 'hono/http-exception'
import type { EngineId } from '../../shared/types'
import { config } from '../config'
import { claudeCode } from './claude-code'
import { cursorAgent } from './cursor'
import { ENGINES, isEngineId } from './engines'
import type { AgentEvent, RunRequest } from './types'

export type { AgentEvent, EngineId } from './types'
export type { EngineInfo } from '../../shared/types'
export { ENGINES, isEngineId } from './engines'

export interface ModelChoice {
  engine: EngineId
  model: string
  label: string
}

const IMPLEMENTATIONS = { claude: claudeCode, cursor: cursorAgent } as const

/** エンジンごとの会話用の既定モデル。EngineId を増やすとここも型で迫られる。 */
function defaultModel(engine: EngineId): string {
  const models: Record<EngineId, string> = {
    claude: config.claudeModel,
    cursor: config.cursorModel,
  }
  return models[engine]
}

/** 指定が無い、あるいは知らない組み合わせなら既定に落とす。 */
export function resolveModel(engine?: string | null, model?: string | null): ModelChoice {
  const id: EngineId = isEngineId(engine) ? engine : config.defaultEngine
  const info = ENGINES.find((item) => item.id === id)!

  const chosen = info.models.find((item) => item.id === model)
  if (chosen) return { engine: id, model: chosen.id, label: `${info.label} / ${chosen.label}` }

  const fallback = defaultModel(id)
  const known = info.models.find((item) => item.id === fallback)
  return {
    engine: id,
    model: fallback,
    label: `${info.label} / ${known?.label ?? fallback}`,
  }
}

/**
 * 要約・命名向け。Claude のときは SUMMARY_MODEL、Cursor のときは会話と同じ既定。
 */
export function resolveSummaryModel(): ModelChoice {
  const model =
    config.summaryEngine === 'claude' ? config.summaryModel : defaultModel(config.summaryEngine)
  return resolveModel(config.summaryEngine, model)
}

export function runAgent(choice: ModelChoice, request: Omit<RunRequest, 'model'>): AsyncGenerator<AgentEvent> {
  const engine = IMPLEMENTATIONS[choice.engine]
  if (!engine) {
    throw new HTTPException(400, { message: '選べないモデルです' })
  }
  return engine.run({ ...request, model: choice.model })
}
