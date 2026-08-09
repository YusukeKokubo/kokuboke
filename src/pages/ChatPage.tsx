import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, NotebookPen } from 'lucide-react'
import type { Message, Topic } from '../../shared/types'
import { api, sendMessage } from '@/lib/api'
import { dayKey, dayLabel } from '@/lib/format'
import { Button, buttonVariants } from '@/components/ui/button'
import { Composer } from '@/components/Composer'
import { MemoryDialog } from '@/components/MemoryDialog'
import { MessageBubble } from '@/components/MessageBubble'
import { ModelPicker } from '@/components/ModelPicker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Status = 'idle' | 'sending'

export default function ChatPage() {
  const { user = '', topic = '' } = useParams()

  const [meta, setMeta] = useState<Topic | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState<Message | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [modelOpen, setModelOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)

  const bottom = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottom.current?.scrollIntoView({ behavior, block: 'end' })
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([api.getTopic(user, topic), api.listMessages(user, topic)])
      .then(([topicMeta, history]) => {
        if (cancelled) return
        setMeta(topicMeta)
        setMessages(history)
        // 初回は履歴の一番下から始めたいので、アニメーションなしで飛ばす。
        requestAnimationFrame(() => scrollToBottom('instant'))
      })
      .catch((cause: Error) => !cancelled && setNotice(cause.message))
    return () => {
      cancelled = true
    }
  }, [user, topic, scrollToBottom])

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

  async function handleSend(input: { text: string; images: File[] }) {
    setStatus('sending')
    setNotice(null)
    stick.current = true

    try {
      for await (const event of sendMessage(user, topic, input)) {
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
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-2 backdrop-blur">
        <Link
          to={`/user/${encodeURIComponent(user)}`}
          aria-label="トピック一覧に戻る"
          className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'size-9 shrink-0' })}
        >
          <ChevronLeft className="size-5" />
        </Link>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold">
            {meta ? `${meta.emoji} ${meta.name}` : '…'}
          </h1>
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
          onClick={() => setMemoryOpen(true)}
          disabled={status !== 'idle'}
          className="shrink-0"
        >
          <NotebookPen className="size-4" />
          記憶
        </Button>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-3 py-4">
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

        <div ref={bottom} />
      </main>

      <Composer disabled={status !== 'idle'} onSend={handleSend} />

      <Dialog open={modelOpen} onOpenChange={setModelOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>このトピックで使うモデル</DialogTitle>
            <DialogDescription>
              変えても、これまでの会話と記憶はそのまま引き継がれるよ。
            </DialogDescription>
          </DialogHeader>

          <ModelPicker
            value={meta ? { engine: meta.engine, model: meta.model } : null}
            onChange={async (next) => {
              try {
                setMeta(await api.updateTopic(user, topic, next))
                setModelOpen(false)
              } catch (cause) {
                setNotice(cause instanceof Error ? cause.message : 'モデルを変えられませんでした')
              }
            }}
          />
        </DialogContent>
      </Dialog>

      <MemoryDialog user={user} topic={topic} open={memoryOpen} onOpenChange={setMemoryOpen} />
    </div>
  )
}
