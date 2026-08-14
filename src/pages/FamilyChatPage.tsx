import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, NotebookPen, Pencil, ScrollText } from 'lucide-react'
import type { Message, Topic } from '../../shared/types'
import { familyApi, sendFamilyMessage, TopicBusyError } from '@/lib/api'
import { dayKey, dayLabel, topicLabel } from '@/lib/format'
import { rememberedUser } from '@/lib/remember'
import { familyTopicHref } from '@/lib/route'
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

export default function FamilyChatPage() {
  const { topic = '', sub = '' } = useParams()
  const navigate = useNavigate()
  const ref = useMemo(() => ({ kind: 'child' as const, topic, sub }), [topic, sub])
  const [selfAuthor] = useState(() => rememberedUser() ?? '')

  const [meta, setMeta] = useState<Topic | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState<Message | null>(null)
  const [activity, setActivity] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [modelOpen, setModelOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [claudeOpen, setClaudeOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)

  const content = useRef<HTMLElement>(null)
  const stick = useRef(true)
  // 取り直しを送信中に割り込ませないための札。描画には関わらないので ref で持つ。
  const busy = useRef(false)

  const scrollToBottom = useCallback(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([familyApi.getTopic(ref), familyApi.listMessages(ref)])
      .then(([topicMeta, history]) => {
        if (cancelled) return
        setMeta(topicMeta)
        setMessages(history)
        requestAnimationFrame(scrollToBottom)
      })
      .catch((cause: Error) => !cancelled && setNotice(cause.message))
    return () => {
      cancelled = true
    }
  }, [ref, scrollToBottom])

  /**
   * みんなが書き込む場所なので、開いたときの写しのままだと、他の人の発言が
   * いつまでも出てこない。戻ってきたときと送り終わったときに取り直す。
   */
  const reload = useCallback(async () => {
    try {
      const history = await familyApi.listMessages(ref)
      setMessages(history)
    } catch {
      // 取り直せなくても、出ているものはそのまま使える。
    }
  }, [ref])

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || busy.current) return
      void reload()
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [reload])

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

  useEffect(() => {
    const el = content.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (stick.current) scrollToBottom()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollToBottom])

  const moveTo = useCallback(
    (next: Topic) => {
      setMeta(next)
      if (next.slug !== sub) {
        navigate(familyTopicHref({ kind: 'child', topic, sub: next.slug }), { replace: true })
      }
    },
    [navigate, sub, topic],
  )

  const putName = useCallback(async () => {
    try {
      moveTo(await familyApi.autoName(ref))
    } catch (cause) {
      console.warn('[name]', cause)
    }
  }, [moveTo, ref])

  async function handleSend(input: { text: string; images: File[] }) {
    if (!selfAuthor) {
      setNotice('名前が決まっていないよ。いったん入口から名前を入れてね')
      throw new Error('author missing')
    }

    setStatus('sending')
    busy.current = true
    setNotice(null)
    setActivity(null)
    stick.current = true

    // 受け取られた時点で発言はもう記録されている。あとで失敗しても打ち直させない
    // （もう一度送ると同じ発言が二つ並ぶ）。
    let accepted = false

    try {
      for await (const event of sendFamilyMessage(selfAuthor, ref, input)) {
        switch (event.type) {
          case 'accepted':
            accepted = true
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
          case 'activity':
            setActivity(event.label)
            break
          case 'done':
            setDraft(null)
            setMessages((prev) => [...prev, event.message])
            if (event.shouldName) void putName()
            break
          case 'error':
            setDraft(null)
            setNotice(event.message)
            throw new Error(event.message)
        }
      }
    } catch (cause) {
      setDraft(null)
      if (cause instanceof TopicBusyError) {
        setNotice(cause.message)
      } else if (cause instanceof Error && cause.message !== 'author missing') {
        setNotice(cause.message)
      }
      if (!accepted) throw cause
    } finally {
      setStatus('idle')
      busy.current = false
      setActivity(null)
      // 自分の分は継ぎ足してあるが、その間に誰かが書いた分は入っていない。
      if (accepted) void reload()
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex flex-col gap-2 border-b px-2 py-2 pt-[calc(0.5rem+var(--safe-top))] backdrop-blur">
        <div className="flex items-center gap-2">
          <Link
            to="/family"
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
        </div>
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
              <MessageBubble message={message} selfAuthor={selfAuthor} />
            </div>
          )
        })}

        {draft && (
          <MessageBubble message={draft} streaming activity={activity} selfAuthor={selfAuthor} />
        )}

        {notice && (
          <p className="text-muted-foreground bg-secondary mx-auto rounded-full px-3 py-1.5 text-center text-xs">
            {notice}
          </p>
        )}
      </main>

      <Composer disabled={status !== 'idle'} onSend={handleSend} keepOnFailure />

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
                setMeta(await familyApi.updateTopic(ref, next))
                setModelOpen(false)
              } catch (cause) {
                setNotice(cause instanceof Error ? cause.message : 'モデルを変えられませんでした')
              }
            }}
          />
        </DialogContent>
      </Dialog>

      <SummaryDialog
        user="family"
        family
        target={ref}
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
      />

      <TopicClaudeDialog
        user="family"
        family
        target={ref}
        open={claudeOpen}
        onOpenChange={setClaudeOpen}
      />

      <RenameDialog
        user="family"
        family
        target={ref}
        topic={meta}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        onRenamed={moveTo}
      />
    </div>
  )
}
