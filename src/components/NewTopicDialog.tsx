import { useEffect, useState } from 'react'
import { EMOJI } from '@/lib/emoji'
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
  onCreate: (input: { name: string; emoji: string; engine: string; model: string }) => Promise<void>
}

export function NewTopicDialog({ open, onOpenChange, onCreate }: Props) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('💬')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setError(null)
  }, [open])

  async function submit() {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onCreate({ name: name.trim(), emoji, engine: '', model: '' })
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '作成できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新しいトピック</DialogTitle>
          <DialogDescription>
            ここは要約の置き場だよ。話しかけるのは、この中に作ったトピック。
          </DialogDescription>
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
            placeholder="例: 数学学習"
            maxLength={40}
            autoFocus
          />

          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim() || busy} className="w-full">
            作る
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
