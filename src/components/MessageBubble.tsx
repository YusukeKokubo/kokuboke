import { useEffect, useRef, useState } from 'react'
import { Check, Copy, FileText, X } from 'lucide-react'
import type { Message } from '../../shared/types'
import { cn } from '@/lib/utils'
import { copyText } from '@/lib/clipboard'
import { timeLabel } from '@/lib/format'
import { Markdown } from '@/components/Markdown'

function fileLabel(url: string): string {
  const stored = decodeURIComponent(url.split('/').pop() ?? url)
  // 保存名は YYYYMMDD_HHMMSS_xxxx_元の名前.ext
  const match = stored.match(/^\d{8}_\d{6}_[0-9a-f]{4}_(.+)$/)
  return match?.[1] ?? stored
}

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

/**
 * 返答を Markdown のままクリップボードへ写す。
 * 押したあと少しの間だけ印を変えて、写ったことを知らせる。
 */
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const onClick = async () => {
    const ok = await copyText(text)
    setState(ok ? 'done' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1500)
  }

  const Icon = state === 'done' ? Check : state === 'failed' ? X : Copy
  const label = state === 'done' ? 'コピーしました' : state === 'failed' ? 'コピーできませんでした' : 'コピー'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:text-foreground -m-1.5 rounded p-1.5"
    >
      <Icon className="size-3.5" />
    </button>
  )
}

export function MessageBubble({ message, streaming, activity, selfAuthor }: Props) {
  // 誰かが打った文は、自分のでも他の人のでも打ったとおりに出す。
  // 右に寄せるのは自分の分だけ。
  const typed = message.role === 'user'
  const mine =
    typed && (selfAuthor && message.author ? message.author === selfAuthor : !message.author)

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

        {(message.files ?? []).length > 0 && (
          <div className={cn('flex flex-wrap gap-1.5', mine ? 'justify-end' : 'justify-start')}>
            {(message.files ?? []).map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  'flex max-w-full items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[13px]',
                  mine ? 'bg-primary text-primary-foreground' : 'bg-card text-card-foreground',
                )}
              >
                <FileText className="size-3.5 shrink-0" />
                <span className="truncate">{fileLabel(url)}</span>
              </a>
            ))}
          </div>
        )}

        {(message.text || streaming) && (
          <div
            className={cn(
              'min-w-0 max-w-full rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed break-words',
              mine
                ? 'bg-primary text-primary-foreground rounded-br-md'
                : 'bg-card text-card-foreground rounded-bl-md border',
              typed && 'whitespace-pre-wrap',
            )}
          >
            {streaming && !message.text ? (
              <Thinking />
            ) : (
              <>
                {/* 人が打った文はそのまま。返答だけ Markdown として組む。 */}
                {typed ? message.text : <Markdown text={message.text} />}
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
          <div className="flex items-center gap-1 px-1">
            <span className="text-muted-foreground text-[11px]">{timeLabel(message.at)}</span>
            {!typed && message.text && <CopyButton text={message.text} />}
          </div>
        )}
      </div>
    </div>
  )
}
