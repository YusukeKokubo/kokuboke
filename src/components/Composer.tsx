import { useEffect, useRef, useState } from 'react'
import { FileText, Loader2, Paperclip, SendHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export type ComposerInput = { text: string; images: File[]; files: File[] }

interface Props {
  disabled: boolean
  onSend: (input: ComposerInput) => void | Promise<void>
  /** true なら送信が失敗したとき本文と添付を戻す。既定は false（投げたら忘れる）。 */
  keepOnFailure?: boolean
  /** dock は会話の下に貼る。inline はトップの開始欄。 */
  placement?: 'dock' | 'inline'
  placeholder?: string
}

const MAX_ATTACHMENTS = 4

// 拡張子でしか判別できないことがある。HEIC は type が空で届く環境がある。
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif|heic|heif)$/i
const FILE_EXTENSIONS = /\.(pdf|txt|md|csv|json)$/i

function isImage(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.test(file.name)
}

function isDocument(file: File): boolean {
  if (FILE_EXTENSIONS.test(file.name)) return true
  if (file.type === 'application/pdf' || file.type === 'application/json') return true
  return file.type.startsWith('text/') && !file.name.includes('.')
}

function isAttachable(file: File): boolean {
  return isImage(file) || isDocument(file)
}

function split(files: File[]): { images: File[]; files: File[] } {
  const images: File[] = []
  const docs: File[] = []
  for (const file of files) {
    if (isImage(file)) images.push(file)
    else docs.push(file)
  }
  return { images, files: docs }
}

export function Composer({
  disabled,
  onSend,
  keepOnFailure = false,
  placement = 'dock',
  placeholder = 'メッセージを入力',
}: Props) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  // 子要素をまたぐたびに enter/leave が飛ぶので、数えて釣り合ったところで解除する。
  const dragDepth = useRef(0)

  useEffect(() => {
    const urls = attachments.map((file) => (isImage(file) ? URL.createObjectURL(file) : ''))
    setPreviews(urls)
    return () => urls.forEach((url) => url && URL.revokeObjectURL(url))
  }, [attachments])

  // 入力量に合わせて高さを変える。一定を超えたら中でスクロールさせる。
  useEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  const canSend = !disabled && (text.trim().length > 0 || attachments.length > 0)

  async function submit() {
    if (!canSend) return
    const payload = { text, ...split(attachments) }
    // 送った分はすぐ吹き出しになって出るので、入力欄は待たずに空にする。
    // 待つと生成が終わるまで同じ文が二重に見える。
    setText('')
    setAttachments([])
    if (!keepOnFailure) {
      onSend(payload)
      return
    }
    try {
      await onSend(payload)
    } catch {
      // 送れなかったときだけ打った内容を戻す。送っている間は入力できないので、
      // 書きかけを上から潰すことはない。
      setText(payload.text)
      setAttachments([...payload.images, ...payload.files])
    }
  }

  function add(files: File[]) {
    const picked = files.filter(isAttachable)
    if (picked.length === 0) return
    setAttachments((prev) => [...prev, ...picked].slice(0, MAX_ATTACHMENTS))
  }

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    add(Array.from(event.target.files ?? []))
    // 同じ写真をもう一度選べるように値を空に戻す。
    event.target.value = ''
  }

  const accepting = !disabled && attachments.length < MAX_ATTACHMENTS

  // 貼り付けは入力欄に focus が無くても効かせたいので document で拾う。
  useEffect(() => {
    if (!accepting) return

    function onPaste(event: ClipboardEvent) {
      const clipboard = event.clipboardData
      const files = Array.from(clipboard?.files ?? []).filter(isAttachable)
      if (files.length === 0) return
      // 文字も一緒に入っているときは、そちらは普通に貼らせる。
      if (!clipboard?.types.includes('text/plain')) event.preventDefault()
      add(files)
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [accepting])

  function dragEnter(event: React.DragEvent) {
    // ファイル以外（文字の選択など）を引きずってきたときは反応しない。
    if (!event.dataTransfer.types.includes('Files')) return
    dragDepth.current += 1
    setDragging(true)
  }

  function dragLeave() {
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragging(false)
    }
  }

  function drop(event: React.DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) return
    // ブラウザが画像を開いてしまうのを止める。
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (!accepting) return
    add(Array.from(event.dataTransfer.files))
  }

  return (
    <div
      onDragEnter={dragEnter}
      onDragLeave={dragLeave}
      onDragOver={(event) => {
        // preventDefault を呼ばないと drop が飛んでこない。
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = accepting ? 'copy' : 'none'
      }}
      onDrop={drop}
      className={
        placement === 'inline'
          ? 'bg-background relative rounded-2xl border shadow-sm'
          : 'bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky bottom-0 border-t backdrop-blur'
      }
    >
      {dragging && (
        <div className="bg-background border-muted-foreground/50 text-muted-foreground pointer-events-none absolute inset-0 z-10 m-1 flex items-center justify-center rounded-lg border-2 border-dashed text-sm">
          {accepting ? 'ファイルをここに落とす' : `添付は ${MAX_ATTACHMENTS} つまで`}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pt-3">
          {attachments.map((file, index) => (
            <div key={`${file.name}-${file.size}-${index}`} className="relative shrink-0">
              {previews[index] ? (
                <img src={previews[index]} alt="" className="h-20 w-20 rounded-lg border object-cover" />
              ) : (
                <div className="flex h-20 w-36 items-center gap-2 rounded-lg border px-2.5">
                  <FileText className="text-muted-foreground size-5 shrink-0" />
                  <span className="truncate text-xs">{file.name}</span>
                </div>
              )}
              <button
                type="button"
                aria-label={isImage(file) ? 'この画像を外す' : 'このファイルを外す'}
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                className="bg-background/90 absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className={
          placement === 'inline'
            ? 'flex items-end gap-2 px-3 py-3'
            : 'flex items-end gap-2 px-3 py-3 pb-[calc(0.75rem+var(--safe-bottom))]'
        }
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/*,.pdf,.txt,.md,.csv,.json,application/pdf,text/plain,text/markdown,text/csv,application/json"
          multiple
          className="hidden"
          onChange={pick}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-10 shrink-0"
          aria-label="ファイルを選ぶ"
          disabled={!accepting}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip className="size-5" />
        </Button>

        <Textarea
          ref={textarea}
          rows={1}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // スマホでの改行を潰したくないので、送信は Ctrl / ⌘ + Enter だけ。
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
          className="max-h-40 min-h-10 resize-none py-2.5 text-[15px]"
        />

        <Button
          type="button"
          size="icon"
          className="size-10 shrink-0"
          aria-label="送信"
          disabled={!canSend}
          onClick={submit}
        >
          {disabled ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <SendHorizontal className="size-5" />
          )}
        </Button>
      </div>
    </div>
  )
}
