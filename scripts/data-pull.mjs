#!/usr/bin/env node
/**
 * 本番の data（NAS を SMB で開いた先）を手元へ片方向に写す。
 * CLI は作業ディレクトリを SMB 越しに探ると一文字目まで数十秒かかるので、
 * 手元の `npm run dev` は写しの方を見る。
 *
 * 写しは本番の正本に合わせて丸ごと上書きする（--delete）。手元で作った会話や
 * 直した人格ファイルは次に写したときに消える。本番に出したいものは本番の画面で直す。
 *
 * 取り違えて本番を消さないよう、写し先には目印のファイルを置き、
 * 目印があるか空のフォルダにしか写さない。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const MARKER = '.kokuboke-pull'

try {
  process.loadEnvFile('.env')
} catch {
  // .env が無いときは環境変数だけを見る。
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

const fromRaw = process.env.DATA_PULL_FROM?.trim()
const toRaw = process.env.DATA_DIR?.trim()
if (!fromRaw || !toRaw) {
  fail('.env に DATA_PULL_FROM（本番の data）と DATA_DIR（手元の写し）を書いてください。')
}

const from = path.resolve(fromRaw)
const to = path.resolve(toRaw)

const inside = (child, parent) => {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
if (inside(to, from) || inside(from, to)) {
  fail(`DATA_PULL_FROM と DATA_DIR が重なっています:\n  ${from}\n  ${to}`)
}

if (!fs.existsSync(from)) {
  fail(`${from} が見つかりません。NAS を SMB で開いてから叩いてください。`)
}

// リポジトリの中だと、手元から起こした CLI がこのプロジェクトの AGENTS.md まで読む。
if (inside(to, process.cwd())) {
  console.warn(`注意: ${to} はリポジトリの中です。会話にこのプロジェクトの AGENTS.md が混ざります。`)
}

if (fs.existsSync(to)) {
  const marked = fs.existsSync(path.join(to, MARKER))
  if (!marked && fs.readdirSync(to).length > 0) {
    fail(
      `${to} は写しの目印（${MARKER}）が無く、空でもありません。\n` +
        '本番を指していないか確かめてください。写し先で間違いなければ目印を置いてから叩き直してください。',
    )
  }
} else {
  fs.mkdirSync(to, { recursive: true })
}
fs.writeFileSync(path.join(to, MARKER), `写し元: ${from}\n`)

const result = spawnSync(
  'rsync',
  [
    '-a',
    '--delete',
    // 除外したものは --delete でも消えない。目印はここで守る。
    '--exclude',
    MARKER,
    '--exclude',
    '.DS_Store',
    '--exclude',
    '._*',
    `${from}/`,
    `${to}/`,
  ],
  { stdio: 'inherit' },
)
if (result.status !== 0) process.exit(result.status ?? 1)

console.log(`写しました: ${from} → ${to}`)
