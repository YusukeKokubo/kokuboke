#!/usr/bin/env node
/**
 * JDK / Android SDK を前提に debug APK を作る。
 * Studio は不要。`CAPACITOR_SERVER_URL` は android:sync と同じく .env から読む。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

try {
  process.loadEnvFile(path.join(root, '.env'))
} catch {
  // .env が無いときは環境変数だけを見る。
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd ?? root,
    shell: false,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const brewJava = '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'
const javaHome =
  process.env.JAVA_HOME ||
  (fs.existsSync(brewJava) ? brewJava : '') ||
  (() => {
    const tip = spawnSync('/usr/libexec/java_home', ['-v', '21'], { encoding: 'utf8' })
    if (tip.status === 0 && tip.stdout.trim()) return tip.stdout.trim()
    const tip17 = spawnSync('/usr/libexec/java_home', ['-v', '17'], { encoding: 'utf8' })
    if (tip17.status === 0 && tip17.stdout.trim()) return tip17.stdout.trim()
    return ''
  })()

const androidHome =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  '/opt/homebrew/share/android-commandlinetools'

if (!javaHome) {
  console.error('JAVA_HOME が見つかりません。openjdk@21 を入れてください。\n  brew install openjdk@21')
  process.exit(1)
}

const sdkmanager = path.join(androidHome, 'cmdline-tools/latest/bin/sdkmanager')
const check = spawnSync(sdkmanager, ['--version'], { encoding: 'utf8', env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidHome } })
if (check.status !== 0) {
  console.error(
    `Android SDK が見つかりません（ANDROID_HOME=${androidHome}）。\n` +
      '  brew install android-commandlinetools\n' +
      '  mise exec -- npm run android:sdk',
  )
  process.exit(1)
}

run('npm', ['run', 'android:sync'], {
  env: {
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
  },
})

run('./gradlew', ['assembleDebug'], {
  cwd: path.join(root, 'android'),
  env: {
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
  },
})

const apk = path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk')
console.log(`\nAPK: ${apk}`)
