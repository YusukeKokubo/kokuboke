import { BadRequestError } from '../errors'
import type { Effort, EngineId } from '../../shared/types'
import { config } from '../config'
import { claudeCode } from './claude-code'
import { cursorAgent } from './cursor'
import { ENGINES, isEffort, isEngineId } from './engines'
import type { AgentEvent, RunRequest } from './types'

export interface ModelChoice {
  engine: EngineId
  model: string
  /** 考える深さ。選べないモデルや、選んでいないときは null。 */
  effort: Effort | null
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

/**
 * 指定が無い、あるいは知らない組み合わせなら既定に落とす。
 * 深さは、そのモデルが選べるときだけ残す。モデルを変えて選べなくなったら落とす。
 */
export function resolveModel(
  engine?: string | null,
  model?: string | null,
  effort?: string | null,
): ModelChoice {
  const id: EngineId = isEngineId(engine) ? engine : config.defaultEngine
  const info = ENGINES.find((item) => item.id === id)!

  const chosen = info.models.find((item) => item.id === model)
  const modelId = chosen?.id ?? defaultModel(id)
  const known = chosen ?? info.models.find((item) => item.id === modelId)

  const depth = known?.effort && isEffort(effort) ? effort : null
  const depthLabel = depth ? info.efforts?.find((item) => item.id === depth)?.label : undefined

  return {
    engine: id,
    model: modelId,
    effort: depth,
    label: `${info.label} / ${known?.label ?? modelId}${depthLabel ? ` · ${depthLabel}` : ''}`,
  }
}

/**
 * 命名やタグ付けのような裏方の仕事向け。エンジンはトピックのものを守り
 * （ログインしているのがどちらかだけ、ということもある）、モデルだけ軽いものにする。
 */
export function lightModel(engine?: string | null): ModelChoice {
  const id: EngineId = isEngineId(engine) ? engine : config.defaultEngine
  const models: Record<EngineId, string> = {
    claude: config.claudeLightModel,
    cursor: config.cursorLightModel,
  }
  return resolveModel(id, models[id])
}

/**
 * CLI に渡す深さ。トピックで選んでいなければ CLAUDE_EFFORT を使う。
 * 段の無いモデル（Haiku 4.5 など）には、既定も含めて渡さない。
 * 受け付けはするが効かず、かえって一文字目が遅れる回があった。
 */
function effortFor(choice: ModelChoice): string | undefined {
  if (choice.effort) return choice.effort
  const info = ENGINES.find((item) => item.id === choice.engine)
  const supports = info?.models.find((item) => item.id === choice.model)?.effort === true
  return supports && config.claudeEffort ? config.claudeEffort : undefined
}

export function runAgent(
  choice: ModelChoice,
  request: Omit<RunRequest, 'model'>,
): AsyncGenerator<AgentEvent> {
  const engine = IMPLEMENTATIONS[choice.engine]
  if (!engine) {
    throw new BadRequestError('選べないモデルです')
  }
  return engine.run({ ...request, model: choice.model, effort: effortFor(choice) })
}
