import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useSpace } from '@/lib/space'
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
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-3 py-3">
      <p className="text-muted-foreground text-xs">{spec.description}</p>
      <DocPane
        spec={spec}
        open
        source={`${space.docKey()}:${title}`}
        active
        onBusy={() => {}}
        onSaved={() => {}}
      />
    </main>
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
