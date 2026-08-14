import { useEffect } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { api } from '@/lib/api'
import { useSpace } from '@/lib/space'
import { buttonVariants } from '@/components/ui/button'
import { DocPane, type DocSpec } from '@/components/DocsDialog'

/**
 * スペース直下の文書。プロフィールと CLAUDE.md。個人と家族で同じ画面。
 * プロフィールは持ち主が居るスペースだけ。
 */
function SpaceDocPage({ title, spec }: { title: string; spec: DocSpec }) {
  const space = useSpace()

  useEffect(() => {
    space.confirm()
  }, [space])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <header className="bg-background/95 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-2 pt-[calc(0.5rem+var(--safe-top))] backdrop-blur">
        <Link
          to={space.home}
          aria-label="会話一覧に戻る"
          className={buttonVariants({ variant: 'ghost', size: 'icon', className: 'size-9 shrink-0' })}
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold">{title}</h1>
          <p className="text-muted-foreground truncate text-[11px]">{spec.description}</p>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-3 py-3">
        <DocPane
          spec={spec}
          open
          source={`${space.docKey()}:${title}`}
          active
          onBusy={() => {}}
          onSaved={() => {}}
        />
      </main>
    </div>
  )
}

export function ProfilePage() {
  const space = useSpace()
  const owner = space.owner
  if (!owner || !space.profile) return <Navigate to={space.home} replace />

  return (
    <SpaceDocPage
      title="プロフィール"
      spec={{
        label: 'プロフィール',
        description: 'どの会話でも覚えておいてほしいこと。会話のたびに読み込まれるよ。',
        placeholder: 'まだ書いていないよ。',
        load: () => api.getProfile(owner),
        save: (text) => api.saveProfile(owner, text),
      }}
    />
  )
}

export function ClaudePage() {
  const space = useSpace()
  const owner = space.owner

  return (
    <SpaceDocPage
      title={owner ? 'CLAUDE.md' : '家族の CLAUDE.md'}
      spec={{
        label: owner ? 'CLAUDE.md' : '家族の CLAUDE.md',
        description: owner
          ? 'あなたについての設定。どの会話でも効くよ。'
          : '家族みんなの秘書役の土台。どの会話にも効くよ。',
        placeholder: 'まだ書いていないよ。',
        load: () => space.api.getClaude(),
        save: (text) => space.api.saveClaude(text),
      }}
    />
  )
}
