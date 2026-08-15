import { useEffect } from 'react'
import { useSpace } from '@/lib/space'
import { useDocumentTitle } from '@/lib/title'
import { DocPane, type DocSpec } from '@/components/DocsDialog'
import { SpaceHeaderSlot } from '@/components/SpaceHeader'

/**
 * スペース直下の文書。プロフィールと CLAUDE.md。個人と家族で同じ画面。
 */
function SpaceDocPage({ title, spec }: { title: string; spec: DocSpec }) {
  const space = useSpace()
  useDocumentTitle(title)

  useEffect(() => {
    space.confirm()
  }, [space])

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-3 py-3">
      <SpaceHeaderSlot>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{title}</h1>
          <p className="text-muted-foreground text-xs">{spec.description}</p>
        </div>
      </SpaceHeaderSlot>
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

  return (
    <SpaceDocPage
      title={space.profileTitle}
      spec={{
        label: space.profileTitle,
        description: owner
          ? 'どの会話でも覚えておいてほしいこと。会話のたびに読み込まれるよ。'
          : '家族みんなについて、どの会話でも覚えておいてほしいこと。会話のたびに読み込まれるよ。',
        placeholder: 'まだ書いていないよ。',
        load: () => space.api.getProfile(),
        save: (text) => space.api.saveProfile(text),
      }}
    />
  )
}

export function ClaudePage() {
  const space = useSpace()
  const owner = space.owner

  return (
    <SpaceDocPage
      title={space.claudeTitle}
      spec={{
        label: space.claudeTitle,
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
