import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Pencil, RefreshCw, X } from 'lucide-react'
import type { Message, Topic } from '../../shared/types'
import { dayKey, dayLabel, topicLabel } from '@/lib/format'
import { useSpace } from '@/lib/space'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Composer } from '@/components/Composer'
import { EmojiNameDialog } from '@/components/EmojiNameDialog'
import { MessageBubble } from '@/components/MessageBubble'
import { ModelPicker } from '@/components/ModelPicker'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
type Status = 'idle' | 'sending'

export default function ChatPage() {
  const space = useSpace()
  const { id = '' } = useParams()

  const [meta, setMeta] = useState<Topic | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState<Message | null>(null)
  const [activity, setActivity] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [modelOpen, setModelOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [knownTags, setKnownTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [tagBusy, setTagBusy] = useState(false)

  const content = useRef<HTMLElement>(null)
  const stick = useRef(true)
  const busy = useRef(false)

  const scrollToBottom = useCallback(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([space.api.getTopic(id), space.api.listMessages(id), space.api.listTags()])
      .then(([topicMeta, history, tags]) => {
        if (cancelled) return
        space.confirm()
        setMeta(topicMeta)
        setMessages(history)
        setKnownTags(tags.map((tag) => tag.name))
        requestAnimationFrame(scrollToBottom)
      })
      .catch((cause: Error) => !cancelled && setNotice(cause.message))
    return () => {
      cancelled = true
    }
  }, [space, id, scrollToBottom])

  const reload = useCallback(async () => {
    try {
      setMessages(await space.api.listMessages(id))
    } catch {
      // 取り直せなくても、出ているものはそのまま使える。
    }
  }, [space, id])

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

  const putName = useCallback(async () => {
    try {
      setMeta(await space.api.autoName(id))
    } catch (cause) {
      console.warn('[name]', cause)
    }
  }, [space, id])

  const putTags = useCallback(async () => {
    setTagBusy(true)
    try {
      const next = await space.api.autoTag(id)
      setMeta(next)
      setKnownTags((prev) => [...new Set([...prev, ...next.tags])])
    } catch (cause) {
      console.warn('[tags]', cause)
    } finally {
      setTagBusy(false)
    }
  }, [space, id])

  async function saveTags(tags: string[]) {
    setTagBusy(true)
    try {
      const next = await space.api.writeTags(id, tags)
      setMeta(next)
      setKnownTags((prev) => [...new Set([...prev, ...next.tags])])
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'タグを変えられませんでした')
    } finally {
      setTagBusy(false)
    }
  }

  async function addTag(name: string) {
    const tag = name.trim()
    if (!tag || !meta || meta.tags.includes(tag)) {
      setTagDraft('')
      return
    }
    setTagDraft('')
    await saveTags([...meta.tags, tag])
  }

  async function handleSend(input: { text: string; images: File[] }) {
    setStatus('sending')
    busy.current = true
    setNotice(null)
    setActivity(null)
    stick.current = true

    let accepted = false

    try {
      for await (const event of space.api.sendMessage(id, input)) {
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
            if (event.shouldTag) void putTags()
            break
          case 'error':
            setDraft(null)
            throw new Error(event.message)
        }
      }
    } catch (cause) {
      setDraft(null)
      setNotice(cause instanceof Error ? space.busyNotice(cause.message) : '送信できませんでした')
      if (!accepted) throw cause
    } finally {
      setStatus('idle')
      busy.current = false
      setActivity(null)
      if (accepted) void reload()
    }
  }

  const unused = knownTags.filter((tag) => !meta?.tags.includes(tag))

  return (
    <>
      <header className="flex flex-col gap-1.5 border-b px-3 py-2">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => meta && setRenameOpen(true)}
            className="flex max-w-full items-center gap-1"
          >
            <h2
              className={cn(
                'truncate text-[15px] font-semibold',
                meta && !meta.name && 'text-muted-foreground',
              )}
            >
              {meta ? `${meta.emoji} ${topicLabel(meta)}` : '…'}
            </h2>
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

        {meta && (
          <div className="flex flex-wrap items-center gap-1 px-1">
            {meta.tags.map((tag) => (
              <span
                key={tag}
                className="bg-secondary text-muted-foreground inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px]"
              >
                <Link to={space.tagHref(tag)} className="hover:underline">
                  {tag}
                </Link>
                <button
                  type="button"
                  disabled={tagBusy || status !== 'idle'}
                  onClick={() => void saveTags(meta.tags.filter((item) => item !== tag))}
                  aria-label={`${tag} を外す`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <form
              className="flex min-w-24 flex-1 items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault()
                void addTag(tagDraft)
              }}
            >
              <Input
                value={tagDraft}
                onChange={(event) => setTagDraft(event.target.value)}
                list="known-tags"
                placeholder="タグを付ける"
                disabled={tagBusy || status !== 'idle'}
                className="h-7 min-w-0 flex-1 text-[12px]"
              />
              <datalist id="known-tags">
                {unused.map((tag) => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
            </form>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={tagBusy || status !== 'idle'}
              onClick={() => void putTags()}
              title="会話を読んでタグを付け直す"
              className="text-muted-foreground h-7 shrink-0 px-2 text-[11px]"
            >
              <RefreshCw className={cn('size-3', tagBusy && 'animate-spin')} />
              付け直す
            </Button>
          </div>
        )}
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
              <MessageBubble message={message} selfAuthor={space.author} />
            </div>
          )
        })}

        {draft && (
          <MessageBubble message={draft} streaming activity={activity} selfAuthor={space.author} />
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
            <DialogTitle>この会話で使うモデル</DialogTitle>
            <DialogDescription>変えても、これまでの会話はそのまま引き継がれるよ。</DialogDescription>
          </DialogHeader>

          <ModelPicker
            value={meta ? { engine: meta.engine, model: meta.model } : null}
            onChange={async (next) => {
              try {
                setMeta(await space.api.updateTopic(id, next))
                setModelOpen(false)
              } catch (cause) {
                setNotice(cause instanceof Error ? cause.message : 'モデルを変えられませんでした')
              }
            }}
          />
        </DialogContent>
      </Dialog>

      <EmojiNameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="名前を変える"
        description="会話はそのまま。フォルダの名前は変わらないよ。"
        submitLabel="変える"
        placeholder="例: 肌の記録"
        initial={meta ? { name: meta.name, emoji: meta.emoji } : undefined}
        onSubmit={async ({ name, emoji }) => {
          setMeta(await space.api.renameTopic(id, { name, emoji }))
        }}
      />
    </>
  )
}
