#!/usr/bin/env node
/**
 * Android 向けにクライアントをビルドして `npx cap sync` する。
 * CAPACITOR_SERVER_URL（Tailscale の https://…）が無いと、
 * 端末ではローカル資産だけを開き API に届かないので止める。
 */
import { spawnSync } from 'node:child_process'

try {
  process.loadEnvFile('.env')
} catch {
  // .env が無いときは環境変数だけを見る。
}

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim()
if (!serverUrl) {
  console.error(
    'CAPACITOR_SERVER_URL が未設定です。\n' +
      '例: CAPACITOR_SERVER_URL=https://kokuboke.tailXXXX.ts.net npm run android:sync',
  )
  process.exit(1)
}

if (!/^https:\/\//i.test(serverUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(serverUrl)) {
  console.error('CAPACITOR_SERVER_URL は https://…（開発時のみ http://localhost）にしてください。')
  process.exit(1)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm', ['run', 'build:client'])
run('npx', ['cap', 'sync', 'android'])
