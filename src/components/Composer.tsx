import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, SendHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface Props {
  disabled: boolean
  onSend: (input: { text: string; images: File[] }) => void
}

const MAX_IMAGES = 4

// 拡張子でしか判別できないことがある。HEIC は type が空で届く環境がある。
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif|heic|heif)$/i

function isImage(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.test(file.name)
}

export function Composer({ disabled, onSend }: Props) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  // 子要素をまたぐたびに enter/leave が飛ぶので、数えて釣り合ったところで解除する。
  const dragDepth = useRef(0)

  useEffect(() => {
    const urls = images.map((file) => URL.createObjectURL(file))
    setPreviews(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [images])

  // 入力量に合わせて高さを変える。一定を超えたら中でスクロールさせる。
  useEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  const canSend = !disabled && (text.trim().length > 0 || images.length > 0)

  function submit() {
    if (!canSend) return
    onSend({ text, images })
    setText('')
    setImages([])
  }

  function add(files: File[]) {
    const picked = files.filter(isImage)
    if (picked.length === 0) return
    setImages((prev) => [...prev, ...picked].slice(0, MAX_IMAGES))
  }

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    add(Array.from(event.target.files ?? []))
    // 同じ写真をもう一度選べるように値を空に戻す。
    event.target.value = ''
  }

  const accepting = !disabled && images.length < MAX_IMAGES

  // 貼り付けは入力欄に focus が無くても効かせたいので document で拾う。
  useEffect(() => {
    if (!accepting) return

    function onPaste(event: ClipboardEvent) {
      const clipboard = event.clipboardData
      const files = Array.from(clipboard?.files ?? []).filter(isImage)
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
      className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky bottom-0 border-t backdrop-blur"
    >
      {dragging && (
        <div className="bg-background border-muted-foreground/50 text-muted-foreground pointer-events-none absolute inset-0 z-10 m-1 flex items-center justify-center rounded-lg border-2 border-dashed text-sm">
          {accepting ? '写真をここに落とす' : `写真は ${MAX_IMAGES} 枚まで`}
        </div>
      )}

      {previews.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pt-3">
          {previews.map((url, index) => (
            <div key={url} className="relative shrink-0">
              <img src={url} alt="" className="h-20 w-20 rounded-lg border object-cover" />
              <button
                type="button"
                aria-label="この画像を外す"
                onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                className="bg-background/90 absolute -top-1.5 -right-1.5 rounded-full border p-0.5"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={pick}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-10 shrink-0"
          aria-label="写真を選ぶ"
          disabled={!accepting}
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus className="size-5" />
        </Button>

        <Textarea
          ref={textarea}
          rows={1}
          value={text}
          placeholder="メッセージを入力"
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
