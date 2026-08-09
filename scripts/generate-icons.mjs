// public/favicon.svg から PWA 用の PNG を書き出す。
// アイコンを差し替えたら `node scripts/generate-icons.mjs` を実行する。
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

const BG = '#17181c'
const svg = await readFile('public/favicon.svg')

for (const size of [192, 512]) {
  await sharp(svg).resize(size, size).png().toFile(`public/icon-${size}.png`)
}

// maskable は端が円形に切り取られるので、内側に寄せて余白を足す。
await sharp(svg)
  .resize(360, 360)
  .extend({ top: 76, bottom: 76, left: 76, right: 76, background: BG })
  .png()
  .toFile('public/icon-512-maskable.png')

await sharp(svg)
  .resize(180, 180)
  .flatten({ background: BG })
  .png()
  .toFile('public/apple-touch-icon.png')

console.log('icons written to public/')
