import { execFile, spawn, type ChildProcess } from 'node:child_process'
import type { EngineId, EngineLogin } from '../../shared/types'
import { config } from '../config'
import { forgetCursorConfig } from './cursor-config'
import { childEnv } from './process'

/**
 * CLI のログインを管理画面から通す。どちらの CLI も、ブラウザを開けないときは
 * 認証の URL を出して待つ。違いは認証のあとで、cursor は CLI が自分で気付いて
 * 終わり、Claude Code は戻り先のページに出るコードを貼って返すまで待つ。
 * 手元で返事を受け取る口を開く作りではないので、URL はどの端末で開いてもよい。
 *
 * 手続きはエンジンごとに一つだけ持つ。途中でもう一度頼まれたら、同じ URL を返す。
 */

type Flow = EngineLogin['flow']

interface LoginSpec {
  bin: () => string
  loginArgs: string[]
  statusArgs: string[]
  /** ブラウザを開かせないための足し分。 */
  env: Record<string, string>
  /** 認証のあとにコードを貼って返すか。 */
  needsCode: boolean
  /** status の JSON から、ログインしていればアカウントを返す。 */
  account(status: Record<string, unknown>): string | null
  /** 済んだあとの後始末。 */
  afterLogin?: () => void
}

const SPECS: Record<EngineId, LoginSpec> = {
  /**
   * NO_OPEN_BROWSER を立てると
   * 「Open a browser and navigate to this link: https://cursor.com/loginDeepControl?…」
   * と一行出して、認証が済むまでサーバーに問い合わせ続ける（2026.09.23-86fc751 で確認）。
   * status --format json は isAuthenticated と userInfo.email を返す。
   */
  cursor: {
    bin: () => config.cursorBin,
    loginArgs: ['login'],
    statusArgs: ['status', '--format', 'json'],
    env: { NO_OPEN_BROWSER: '1' },
    needsCode: false,
    account: (s) => {
      if (s.isAuthenticated !== true) return null
      return (s.userInfo as { email?: string } | undefined)?.email ?? '（アカウント不明）'
    },
    // ログインし直すと CLI が cli-config.json を書き直すことがある。
    afterLogin: forgetCursorConfig,
  },

  /**
   * 「If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?…」
   * と出してから「Paste code here if prompted >」で標準入力を待つ（2.1.281 で確認）。
   * 戻り先は platform.claude.com のページで、そこに出るコードを貼る。
   * URL は端末のリンク（OSC 8）に包まれて二度出るので、包みを剥がしてから拾う。
   * BROWSER を何もしないコマンドにしておくと、開こうとして止まることもない。
   * auth status は JSON が既定で、loggedIn と email を返す。
   */
  claude: {
    bin: () => config.claudeBin,
    loginArgs: ['auth', 'login'],
    statusArgs: ['auth', 'status', '--json'],
    env: { BROWSER: 'true' },
    needsCode: true,
    account: (s) => (s.loggedIn === true ? String(s.email ?? '（アカウント不明）') : null),
  },
}

/** 認証の URL。端末の包みを剥がした（plain を通した）あとの出力から拾う。 */
const URL_PATTERN: Record<EngineId, RegExp> = {
  cursor: /https:\/\/cursor\.com\/loginDeepControl\?\S+/,
  claude: /https:\/\/\S*oauth\/authorize\?\S+/,
}

/** URL が出るまでの上限。起動に 10 秒前後かかる機械もある。 */
const URL_WAIT_MS = 60_000

/** 認証を待つ上限。開き忘れたまま CLI を残し続けない。 */
const LOGIN_WAIT_MS = 10 * 60_000

interface State {
  flow: Flow
  child: ChildProcess | null
  /** コードを貼ったあとに届いた出力。貼るたびに空に戻す。 */
  afterCode: string | null
}

const states: Record<EngineId, State> = {
  cursor: { flow: { phase: 'idle' }, child: null, afterCode: null },
  claude: { flow: { phase: 'idle' }, child: null, afterCode: null },
}

