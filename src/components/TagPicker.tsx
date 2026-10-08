import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { Check, Plus, RefreshCw, Search, X } from 'lucide-react'
import type { Tag } from '../../shared/types'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'

interface Props {
  /** 会話に付いているタグ。 */
  value: string[]
  known: Tag[]
  tagHref: (name: string) => string
  /** AI が付け直している最中。 */
  retagging?: boolean
  disabled: boolean
  onChange: (tags: string[]) => void
  /** 無ければ「AIに付け直してもらう」を出さない（まだ会話が無いとき）。 */
  onRetag?: () => void
}

/**
 * 付いているタグのチップと「＋」。押すとタグが棚ごとに並んだ板が開き、
 * タップした時点で付け外しが決まる（確定の操作は無い）。
 * スマホは下からのシート、それより広ければポップオーバー。
 */
export function TagPicker({
  value,
  known,
  tagHref,
  retagging = false,
  disabled,
  onChange,
  onRetag,
}: Props) {
  const mobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // スマホで開いた途端に検索欄へ入るとキーボードが板を隠す。見出しに置いておく
  const sheetFocus = useRef<HTMLDivElement>(null)
  const byName = useMemo(() => new Map(known.map((tag) => [tag.name, tag])), [known])

  function toggle(name: string) {
    onChange(value.includes(name) ? value.filter((item) => item !== name) : [...value, name])
  }

  function changeOpen(next: boolean) {
    setOpen(next)
    if (!next) setQuery('')
  }

  const triggerClass = cn(
    'text-muted-foreground hover:bg-accent inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-foreground/25 pr-2.5 pl-2 text-[12px] disabled:opacity-50',
    open && 'bg-accent',
  )
  const triggerLabel = (
    <>
      <Plus className="size-3.5" />
      タグ
    </>
  )

  const panel = (
    <TagPanel
      value={value}
      known={known}
      query={query}
      mobile={mobile}
      headingRef={sheetFocus}
      retagging={retagging}
      disabled={disabled}
      onQuery={setQuery}
      onToggle={toggle}
      onCreate={(name) => {
        setQuery('')
        if (!value.includes(name)) onChange([...value, name])
      }}
      onClose={() => changeOpen(false)}
      onRetag={onRetag}
    />
  )

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((tag) => (
        <span
          key={tag}
          className="bg-secondary text-muted-foreground inline-flex h-7 items-center gap-0.5 rounded-full pr-0.5 pl-2.5 text-[12px]"
        >
          <Link to={tagHref(tag)} className="hover:underline">
            {[byName.get(tag)?.emoji, tag].filter(Boolean).join(' ')}
          </Link>
          <button
            type="button"
            disabled={disabled}
            onClick={() => toggle(tag)}
            aria-label={`${tag} を外す`}
            className="hover:bg-accent flex size-6 items-center justify-center rounded-full disabled:opacity-50"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      {mobile ? (
        <>
          <button
            type="button"
            disabled={disabled}
            aria-label="タグを付ける"
            onClick={() => changeOpen(true)}
            className={triggerClass}
          >
            {triggerLabel}
          </button>
          <Sheet open={open} onOpenChange={changeOpen}>
            <SheetContent
              side="bottom"
              showCloseButton={false}
              initialFocus={sheetFocus}
              className="max-h-[80dvh] gap-3 rounded-t-2xl px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            >
              <div className="bg-foreground/20 mx-auto h-1 w-10 rounded-full" />
              {panel}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <Popover open={open} onOpenChange={changeOpen}>
          <PopoverTrigger disabled={disabled} aria-label="タグを付ける" className={triggerClass}>
            {triggerLabel}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[340px] gap-2.5">
            {panel}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

interface PanelProps {
  value: string[]
  known: Tag[]
  query: string
  mobile: boolean
  headingRef: RefObject<HTMLDivElement | null>
  retagging: boolean
  disabled: boolean
  onQuery: (query: string) => void
  onToggle: (name: string) => void
  onCreate: (name: string) => void
  onClose: () => void
  onRetag?: () => void
}

function TagPanel({
  value,
  known,
  query,
  mobile,
  headingRef,
  retagging,
  disabled,
  onQuery,
  onToggle,
  onCreate,
  onClose,
  onRetag,
}: PanelProps) {
  const input = useRef<HTMLInputElement>(null)
  const typed = query.normalize('NFC').trim()

  // 付けたばかりで一覧の読み直しがまだのタグも、棚なしとして並べる
  const all = useMemo(() => {
    const names = new Set(known.map((tag) => tag.name))
    const pending = value
      .filter((name) => !names.has(name))
      .map((name): Tag => ({ name, emoji: '', text: '', group: '' }))
    return [...known, ...pending]
  }, [known, value])

  const hits = all.filter((tag) => !typed || tag.name.toLowerCase().includes(typed.toLowerCase()))
  const canCreate = typed !== '' && !all.some((tag) => tag.name === typed)
  const sections = sectionTags(hits)

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    // 変換を確定する Enter でタグを付けない
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (disabled) return
    if (hits.length > 0) {
      onToggle(hits[0].name)
      onQuery('')
    } else if (canCreate) {
      onCreate(typed)
    }
  }

  return (
    <>
      {mobile && (
        <div className="flex items-center justify-between">
          <div ref={headingRef} tabIndex={-1} className="flex flex-col gap-0.5 outline-none">
            <SheetTitle className="text-base font-semibold">タグ</SheetTitle>
            <SheetDescription className="text-muted-foreground text-xs">
              タップするとすぐ付くよ
            </SheetDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="閉じる" className="-mr-2 size-11">
            <X className="size-5" />
          </Button>
        </div>
      )}

      <label
        className={cn(
          'border-input focus-within:border-ring flex items-center gap-2 rounded-xl border px-3 dark:bg-input/30',
          mobile ? 'h-11' : 'h-9 rounded-lg px-2.5',
        )}
      >
        <Search className="text-muted-foreground size-4 shrink-0" />
        <span className="sr-only">タグを絞り込む</span>
        <input
          ref={input}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={handleKey}
          placeholder="さがす・新しく作る"
          enterKeyHint="done"
          className={cn(
            'placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none',
            mobile ? 'text-base' : 'text-[13px]',
          )}
        />
      </label>

      <div className={cn('-m-0.5 flex min-h-0 flex-col overflow-y-auto p-0.5', mobile ? 'gap-4' : 'max-h-80 gap-3')}>
        {canCreate && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onCreate(typed)
              input.current?.focus()
            }}
            className={cn(
              'border-primary bg-primary/10 text-foreground flex shrink-0 items-center gap-2 rounded-xl border border-dashed px-3 text-left disabled:opacity-50',
              mobile ? 'h-11 text-sm' : 'h-8 rounded-lg px-2.5 text-[13px]',
            )}
          >
            <Plus className="size-4 shrink-0" />
            <span className="truncate">「{typed}」を新しく作る</span>
          </button>
        )}

        {sections.map((section) => (
          <section key={section.group || 'none'} className="flex flex-col gap-1.5">
            <h3 className="text-muted-foreground text-[11px] font-semibold tracking-wide">
              {section.group || '棚なし'}
            </h3>
            <div className={cn('flex flex-wrap', mobile ? 'gap-2' : 'gap-1.5')}>
              {section.tags.map((tag) => {
                const selected = value.includes(tag.name)
                return (
                  <button
                    key={tag.name}
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() => onToggle(tag.name)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border transition-colors disabled:opacity-50',
                      mobile ? 'h-10 px-3.5 text-sm' : 'h-[30px] px-3 text-[13px]',
                      selected
                        ? 'border-primary bg-primary/15 text-foreground'
                        : 'border-foreground/15 text-foreground/85 hover:bg-accent',
                    )}
                  >
                    {selected && <Check className="text-primary size-3.5" strokeWidth={3} />}
                    {tag.emoji && <span>{tag.emoji}</span>}
                    <span>{tag.name}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}

        {sections.length === 0 && !canCreate && (
          <p className="text-muted-foreground text-xs">まだタグがないよ。上の欄に打つと作れるよ。</p>
        )}
      </div>

      <div className="border-foreground/10 flex items-center justify-between gap-2 border-t pt-2">
        {onRetag ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || retagging}
            onClick={onRetag}
            className={cn('text-muted-foreground -ml-2', mobile ? 'h-11 text-[13px]' : 'h-7 text-[12px]')}
          >
            <RefreshCw className={cn('size-3.5', retagging && 'animate-spin')} />
            {retagging ? '会話を読んでいます…' : 'AIに付け直してもらう'}
          </Button>
        ) : (
          <span />
        )}
        {mobile ? (
          <span className="text-muted-foreground text-xs">{value.length} 個</span>
        ) : (
          <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
            <kbd className="border-foreground/20 rounded border px-1 text-[10px]">Enter</kbd>
            一番上を切り替え
          </span>
        )}
      </div>
    </>
  )
}

function sectionTags(tags: Tag[]): { group: string; tags: Tag[] }[] {
  const sections: { group: string; tags: Tag[] }[] = []
  for (const tag of tags) {
    const section = sections.find((item) => item.group === tag.group)
    if (section) section.tags.push(tag)
    else sections.push({ group: tag.group, tags: [tag] })
  }
  return sections
}
