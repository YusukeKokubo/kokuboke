// Android ランチャーアイコンを "KKB" テキストで書き出す。
// `node scripts/generate-android-icons.mjs` のあと `npm run android:apk`。
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const BG = '#17181c'
const FG = '#3fb6c8'
const RES = 'android/app/src/main/res'

// adaptive icon のレイヤーは 108dp。レガシーは 48dp。
const densities = [
  { dir: 'mipmap-mdpi', scale: 1 },
  { dir: 'mipmap-hdpi', scale: 1.5 },
  { dir: 'mipmap-xhdpi', scale: 2 },
  { dir: 'mipmap-xxhdpi', scale: 3 },
  { dir: 'mipmap-xxxhdpi', scale: 4 },
]

function kkbSvg(size) {
  // librsvg は dominant-baseline が弱いので y を少し下げて光学的に中央へ。
  const font = Math.round(size * 0.28)
  const y = Math.round(size * 0.54)
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <text
    x="50%"
    y="${y}"
    text-anchor="middle"
    font-family="ui-sans-serif, system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    font-weight="700"
    font-size="${font}"
    fill="${FG}"
  >KKB</text>
</svg>`)
}

function foregroundSvg(size) {
  // 背景は透明。文字だけ。セーフゾーン（中央 ~66%）に収める。
  const font = Math.round(size * 0.26)
  const y = Math.round(size * 0.54)
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <text
    x="50%"
    y="${y}"
    text-anchor="middle"
    font-family="ui-sans-serif, system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    font-weight="700"
    font-size="${font}"
    fill="${FG}"
  >KKB</text>
</svg>`)
}

for (const { dir, scale } of densities) {
  const outDir = path.join(RES, dir)
  await mkdir(outDir, { recursive: true })

  const legacy = Math.round(48 * scale)
  const layer = Math.round(108 * scale)

  const full = await sharp(kkbSvg(legacy)).png().toBuffer()
  await sharp(full).toFile(path.join(outDir, 'ic_launcher.png'))
  await sharp(full).toFile(path.join(outDir, 'ic_launcher_round.png'))

  await sharp(foregroundSvg(layer)).png().toFile(path.join(outDir, 'ic_launcher_foreground.png'))
}

console.log('android launcher icons written')
