import type { Message } from '../../shared/types'
import { cn } from '@/lib/utils'
import { timeLabel } from '@/lib/format'

interface Props {
  message: Message
  /** 生成中は時刻を出さず、カーソルを点滅させる。 */
  streaming?: boolean
}

export function MessageBubble({ message, streaming }: Props) {
  const mine = message.role === 'user'

  return (
    <div className={cn('flex w-full gap-2', mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex max-w-[85%] flex-col gap-1', mine ? 'items-end' : 'items-start')}>
        {message.images.length > 0 && (
          <div className={cn('flex flex-wrap gap-1.5', mine ? 'justify-end' : 'justify-start')}>
            {message.images.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  className="max-h-56 w-auto rounded-xl border object-cover"
                />
              </a>
            ))}
          </div>
        )}

        {(message.text || streaming) && (
          <div
            className={cn(
              'rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words',
              mine
                ? 'bg-primary text-primary-foreground rounded-br-md'
                : 'bg-card text-card-foreground rounded-bl-md border',
            )}
          >
            {message.text}
            {streaming && (
              <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-current align-middle" />
            )}
          </div>
        )}

        {!streaming && (
          <span className="text-muted-foreground px-1 text-[11px]">{timeLabel(message.at)}</span>
        )}
      </div>
    </div>
  )
}
