import { useState } from 'react'
import type { DiaryForm } from '../../shared/types'
import { diaryAnswerText } from '../../shared/diary-form'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  form: DiaryForm
  /** 送れなかったら投げる。そのときは選んだものを残す。 */
  onSend: (text: string) => Promise<void>
}

const OTHER = 'ほか…'

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'min-h-10 rounded-full border px-3.5 text-sm transition-colors',
        pressed ? 'bg-primary text-primary-foreground border-primary' : 'bg-background',
      )}
    >
      {children}
    </button>
  )
}

/**
 * 「いまなにしとる」の答えの穴埋め。欄ごとに候補を一つ押すか、「ほか…」で自分で書く。
 * 空けた欄は送らない。送るのは普通の発言と同じ一通の文字なので、日記の側は何も変えずに読める。
 */
export function DiaryAnswerForm({ form, onSend }: Props) {
  const count = form.fields.length
  const [picked, setPicked] = useState<string[]>(() => Array(count).fill(''))
  const [typing, setTyping] = useState<boolean[]>(() => Array(count).fill(false))
  const [typed, setTyped] = useState<string[]>(() => Array(count).fill(''))
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  const values = form.fields.map((_, i) => (typing[i] ? typed[i]! : picked[i]!))
  const text = diaryAnswerText(form, values, note)

  function set<T>(list: T[], i: number, value: T): T[] {
    return list.map((item, j) => (j === i ? value : item))
  }

  function pick(i: number, choice: string) {
    setTyping((prev) => set(prev, i, false))
    // 同じものをもう一度押したら外す。
    setPicked((prev) => set(prev, i, prev[i] === choice && !typing[i] ? '' : choice))
  }

  async function submit() {
    if (!text || sending) return
    setSending(true)
    try {
      await onSend(text)
    } catch {
      // 知らせは会話の方に出る。選んだものはそのまま残して、もう一度押せるようにする。
    } finally {
      setSending(false)
    }
  }

  return (
    <section
      aria-label="いまの様子の穴埋め"
      className="bg-muted/50 flex flex-col gap-3.5 rounded-2xl border p-3.5"
    >
      <p className="text-muted-foreground text-xs">押すだけで答えられるよ。空いた欄があってもいいよ。</p>

      {form.fields.map((field, i) => (
        <div key={field.label} className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold">{field.label}</span>
          <div className="flex flex-wrap gap-1.5">
            {field.choices.map((choice) => (
              <Chip key={choice} pressed={!typing[i] && picked[i] === choice} onClick={() => pick(i, choice)}>
                {choice}
              </Chip>
            ))}
            <Chip pressed={typing[i]!} onClick={() => setTyping((prev) => set(prev, i, !prev[i]))}>
              {OTHER}
            </Chip>
          </div>
          {typing[i] && (
            <Input
              autoFocus
              aria-label={`${field.label}（自分で書く）`}
              placeholder="自分で書く"
              value={typed[i]}
              onChange={(event) => setTyped((prev) => set(prev, i, event.target.value))}
              className="bg-background h-10 text-[15px]"
            />
          )}
        </div>
      ))}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold">ひとこと（なくてもいいよ）</span>
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="bg-background h-10 text-[15px]"
        />
      </label>

      <Button type="button" className="h-11 text-[15px]" disabled={!text || sending} onClick={submit}>
        これで送る
      </Button>
    </section>
  )
}
