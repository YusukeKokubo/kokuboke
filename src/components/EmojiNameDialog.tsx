import { useEffect, useState } from 'react'
import { DEFAULT_TAG_EMOJI, EMOJI } from '@/lib/emoji'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  submitLabel: string
  placeholder: string
  /** 改名のとき。無ければ空の名前と既定の絵文字から始める。 */
  initial?: { name: string; emoji: string; group?: string }
  /** 既にある棚。datalist の候補。空なら棚なし。 */
  groups?: string[]
  onSubmit: (input: { name: string; emoji: string; group: string }) => Promise<void>
}

export function EmojiNameDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  placeholder,
  initial,
  groups = [],
  onSubmit,
}: Props) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(DEFAULT_TAG_EMOJI)
  const [group, setGroup] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setEmoji(initial?.emoji ?? DEFAULT_TAG_EMOJI)
    setGroup(initial?.group ?? '')
    setError(null)
  }, [open, initial?.name, initial?.emoji, initial?.group])

  async function submit() {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), emoji, group: group.trim() })
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1">
            {EMOJI.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setEmoji(item)}
                className={cn(
                  'size-9 rounded-lg border text-lg',
                  emoji === item ? 'border-primary bg-accent' : 'border-transparent',
                )}
              >
                {item}
              </button>
            ))}
          </div>

          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={placeholder}
            maxLength={40}
            autoFocus
          />

          <Input
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            list="tag-groups"
            placeholder="棚（任意）"
            maxLength={40}
          />
          <datalist id="tag-groups">
            {groups.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>

          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim() || busy} className="w-full">
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
