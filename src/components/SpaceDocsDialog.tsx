import { useCallback, useState } from 'react'
import { api } from '@/lib/api'
import { useSpace } from '@/lib/space'
import { Button } from '@/components/ui/button'
import { DocEditor, useDoc } from '@/components/DocDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Tab = 'profile' | 'claude'

/**
 * スペース直下の CLAUDE.md と、個人のスペースだけにある profile.md。
 * 切替中も下書きは残し、保存は開いている方だけ。
 */
export function SpaceDocsDialog({ open, onOpenChange }: Props) {
  const space = useSpace()
  const owner = space.owner
  const [tab, setTab] = useState<Tab>(owner ? 'profile' : 'claude')

  const loadProfile = useCallback(() => (owner ? api.getProfile(owner) : Promise.resolve('')), [owner])
  const loadClaude = useCallback(() => space.api.getClaude(), [space])

  const profile = useDoc(open && !!owner, `profile:${owner ?? ''}`, loadProfile)
  const claude = useDoc(open, `claude:${space.docKey()}`, loadClaude)
  const current = tab === 'profile' ? profile : claude
  const busy = profile.busy || claude.busy

  async function handleSave() {
    if (tab === 'profile') {
      if (owner) await profile.save((text) => api.saveProfile(owner, text))
    } else {
      await claude.save((text) => space.api.saveClaude(text))
    }
  }

  const title = tab === 'profile' ? 'プロフィール' : owner ? 'CLAUDE.md' : '家族の CLAUDE.md'
  const description =
    tab === 'profile'
      ? 'どの話題でも覚えておいてほしいこと。会話のたびに読み込まれるよ。'
      : owner
        ? 'あなたについての設定。どの話題でも効くよ。'
        : '家族みんなの秘書役の土台。どのトピックの会話にも効くよ。'

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* 共有スペースには profile.md が無いので、切替そのものを出さない。 */}
        {owner && (
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={tab === 'profile' ? 'secondary' : 'ghost'}
              onClick={() => setTab('profile')}
              disabled={busy}
            >
              プロフィール
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tab === 'claude' ? 'secondary' : 'ghost'}
              onClick={() => setTab('claude')}
              disabled={busy}
            >
              CLAUDE.md
            </Button>
          </div>
        )}

        <DocEditor doc={current} placeholder="まだ書いていないよ。" onSave={handleSave} />
      </DialogContent>
    </Dialog>
  )
}
