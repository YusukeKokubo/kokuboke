import { useCallback, useState } from 'react'
import { api } from '@/lib/api'
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
  user: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Tab = 'profile' | 'claude'

/**
 * ユーザー直下の profile.md と CLAUDE.md。切替中も下書きは残し、保存は開いている方だけ。
 */
export function UserDocsDialog({ user, open, onOpenChange }: Props) {
  const [tab, setTab] = useState<Tab>('profile')

  const loadProfile = useCallback(
    () => api.getProfile(user).then((doc) => doc.profile),
    [user],
  )
  const loadClaude = useCallback(() => api.getClaude(user).then((doc) => doc.claude), [user])

  const profile = useDoc(open, `profile:${user}`, loadProfile)
  const claude = useDoc(open, `claude:${user}`, loadClaude)
  const current = tab === 'profile' ? profile : claude
  const busy = profile.busy || claude.busy

  async function handleSave() {
    if (tab === 'profile') {
      await profile.save((text) => api.saveProfile(user, text).then((doc) => doc.profile))
    } else {
      await claude.save((text) => api.saveClaude(user, text).then((doc) => doc.claude))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tab === 'profile' ? 'プロフィール' : '話し方'}</DialogTitle>
          <DialogDescription>
            {tab === 'profile'
              ? 'どの話題でも覚えておいてほしいこと。会話のたびに読み込まれるよ。'
              : 'あなたについての設定。どの話題でも効くよ。'}
          </DialogDescription>
        </DialogHeader>

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
            話し方
          </Button>
        </div>

        <DocEditor doc={current} placeholder="まだ書いていないよ。" onSave={handleSave} />
      </DialogContent>
    </Dialog>
  )
}
