import { useEffect, useState } from 'react'
import type { Effort, EngineId, EngineInfo } from '../../shared/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface ModelSelection {
  engine: EngineId
  model: string
  /** 考える深さ。null は既定（おまかせ）。 */
  effort?: Effort | null
  /** 「Cursor / GPT-5.2」のような表示用の名前。選んだときだけ付く。 */
  label?: string
}

interface Props {
  value: ModelSelection | null
  /**
   * 選んだとき。深さを選べるモデルを押した回は、続けて深さを選べるよう
   * keepOpen が立つ。閉じるかどうかは呼ぶ側が決める。
   */
  onChange: (value: ModelSelection, options: { keepOpen: boolean }) => void
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs',
        active ? 'border-primary bg-primary text-primary-foreground' : 'bg-secondary',
      )}
    >
      {children}
    </button>
  )
}

export function ModelPicker({ value, onChange }: Props) {
  const [engines, setEngines] = useState<EngineInfo[]>([])

  useEffect(() => {
    api.engines().then(setEngines).catch(() => setEngines([]))
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {engines.map((engine) => {
        const current =
          value?.engine === engine.id ? engine.models.find((model) => model.id === value.model) : undefined
        const effort = value?.effort ?? null

        return (
          <section key={engine.id} className="flex flex-col gap-1.5">
            <header>
              <h3 className="text-sm font-medium">{engine.label}</h3>
              <p className="text-muted-foreground text-xs">{engine.note}</p>
            </header>

            <div className="flex flex-wrap gap-1.5">
              {engine.models.map((model) => (
                <Chip
                  key={model.id}
                  active={current?.id === model.id}
                  onClick={() =>
                    onChange(
                      {
                        engine: engine.id,
                        model: model.id,
                        // 同じエンジンの中で移るときは、選んであった深さを引き継ぐ。
                        effort: model.effort && current ? effort : null,
                        label: `${engine.label} / ${model.label}`,
                      },
                      { keepOpen: Boolean(model.effort && engine.efforts) },
                    )
                  }
                >
                  {model.label}
                </Chip>
              ))}
            </div>

            {current?.effort && engine.efforts && (
              <div className="mt-1 flex flex-col gap-1.5">
                <p className="text-muted-foreground text-xs">
                  考える深さ。浅いほど返事が早く、深いほどじっくり考える。
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Chip
                    active={effort === null}
                    onClick={() =>
                      onChange({ engine: engine.id, model: current.id, effort: null }, { keepOpen: false })
                    }
                  >
                    おまかせ
                  </Chip>
                  {engine.efforts.map((item) => (
                    <Chip
                      key={item.id}
                      active={effort === item.id}
                      onClick={() =>
                        onChange({ engine: engine.id, model: current.id, effort: item.id }, { keepOpen: false })
                      }
                    >
                      {item.label}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
