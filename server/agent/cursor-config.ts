import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * cursor-agent はヘッドレス（--print）でもウェブ検索・ページ取得のたびに
 * 承認を求める。答える人がいないので、既定では即 User Rejected になる。
 *
 * ページ取得を通す道は --force だけで、permissions の許可リストは
 * この経路では見ていない（2026.08.04-aaa8809 で確認）。検索の方は
 * cli-config.json の autoAcceptWebSearch を見るので、そこだけ立てておく。
 * このファイルは設定用のボリュームの中にあり、イメージには焼けない。
 */
function configDir(): string {
  const explicit = process.env.CURSOR_CONFIG_DIR?.trim()
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  return explicit || (xdg ? path.join(xdg, 'cursor') : path.join(os.homedir(), '.cursor'))
}

function configFile(): string {
  return path.join(configDir(), 'cli-config.json')
}

async function apply(): Promise<void> {
  const file = configFile()
  // ログイン前のコンテナにはまだ無い。読めなければ次の起動でまた試す。
  const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as Record<string, unknown>
  if (parsed.autoAcceptWebSearch === true) return

  parsed.autoAcceptWebSearch = true
  // CLI 側も一時ファイルからの rename で書き換える。同じやり方に揃えて、
  // 書きかけの形を相手に見せない。
  const tmp = `${file}.${process.pid}.tmp`
  await fsp.writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  await fsp.rename(tmp, file)
}

let settled = false
let inFlight: Promise<void> | null = null

/** cursor-agent を起動する前に一度だけ呼ぶ。立っていれば何もしない。 */
export function ensureWebSearchApproved(): Promise<void> {
  if (settled) return Promise.resolve()

  inFlight ??= apply().then(
    () => {
      settled = true
      inFlight = null
    },
    (error: unknown) => {
      // 設定を書けなくても会話そのものは続く。検索が拒否されるだけ。
      console.warn('[cursor] ウェブ検索の許可を書けませんでした:', String(error))
      inFlight = null
    },
  )

  return inFlight
}

const REMEMBER_SERVER = 'kokuboke-remember'

/**
 * cursor-agent が読む global mcp.json は `~/.cursor/mcp.json`（homedir 固定）。
 * テストで CURSOR_CONFIG_DIR を指しているときは、手元の IDE 用ファイルを触らない。
 */
function mcpConfigFile(): string {
  const explicit = process.env.CURSOR_CONFIG_DIR?.trim()
  if (explicit) return path.join(explicit, 'mcp.json')
  return path.join(os.homedir(), '.cursor', 'mcp.json')
}

function rememberLaunch(): { command: string; args: string[] } {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const bundled = path.join(here, 'mcp.js')
  if (fs.existsSync(bundled)) {
    return { command: process.execPath, args: [bundled] }
  }
  const source = path.resolve(here, '../mcp/index.ts')
  const tsx = path.resolve(here, '../../node_modules/tsx/dist/cli.mjs')
  return { command: process.execPath, args: [tsx, source] }
}

function rememberServer(): Record<string, unknown> {
  const { command, args } = rememberLaunch()
  return {
    command,
    args,
    env: {
      DATA_DIR: '${DATA_DIR}',
      USERS: '${USERS}',
      TZ: '${TZ}',
      FAMILY_DIR: '${FAMILY_DIR}',
      KOKUBOKE_REMEMBER_USER: '${KOKUBOKE_REMEMBER_USER}',
    },
  }
}

async function applyMcp(): Promise<void> {
  const file = mcpConfigFile()
  let parsed: { mcpServers?: Record<string, unknown> }
  try {
    parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as { mcpServers?: Record<string, unknown> }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    parsed = { mcpServers: {} }
  }

  const servers = { ...(parsed.mcpServers ?? {}) }
  const next = rememberServer()
  if (JSON.stringify(servers[REMEMBER_SERVER]) === JSON.stringify(next)) return

  servers[REMEMBER_SERVER] = next
  parsed.mcpServers = servers
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fsp.writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  await fsp.rename(tmp, file)
}

let mcpSettled = false
let mcpInFlight: Promise<void> | null = null

/**
 * ログインし直すと CLI が設定を書き直すことがある。次に起こすときに
 * もう一度確かめるよう、済んだ印を落とす。
 */
export function forgetCursorConfig(): void {
  settled = false
  mcpSettled = false
}

/** remember を global mcp.json に足す。既にある他のサーバーは消さない。 */
export function ensureRememberMcp(): Promise<void> {
  if (mcpSettled) return Promise.resolve()

  mcpInFlight ??= applyMcp().then(
    () => {
      mcpSettled = true
      mcpInFlight = null
    },
    (error: unknown) => {
      console.warn('[cursor] remember の mcp.json を書けませんでした:', String(error))
      mcpInFlight = null
    },
  )

  return mcpInFlight
}
