import type { Message } from '../../shared/types'
import { cn } from '@/lib/utils'
import { timeLabel } from '@/lib/format'
import { Markdown } from '@/components/Markdown'

interface Props {
  message: Message
  /** 生成中は時刻を出さず、カーソルを点滅させる。 */
  streaming?: boolean
  /**
   * 「ファイルを見ています」のような途中の様子。時刻と同じ場所に出す。
   * 生成中しか届かないので、時刻と入れ替わることはない。
   */
  activity?: string | null
  /** 共有スペースで、この端末の持ち主。自分の発言かどうかの判定に使う。 */
  selfAuthor?: string
}

/**
 * 一文字目が来るまでの間。点滅する棒だけだと止まって見えるので、
 * 三つの点を順に弾ませて、待っているところだと分かるようにする。
 */
function Thinking() {
  return (
    <span className="flex h-6 items-center gap-1" role="status" aria-label="返事を考えているところ">
      {[0, 160, 320].map((delay) => (
        <span
          key={delay}
          style={{ animationDelay: `${delay}ms` }}
          className="size-1.5 animate-[thinking-dot_1.2s_ease-in-out_infinite] rounded-full bg-current"
        />
      ))}
    </span>
  )
}

export function MessageBubble({ message, streaming, activity, selfAuthor }: Props) {
  const mine =
    message.role === 'user' &&
    (selfAuthor && message.author ? message.author === selfAuthor : !message.author)

  return (
    <div className={cn('flex w-full gap-2', mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex min-w-0 max-w-[85%] flex-col gap-1', mine ? 'items-end' : 'items-start')}>
        {message.role === 'user' && message.author && (
          <span className="text-muted-foreground px-1 text-[11px]">{message.author}</span>
        )}
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
              'min-w-0 max-w-full rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed break-words',
              mine
                ? 'bg-primary text-primary-foreground rounded-br-md whitespace-pre-wrap'
                : 'bg-card text-card-foreground rounded-bl-md border',
            )}
          >
            {streaming && !message.text ? (
              <Thinking />
            ) : (
              <>
                {/* 自分の発言は打ったとおりに出す。相手の返答だけ Markdown として組む。 */}
                {mine ? message.text : <Markdown text={message.text} />}
                {streaming && (
                  <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-current align-middle" />
                )}
              </>
            )}
          </div>
        )}

        {streaming ? (
          activity && (
            <span
              role="status"
              aria-live="polite"
              className="text-muted-foreground animate-pulse px-1 text-[11px]"
            >
              {activity}
            </span>
          )
        ) : (
          <span className="text-muted-foreground px-1 text-[11px]">{timeLabel(message.at)}</span>
        )}
      </div>
    </div>
  )
}
