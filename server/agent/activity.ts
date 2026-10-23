/**
 * 「いま何をしているか」の一言。読むのは家族なので、道具の名前はそのまま出さず、
 * 何が起きているかだけを書く。知らない道具は「調べています」に丸める。
 *
 * CLI の道具は増えるので、対応表に無いものが来ることを前提にする。
 * 表に足すときは、実際に叩いて出てきた名前を写す（推測で書かない）。
 */
export type ActivityKind = 'read' | 'search' | 'web' | 'fetch' | 'other'

const LABELS: Record<ActivityKind, string> = {
  read: 'ファイルを見ています',
  search: '書いたものを探しています',
  web: 'ウェブで調べています',
  fetch: 'ページを読んでいます',
  other: '調べています',
}

/** Claude Code の tool_use の name。会話で許しているのは Read だけ。 */
const CLAUDE: Record<string, ActivityKind> = {
  Read: 'read',
  Glob: 'search',
  Grep: 'search',
  WebSearch: 'web',
  WebFetch: 'fetch',
}

/** Claude Code の tool_use の name から札を選ぶ。 */
export function claudeActivity(name: string): string {
  return LABELS[CLAUDE[name] ?? 'other']
}
