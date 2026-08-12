#!/usr/bin/env node
/**
 * Homebrew の android-commandlinetools に、このリポが要る platform / build-tools を入れる。
 * ライセンス同意も含む。Studio は不要。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const androidHome =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  '/opt/homebrew/share/android-commandlinetools'

const brewJava = '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'
const javaHome =
  process.env.JAVA_HOME ||
  (fs.existsSync(brewJava) ? brewJava : '') ||
  (() => {
    for (const v of ['21', '17']) {
      const tip = spawnSync('/usr/libexec/java_home', ['-v', v], { encoding: 'utf8' })
      if (tip.status === 0 && tip.stdout.trim()) return tip.stdout.trim()
    }
    return ''
  })()

if (!javaHome) {
  console.error('JAVA_HOME が見つかりません。先に `brew install openjdk@21` してください。')
  process.exit(1)
}

const sdkmanager = path.join(androidHome, 'cmdline-tools/latest/bin/sdkmanager')
if (!fs.existsSync(sdkmanager)) {
  console.error(
    `sdkmanager がありません: ${sdkmanager}\n` +
      '  brew install android-commandlinetools\n' +
      '  # 入れたあと ANDROID_HOME=/opt/homebrew/share/android-commandlinetools',
  )
  process.exit(1)
}

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  ANDROID_SDK_ROOT: androidHome,
}

function run(args, { input } = {}) {
  const result = spawnSync(sdkmanager, args, {
    stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    env,
    input,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// compileSdk 36（android/variables.gradle）向け。build-tools は近い版でよい。
const packages = [
  'platform-tools',
  'platforms;android-36',
  'build-tools;36.0.0',
  // AGP がビルド中に追加で取りに行くことがある
  'build-tools;35.0.0',
]

console.log(`ANDROID_HOME=${androidHome}`)
console.log(`JAVA_HOME=${javaHome}`)
run(['--licenses'], { input: 'y\n'.repeat(100) })
run(packages)

console.log('\nSDK の準備ができた。次は `mise exec -- npm run android:apk`')
