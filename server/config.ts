import fs from 'node:fs'
import path from 'node:path'
import { isEngineId } from './agent/engines'

// 手元で `npm run dev` するときのために .env を読む。
// コンテナでは compose が環境変数を渡すので、このファイルは存在しない。
if (fs.existsSync('.env')) {
  process.loadEnvFile('.env')
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export const config = {
  port: num(process.env.PORT, 3000),

  /** ユーザーごとのフォルダを置く場所。NAS 上のボリュームをここにマウントする。 */
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),

  /** URL パスとして受け付けるユーザー名。ここに無い名前は 404 にする。 */
  users: list(process.env.USERS),

  /** 当日を含めて何日分のログをコンテキストに含めるか。 */
  contextDays: num(process.env.CONTEXT_DAYS, 3),

  /** 同時に走らせる Claude Code プロセスの上限。NAS のメモリに直結する。 */
  maxConcurrent: num(process.env.MAX_CONCURRENT, 2),

  /** 1 回の応答を待つ上限（ミリ秒）。 */
  requestTimeoutMs: num(process.env.REQUEST_TIMEOUT_MS, 5 * 60 * 1000),

  /** アップロード画像の長辺の上限。大きいまま送るとトークンが嵩む。 */
  imageMaxEdge: num(process.env.IMAGE_MAX_EDGE, 1568),

  /** 受け付けるアップロードの最大バイト数。 */
  uploadMaxBytes: num(process.env.UPLOAD_MAX_BYTES, 20 * 1024 * 1024),

  /** トピックに指定が無いときに使うエンジン。 */
  defaultEngine: isEngineId(process.env.DEFAULT_ENGINE) ? process.env.DEFAULT_ENGINE : 'cursor',

  /** 各 CLI の実行ファイル名。PATH 上にあるものを使う。 */
  claudeBin: process.env.CLAUDE_BIN ?? 'claude',
  cursorBin: process.env.CURSOR_BIN ?? 'cursor-agent',

  /** 会話に使うモデル。ENGINES にある id。無い値は捨てて既定に落ちる。 */
  claudeModel: process.env.CLAUDE_MODEL ?? 'claude-opus-5',

  /** cursor-agent 側の既定モデル。 */
  cursorModel: process.env.CURSOR_MODEL ?? 'auto',

  /**
   * 要約の更新に使うエンジン。会話と違ってファイルを書き換えるので、
   * ツール単位で権限を絞れる Claude Code を既定にしている。
   */
  summaryEngine: isEngineId(process.env.SUMMARY_ENGINE) ? process.env.SUMMARY_ENGINE : 'claude',

  /** 要約は素早く安く済ませたいので、別に指定できるようにする。ENGINES にある id で。 */
  summaryModel: process.env.SUMMARY_MODEL ?? 'claude-sonnet-5',

  /** low | medium | high | xhigh | max。未指定なら CLI の既定に任せる。 */
  claudeEffort: process.env.CLAUDE_EFFORT ?? '',

  /**
   * このイメージを作った元のコミット。Dockerfile が GIT_SHA から焼き込む。
   * 手元で直に動かしたときは空で、そのときは更新の確認そのものを出さない。
   */
  appCommit: process.env.APP_COMMIT ?? '',

  /** 更新の有無を尋ねる先。公開リポジトリなので認証は要らない。 */
  githubRepo: process.env.GITHUB_REPO ?? 'YusukeKokubo/kokuboke',

  /**
   * 管理画面の鍵。空なら管理画面ごと閉じる（手元と、鍵を決めていない機械では
   * 触れない）。誰の画面かを URL でしか分けていないので、家族の URL を知って
   * いるだけでは更新を叩けないようにする。
   */
  adminToken: process.env.ADMIN_TOKEN ?? '',

  /** Watchtower の待ち受け。compose がコンテナ間の名前で渡す。 */
  watchtowerUrl: process.env.WATCHTOWER_URL ?? '',
  watchtowerToken: process.env.WATCHTOWER_TOKEN ?? '',

  isProduction: process.env.NODE_ENV === 'production',
} as const

export function assertConfig(): void {
  if (config.users.length === 0) {
    throw new Error('環境変数 USERS が空です。例: USERS=taro,hanako')
  }
}
