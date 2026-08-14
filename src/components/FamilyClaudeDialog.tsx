import { useCallback } from 'react'
import { familyApi } from '@/lib/api'
import { DocDialog } from '@/components/DocDialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 家族共有スペース直下の CLAUDE.md。profile.md は無い。 */
export function FamilyClaudeDialog({ open, onOpenChange }: Props) {
  const load = useCallback(() => familyApi.getClaude(), [])
  const save = useCallback((text: string) => familyApi.saveClaude(text), [])

  return (
    <DocDialog
      open={open}
      onOpenChange={onOpenChange}
      title="家族の CLAUDE.md"
      description="家族みんなの秘書役の土台。どのトピックの会話にも効くよ。"
      placeholder="まだ書いていないよ。"
      source="family:root"
      load={load}
      save={save}
    />
  )
}
