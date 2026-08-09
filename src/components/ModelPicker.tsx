import { useEffect, useState } from 'react'
import type { EngineId, EngineInfo } from '../../shared/types'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

export interface ModelSelection {
  engine: EngineId
  model: string
  /** 「Cursor / GPT-5.2」のような表示用の名前。選んだときだけ付く。 */
  label?: string
}

interface Props {
  value: ModelSelection | null
  onChange: (value: ModelSelection) => void
}

export function ModelPicker({ value, onChange }: Props) {
  const [engines, setEngines] = useState<EngineInfo[]>([])

  useEffect(() => {
    api.engines().then(setEngines).catch(() => setEngines([]))
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {engines.map((engine) => (
        <section key={engine.id} className="flex flex-col gap-1.5">
          <header>
            <h3 className="text-sm font-medium">{engine.label}</h3>
            <p className="text-muted-foreground text-xs">{engine.note}</p>
          </header>

          <div className="flex flex-wrap gap-1.5">
            {engine.models.map((model) => {
              const active = value?.engine === engine.id && value.model === model.id
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() =>
                    onChange({
                      engine: engine.id,
                      model: model.id,
                      label: `${engine.label} / ${model.label}`,
                    })
                  }
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs',
                    active ? 'border-primary bg-primary text-primary-foreground' : 'bg-secondary',
                  )}
                >
                  {model.label}
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
