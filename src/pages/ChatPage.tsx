import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, NotebookPen, Pencil } from 'lucide-react'
import type { Message, Topic } from '../../shared/types'
import { dayKey, dayLabel, topicLabel } from '@/lib/format'
import { useSpace } from '@/lib/space'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Composer } from '@/components/Composer'
import { TopicDocsDialog } from '@/components/DocsDialog'
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
  const space = useSpace()
  const { topic = '', sub = '' } = useParams()
  const navigate = useNavigate()
  const ref = useMemo(() => ({ kind: 'child' as const, topic, sub }), [topic, sub])

  const [meta, setMeta] = useState<Topic | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState<Message | null>(null)
  /** 返答を作っているあいだの「いま何をしているか」。届いた最後の一つだけ出す。 */
  const [activity, setActivity] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [modelOpen, setModelOpen] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)

  const content = useRef<HTMLElement>(null)
  const stick = useRef(true)
  // 取り直しを送信中に割り込ませないための札。描画には関わらないので ref で持つ。
  const busy = useRef(false)

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
    Promise.all([space.api.getTopic(ref), space.api.listMessages(ref)])
      .then(([topicMeta, history]) => {
        if (cancelled) return
        space.confirm()
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
  }, [space, ref, scrollToBottom])

  /**
   * 共有スペースは他の人も書き込む。開いたときの写しのままだと相手の発言が
   * いつまでも出てこないので、戻ってきたときと送り終わったときに取り直す。
   * 個人のスペースでも別の端末から書いた分がここで揃う。
   */
  const reload = useCallback(async () => {
    try {
      setMessages(await space.api.listMessages(ref))
    } catch {
      // 取り直せなくても、出ているものはそのまま使える。
    }
  }, [space, ref])

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
        navigate(space.href({ kind: 'child', topic, sub: next.slug }), { replace: true })
      }
    },
    [navigate, space, sub, topic],
  )

  /**
   * 会話を読んで名前を付けてもらう。時間はかかるが返事を待たせるものではないので、
   * 失敗しても画面には出さず、名前なしのままにしておく。
   */
  const putName = useCallback(async () => {
    try {
      moveTo(await space.api.autoName(ref))
    } catch (cause) {
      console.warn('[name]', cause)
    }
  }, [moveTo, space, ref])

  async function handleSend(input: { text: string; images: File[] }) {
    setStatus('sending')
    busy.current = true
    setNotice(null)
    setActivity(null)
    stick.current = true

    // 受け取られた時点で発言はもう記録されている。あとで失敗しても打ち直させない
    // （もう一度送ると同じ発言が二つ並ぶ）。
    let accepted = false

    try {
      for await (const event of space.api.sendMessage(ref, input)) {
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
            throw new Error(event.message)
        }
      }
    } catch (cause) {
      setDraft(null)
      setNotice(cause instanceof Error ? space.busyNotice(cause.message) : '送信できませんでした')
      // 受け取られる前に落ちたのなら、打った文は入力欄に戻す。
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
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-2 pt-[calc(0.5rem+var(--safe-top))] backdrop-blur">
        <Link
          to={space.home}
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
          onClick={() => setDocsOpen(true)}
          disabled={status !== 'idle'}
          className="shrink-0"
        >
          <NotebookPen className="size-4" />
          文書
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
            <DialogTitle>このトピックで使うモデル</DialogTitle>
            <DialogDescription>
              変えても、これまでの会話と要約はそのまま引き継がれるよ。
            </DialogDescription>
          </DialogHeader>

          <ModelPicker
            value={meta ? { engine: meta.engine, model: meta.model } : null}
            onChange={async (next) => {
              try {
                setMeta(await space.api.updateTopic(ref, next))
                setModelOpen(false)
              } catch (cause) {
                setNotice(cause instanceof Error ? cause.message : 'モデルを変えられませんでした')
              }
            }}
          />
        </DialogContent>
      </Dialog>

      <TopicDocsDialog target={ref} open={docsOpen} onOpenChange={setDocsOpen} />

      <RenameDialog
        target={ref}
        topic={meta}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        onRenamed={moveTo}
      />
    </div>
  )
}