/** 端末の色付けやリンクの包み（OSC 8）を落とす。 */
function plain(output: string): string {
  return (
    output
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  )
}

/** 入力を促す文句。貼ったあとの知らせや失敗の文言に混ざるので落とす。 */
const PROMPT = /Paste code here if prompted >/g

/** 失敗したときに出す分。CLI は最後の一行に理由を書く。 */
function tail(output: string): string {
  const lines = plain(output).replace(PROMPT, '').split('\n').map((line) => line.trim())
  return lines.filter(Boolean).at(-1) ?? ''
}

async function readAccount(engine: EngineId): Promise<{ installed: boolean; account: string | null }> {
  const spec = SPECS[engine]
  return new Promise((resolve) => {
    execFile(spec.bin(), spec.statusArgs, { env: childEnv(), timeout: 30_000 }, (error, stdout) => {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
        resolve({ installed: false, account: null })
        return
      }
      try {
        resolve({ installed: true, account: spec.account(JSON.parse(stdout) as Record<string, unknown>) })
      } catch {
        resolve({ installed: true, account: null })
      }
    })
  })
}

export async function engineLogin(engine: EngineId): Promise<EngineLogin> {
  return { engine, ...(await readAccount(engine)), flow: states[engine].flow }
}

/**
 * ログインを始めて、URL が出たところで返す。
 * 返したあとも CLI は裏で待ち続け、認証が済めば（コードが要るエンジンは貼られれば）終わる。
 */
export function startLogin(engine: EngineId): Promise<Flow> {
  const spec = SPECS[engine]
  const state = states[engine]
  if (state.flow.phase === 'waiting' && state.child) return Promise.resolve(state.flow)

  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const settle = (next: Flow) => {
      state.flow = next
      if (settled) return
      settled = true
      resolve(next)
    }

    state.afterCode = null
    const proc = spawn(spec.bin(), spec.loginArgs, {
      env: childEnv(spec.env),
      // コードを貼るエンジンのために、標準入力は開けたままにしておく。
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    state.child = proc

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
      if (output.length < 16_000) output += chunk.toString('utf8')
      if (state.flow.phase === 'waiting') {
        // 貼ったコードの形が違うと「Invalid code. …」と言って、終わらずにまた待つ。
        // 画面が黙ったままにならないよう、言われたことをそのまま添える。
        if (state.afterCode !== null) {
          state.afterCode += chunk.toString('utf8')
          const notice = plain(state.afterCode).replace(PROMPT, '').trim()
          if (notice) state.flow = { ...state.flow, notice }
        }
        return
      }
      const url = URL_PATTERN[engine].exec(plain(output))?.[0]
      if (url) {
        clearTimeout(urlTimer)
        settle({ phase: 'waiting', url, needsCode: spec.needsCode })
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    // 貼る前に CLI が終わると、書き込みが EPIPE で落ちる。close の方で拾う。
    proc.stdin.on('error', () => {})

    proc.on('error', (error) => {
      clearTimeout(urlTimer)
      clearTimeout(loginTimer)
      state.child = null
      settle({ phase: 'failed', message: `${spec.bin()} を起動できませんでした: ${error.message}` })
    })

    proc.on('close', (code) => {
      clearTimeout(urlTimer)
      clearTimeout(loginTimer)
      if (state.child === proc) state.child = null
      if (state.flow.phase === 'failed') return

      if (code === 0) {
        console.log(`[login:${engine}] ログインしました`)
        spec.afterLogin?.()
        settle({ phase: 'idle' })
        return
      }
      console.error(`[login:${engine}]`, code, tail(output))
      settle({ phase: 'failed', message: tail(output) || `ログインが終わりませんでした (code ${code})` })
    })
  })
}

/** 認証のあとに出たコードを、待っている CLI に渡す。 */
export function submitLoginCode(engine: EngineId, code: string): boolean {
  const state = states[engine]
  if (state.flow.phase !== 'waiting' || !state.child?.stdin?.writable) return false
  state.afterCode = ''
  state.flow = { ...state.flow, notice: undefined }
  state.child.stdin.write(`${code.trim()}\n`)
  return true
}
