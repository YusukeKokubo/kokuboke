import fs from 'node:fs'
import path from 'node:path'
import { EFFORTS, ENGINES, isEngineId } from './agent/engines'
import { isTopicName, normalizeTopicName } from './store/topic-name'

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

/** 空なら空のまま。一覧外は空に落とし、assertConfig で起動時に弾く。 */
function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | '' {
  if (!value) return ''
  if ((allowed as readonly string[]).includes(value)) return value as T
  return ''
}

const CLAUDE_EFFORTS = EFFORTS

const dataDir = path.resolve(process.env.DATA_DIR ?? './data')
const isProduction = process.env.NODE_ENV === 'production'

export const config = {
  port: num(process.env.PORT, 3000),

  /** ユーザーごとのフォルダを置く場所。NAS 上のボリュームをここにマウントする。 */
  dataDir,

  /**
   * サーバーのログと CLI の時間の記録を書く場所。コンテナの入れ替えで消えないよう
   * data の中に置く（ユーザー名とぶつからないよう点で始める）。
   */
  logDir: path.resolve(process.env.LOG_DIR ?? path.join(dataDir, '.logs')),

  /**
   * 診断の AI に読ませるソース。イメージでは Dockerfile が /app/source に写す。
   * 手元ではリポジトリそのもの。
   */
  sourceDir: path.resolve(process.env.SOURCE_DIR ?? (isProduction ? '/app/source' : '.')),

  /** URL パスとして受け付けるユーザー名。ここに無い名前は 404 にする。 */
  users: list(process.env.USERS),

  /**
   * 家族共有スペースのフォルダ名。config.users には入れない。
   * `/user/_family/...` で開けてしまうのと、一覧に顔を出すのを避けるため。
   */
  familyDir: normalizeTopicName(process.env.FAMILY_DIR ?? '_family'),

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

  /** 覚え書き.md の上限。超えたら追記を断る。溜まる速さが読めないので小さく始める。 */
  memoryMaxBytes: 8 * 1024,

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
   * 自動の命名とタグ付けに使う軽いモデル。見出しとタグを選ぶだけなので重いモデルは要らず、
   * 走っているあいだはトピックの枠を握るため、長引くと次の発言が弾かれる。
   * エンジンはトピックのものに合わせ、モデルだけこちらに差し替える。
   */
  claudeLightModel: process.env.CLAUDE_LIGHT_MODEL ?? 'claude-haiku-4-5',
  cursorLightModel: process.env.CURSOR_LIGHT_MODEL ?? 'composer-2.5',

  /** トピックで深さを選んでいないときの既定。未指定なら CLI の既定に任せる。 */
  claudeEffort: oneOf(process.env.CLAUDE_EFFORT, CLAUDE_EFFORTS),

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

  /**
   * Firebase のサービスアカウント JSON。中身そのものか、ファイルの場所。
   * どちらも空なら push は飛ばさない（トークンの受け取りだけは動く）。
   */
  fcmServiceAccount: process.env.FCM_SERVICE_ACCOUNT ?? '',
  fcmServiceAccountPath: process.env.FCM_SERVICE_ACCOUNT_PATH ?? '',

  isProduction,
} as const

export function assertConfig(): void {
  const modelIds = (engine: string): string[] =>
    ENGINES.find((item) => item.id === engine)?.models.map((model) => model.id) ?? []

  const assertModel = (key: string, model: string, engine: string): void => {
    const ids = modelIds(engine)
    if (ids.includes(model)) return
    throw new Error(`${key} が不正です。${engine} で使えるのは ${ids.join(' | ')}`)
  }

  if (config.users.length === 0) {
    throw new Error('環境変数 USERS が空です。例: USERS=taro,hanako')
  }
  if (config.users.includes(config.familyDir)) {
    throw new Error(
      `FAMILY_DIR（${config.familyDir}）が USERS の名前とぶつかっています`,
    )
  }
  if (config.users.includes('family')) {
    throw new Error(
      'USERS に family は使えません。画像 URL の経路 /media/family/ とぶつかります',
    )
  }
  if (!isTopicName(config.familyDir)) {
    throw new Error(`FAMILY_DIR が不正です: ${config.familyDir}`)
  }
  if (process.env.CLAUDE_EFFORT && !config.claudeEffort) {
    throw new Error(`CLAUDE_EFFORT が不正です。使えるのは ${CLAUDE_EFFORTS.join(' | ')}`)
  }
  assertModel('CLAUDE_MODEL', config.claudeModel, 'claude')
  assertModel('CURSOR_MODEL', config.cursorModel, 'cursor')
  assertModel('CLAUDE_LIGHT_MODEL', config.claudeLightModel, 'claude')
  assertModel('CURSOR_LIGHT_MODEL', config.cursorLightModel, 'cursor')
}
