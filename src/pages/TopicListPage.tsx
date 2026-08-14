import { useSpace } from '@/lib/space'
import { FamilyEntry } from '@/components/FamilyEntry'
import { useTopics } from '@/components/TopicSidebar'

export default function TopicListPage() {
  const space = useSpace()
  const { topics, error } = useTopics()

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-3 py-8">
      {space.kind === 'personal' && <FamilyEntry />}

      {error && <p className="text-destructive px-1 py-8 text-center text-sm">{error}</p>}

      {topics?.length === 0 && (
        <div className="text-muted-foreground px-6 py-8 text-center text-sm leading-relaxed">
          まだ会話がないよ。
          <br />
          {space.emptyHint}
        </div>
      )}

      {topics && topics.length > 0 && (
        <p className="text-muted-foreground px-6 py-8 text-center text-sm leading-relaxed">
          会話を選ぶか、追加して始めてね。
        </p>
      )}
    </main>
  )
}
