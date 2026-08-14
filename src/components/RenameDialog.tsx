import { useEffect, useState } from 'react'
import type { Topic, TopicRef } from '../../shared/types'
import { api, familyApi } from '@/lib/api'
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
  user: string
  target: TopicRef
  topic: Topic | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 名前を変えるとフォルダも動くので、呼び出し側で経路を差し替える。 */
  onRenamed: (topic: Topic) => void
  family?: boolean
}

export function RenameDialog({ user, target, topic, open, onOpenChange, onRenamed, family }: Props) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('💬')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !topic) return
    setName(topic.name)
    setEmoji(topic.emoji)
    setError(null)
  }, [open, topic])

  async function submit() {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      onRenamed(
        family
          ? await familyApi.renameTopic(target, { name: name.trim(), emoji })
          : await api.renameTopic(user, target, { name: name.trim(), emoji }),
      )
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '名前を変えられませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>名前を変える</DialogTitle>
          <DialogDescription>
            会話と要約はそのまま。フォルダの名前も一緒に変わるよ。
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
            placeholder="例: 肌の記録"
            maxLength={40}
            autoFocus
          />

          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim() || busy} className="w-full">
            変える
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
