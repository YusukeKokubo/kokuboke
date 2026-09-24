import { execFile, spawn, type ChildProcess } from 'node:child_process'
import type { CursorLogin } from '../../shared/types'
import { config } from '../config'
import { forgetCursorConfig } from './cursor-config'
import { childEnv } from './process'

/**
 * cursor-agent のログインを管理画面から通す。
 *
 * `cursor-agent login` は NO_OPEN_BROWSER を立てるとブラウザを開かず、
 * 「Open a browser and navigate to this link: https://cursor.com/loginDeepControl?…」
 * と一行出して、認証が済むまでサーバーに問い合わせ続ける（2026.09.23-86fc751 で確認）。
 * 手元で受け取る口を開く作りではないので、URL はどの端末のブラウザで開いてもよい。
 *
 * 手続きは機械全体で一つだけ持つ。途中でもう一度頼まれたら、同じ URL を返す。
 */

type Flow = CursorLogin['flow']

/** 出てくる URL。challenge と uuid がクエリに付く。 */
const URL_PATTERN = /https:\/\/cursor\.com\/loginDeepControl\?\S+/

/** URL が出るまでの上限。起動に 10 秒前後かかる機械もある。 */
const URL_WAIT_MS = 60_000

/** 認証を待つ上限。開き忘れたまま CLI を残し続けない。 */
const LOGIN_WAIT_MS = 10 * 60_000

let flow: Flow = { phase: 'idle' }
let child: ChildProcess | null = null

/** 失敗したときに出す分。制御文字を落として末尾だけ残す。 */
function tail(output: string): string {
  // eslint-disable-next-line no-control-regex
  return output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim().split('\n').slice(-3).join('\n')
}

/** いまログインしているか。`status --format json` の isAuthenticated を見る。 */
async function readAccount(): Promise<{ installed: boolean; account: string | null }> {
  return new Promise((resolve) => {
    execFile(
      config.cursorBin,
      ['status', '--format', 'json'],
      { env: childEnv(), timeout: 30_000 },
      (error, stdout) => {
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          resolve({ installed: false, account: null })
          return
        }
        try {
          const parsed = JSON.parse(stdout) as {
            isAuthenticated?: boolean
            userInfo?: { email?: string }
          }
          resolve({
            installed: true,
            account: parsed.isAuthenticated ? (parsed.userInfo?.email ?? '（アカウント不明）') : null,
          })
        } catch {
          resolve({ installed: true, account: null })
        }
      },
    )
  })
}

export async function cursorLogin(): Promise<CursorLogin> {
  return { ...(await readAccount()), flow }
}

/**
 * ログインを始めて、URL が出たところで返す。
 * 返したあとも CLI は裏で待ち続け、認証が済めば終わる。
 */
export function startCursorLogin(): Promise<Flow> {
  if (flow.phase === 'waiting' && child) return Promise.resolve(flow)

  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const settle = (next: Flow) => {
      flow = next
      if (settled) return
      settled = true
      resolve(next)
    }

    const proc = spawn(config.cursorBin, ['login'], {
      env: childEnv({ NO_OPEN_BROWSER: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child = proc

    const giveUp = (message: string) => {
      settle({ phase: 'failed', message })
      proc.kill('SIGTERM')
    }
    const urlTimer = setTimeout(() => giveUp('ログインの URL が出てきませんでした'), URL_WAIT_MS)
    const loginTimer = setTimeout(
      () => giveUp('認証を待ちきれませんでした。もう一度ログインを押してください'),
      LOGIN_WAIT_MS,
    )

    const onData = (chunk: Buffer) => {
      // 上限を設けないと、暴走時にメモリを持っていかれる。
      if (output.length < 8_000) output += chunk.toString('utf8')
      if (flow.phase === 'waiting') return
      const url = URL_PATTERN.exec(output)?.[0]
      if (url) {
        clearTimeout(urlTimer)
        settle({ phase: 'waiting', url })
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)

    proc.on('error', (error) => {
      clearTimeout(urlTimer)
      clearTimeout(loginTimer)
      child = null
      settle({ phase: 'failed', message: `${config.cursorBin} を起動できませんでした: ${error.message}` })
    })

    proc.on('close', (code) => {
      clearTimeout(urlTimer)
      clearTimeout(loginTimer)
      if (child === proc) child = null
      if (flow.phase === 'failed') return

      if (code === 0) {
        console.log('[cursor-login] ログインしました')
        forgetCursorConfig()
        settle({ phase: 'idle' })
        return
      }
      console.error('[cursor-login]', code, tail(output))
      settle({ phase: 'failed', message: tail(output) || `ログインが終わりませんでした (code ${code})` })
    })
  })
}
