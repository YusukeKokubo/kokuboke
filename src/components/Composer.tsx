import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, SendHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface Props {
  disabled: boolean
  onSend: (input: { text: string; images: File[] }) => void
}

const MAX_IMAGES = 4

export function Composer({ disabled, onSend }: Props) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

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

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? [])
    setImages((prev) => [...prev, ...picked].slice(0, MAX_IMAGES))
    // 同じ写真をもう一度選べるように値を空に戻す。
    event.target.value = ''
  }

  return (
    <div className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky bottom-0 border-t backdrop-blur">
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
          disabled={disabled || images.length >= MAX_IMAGES}
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
