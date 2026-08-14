import { BadRequestError } from '../errors'
import type { EngineId } from '../../shared/types'
import { config } from '../config'
import { claudeCode } from './claude-code'
import { cursorAgent } from './cursor'
import { ENGINES, isEngineId } from './engines'
import type { AgentEvent, RunRequest } from './types'

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

export function runAgent(
  choice: ModelChoice,
  request: Omit<RunRequest, 'model'>,
): AsyncGenerator<AgentEvent> {
  const engine = IMPLEMENTATIONS[choice.engine]
  if (!engine) {
    throw new BadRequestError('選べないモデルです')
  }
  return engine.run({ ...request, model: choice.model })
}
