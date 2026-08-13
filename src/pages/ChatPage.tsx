import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, NotebookPen, Pencil, ScrollText } from 'lucide-react'
import type { Message, Topic } from '../../shared/types'
import { api, sendMessage } from '@/lib/api'
import { dayKey, dayLabel, topicLabel } from '@/lib/format'
import { rememberUser } from '@/lib/remember'
import { topicHref } from '@/lib/route'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Composer } from '@/components/Composer'
import { TopicClaudeDialog } from '@/components/DocDialog'
import { SummaryDialog } from '@/components/SummaryDialog'
import { MessageBubble } from '@/components/MessageBubble'
import { ModelPicker } from '@/components/ModelPicker'
import { RenameDialog } from '@/components/RenameDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Status = 'idle' | 'sending'

/** 中のトピック（会話）の画面。入力・履歴・SSE・スクロール追従を持つ。 */
export default function ChatPage() {
  const { user = '', topic = '', sub = '' } = useParams()
  const navigate = useNavigate()
  const ref = useMemo(() => ({ kind: 'child' as const, topic, sub }), [topic, sub])

  const [meta, setMeta] = useState<Topic | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState<Message | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [modelOpen, setModelOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [claudeOpen, setClaudeOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)

  const content = useRef<HTMLElement>(null)
  const stick = useRef(true)

  /**
   * 入力欄は sticky で本文の上に重なる。目印の要素に寄せると入力欄の高さだけ足りないので、
   * 画面そのものを下端まで動かす。
   *
   * なめらかに動かさないのは、動いている途中の位置が下の見張りに「自分で上に戻った」と
   * 見えてしまうため。追いかけるのをそこでやめてしまう。
   */
  const scrollToBottom = useCallback(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([api.getTopic(user, ref), api.listMessages(user, ref)])
      .then(([topicMeta, history]) => {
        if (cancelled) return
        rememberUser(user)
        setMeta(topicMeta)
        setMessages(history)
        // 初回は履歴の一番下から始める。ただしここで測れる高さはまだ仮のもので、
        // 画像や数式が入るぶん後から伸びる。追いかけるのは下の見張りの役。
        requestAnimationFrame(scrollToBottom)
      })
      .catch((cause: Error) => !cancelled && setNotice(cause.message))
    return () => {
      cancelled = true
    }
  }, [user, ref, scrollToBottom])

  // 自分で上に遡っている最中は、追記のたびに引き戻さない。
  useEffect(() => {
    const onScroll = () => {
      const gap = document.documentElement.scrollHeight - window.scrollY - window.innerHeight
      stick.current = gap < 120
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (stick.current) scrollToBottom()
  }, [messages, draft, scrollToBottom])

  /**
   * 画像や数式は描いた後から高さが決まる。飛んだ時点の一番下は本当の一番下ではないので、
   * 本文が伸びるたびに追い直す。下に張り付いているときだけなのは追記と同じ扱い。
   */
  useEffect(() => {
    const el = content.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (stick.current) scrollToBottom()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollToBottom])

  /** 名前が変わるとフォルダも動く。経路を新しい slug に差し替える。 */
  const moveTo = useCallback(
    (next: Topic) => {
      setMeta(next)
      if (next.slug !== sub) {
        navigate(topicHref(user, { kind: 'child', topic, sub: next.slug }), { replace: true })
      }
    },
    [navigate, sub, topic, user],
  )

  /**
   * 会話を読んで名前を付けてもらう。時間はかかるが返事を待たせるものではないので、
   * 失敗しても画面には出さず、名前なしのままにしておく。
   */
  const putName = useCallback(async () => {
    try {
      moveTo(await api.autoName(user, ref))
    } catch (cause) {
      console.warn('[name]', cause)
    }
  }, [moveTo, ref, user])

  async function handleSend(input: { text: string; images: File[] }) {
    setStatus('sending')
    setNotice(null)
    stick.current = true

    try {
      for await (const event of sendMessage(user, ref, input)) {
        switch (event.type) {
          case 'accepted':
            setMessages((prev) => [...prev, event.message])
            setDraft({
              id: 'draft',
              role: 'assistant',
              text: '',
              images: [],
              at: new Date().toISOString(),
            })
            break
          case 'delta':
            setDraft((prev) => (prev ? { ...prev, text: prev.text + event.text } : prev))
            break
          case 'done':
            setDraft(null)
            setMessages((prev) => [...prev, event.message])
            if (event.shouldName) void putName()
            break
          case 'error':
            setDraft(null)
            setNotice(event.message)
            break
        }
      }
    } catch (cause) {
      setDraft(null)
      setNotice(cause instanceof Error ? cause.message : '送信できませんでした')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-2 pt-[calc(0.5rem+var(--safe-top))] backdrop-blur">
        <Link
          to={`/user/${encodeURIComponent(user)}`}
          aria-label="トピック一覧に戻る"
          className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'size-9 shrink-0' })}
        >
          <ChevronLeft className="size-5" />
        </Link>

        <div className="min-w-0 flex-1">
          {meta?.kind === 'child' && (
            <p className="text-muted-foreground truncate text-[11px]">{meta.group}</p>
          )}
          <button
            type="button"
            onClick={() => meta && setRenameOpen(true)}
            className="flex max-w-full items-center gap-1"
          >
            <h1
              className={cn(
                'truncate text-[15px] font-semibold',
                meta && !meta.name && 'text-muted-foreground',
              )}
            >
              {meta ? `${meta.emoji} ${topicLabel(meta)}` : '…'}
            </h1>
            <Pencil className="text-muted-foreground size-3 shrink-0" />
          </button>
          {meta && (
            <button
              type="button"
              onClick={() => setModelOpen(true)}
              className="text-muted-foreground truncate text-[11px] underline-offset-2 hover:underline"
            >
              {meta.modelLabel}
            </button>
          )}
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => setClaudeOpen(true)}
          disabled={status !== 'idle'}
          className="shrink-0"
        >
          <ScrollText className="size-4" />
          CLAUDE.md
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSummaryOpen(true)}
          disabled={status !== 'idle'}
          className="shrink-0"
        >
          <NotebookPen className="size-4" />
          要約
        </Button>
      </header>

      <main ref={content} className="flex flex-1 flex-col gap-3 px-3 py-4">
        {messages.length === 0 && !draft && (
          <p className="text-muted-foreground py-16 text-center text-sm">
            まだ会話がないよ。話しかけてみて。
          </p>
        )}

        {messages.map((message, index) => {
          const previous = messages[index - 1]
          const newDay = !previous || dayKey(previous.at) !== dayKey(message.at)
          return (
            <div key={message.id} className="flex flex-col gap-3">
              {newDay && (
                <div className="text-muted-foreground py-1 text-center text-[11px]">
                  {dayLabel(message.at)}
                </div>
              )}
              <MessageBubble message={message} />
            </div>
          )
        })}

        {draft && <MessageBubble message={draft} streaming />}

        {notice && (
          <p className="text-muted-foreground bg-secondary mx-auto rounded-full px-3 py-1.5 text-center text-xs">
            {notice}
          </p>
        )}
      </main>

      <Composer disabled={status !== 'idle'} onSend={handleSend} />

      <Dialog open={modelOpen} onOpenChange={setModelOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>このトピックで使うモデル</DialogTitle>
            <DialogDescription>
              変えても、これまでの会話と要約はそのまま引き継がれるよ。
            </DialogDescription>
          </DialogHeader>

          <ModelPicker
            value={meta ? { engine: meta.engine, model: meta.model } : null}
            onChange={async (next) => {
              try {
                setMeta(await api.updateTopic(user, ref, next))
                setModelOpen(false)
              } catch (cause) {
                setNotice(cause instanceof Error ? cause.message : 'モデルを変えられませんでした')
              }
            }}
          />
        </DialogContent>
      </Dialog>

      <SummaryDialog
        user={user}
        target={ref}
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
      />

      <TopicClaudeDialog
        user={user}
        target={ref}
        open={claudeOpen}
        onOpenChange={setClaudeOpen}
      />

      <RenameDialog
        user={user}
        target={ref}
        topic={meta}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        onRenamed={moveTo}
      />
    </div>
  )
}
