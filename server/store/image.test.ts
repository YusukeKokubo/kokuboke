import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import sharp from 'sharp'
import type { Message } from '../../shared/types'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-test-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'
process.env.TZ = 'Asia/Tokyo'

const { imageAbsPath, imageName, mediaUrl, saveImage, withImageUrls } = await import('./image')
const { imagesDir } = await import('./paths')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const USER = 'taro'
const TOPIC = 'math'
const OLD_URL = '/media/taro/math/20260809_120000_ab12.jpg'
const NAME = '20260809_120000_ab12.jpg'

function message(images: string[]): Message {
  return { id: 'x', role: 'user', text: '', images, at: new Date().toISOString() }
}

describe('imageName', () => {
  it('ファイル名はそのまま返す', () => {
    assert.equal(imageName(NAME), NAME)
  })

  it('以前の形式で保存された URL からもファイル名を取り出す', () => {
    assert.equal(imageName(OLD_URL), NAME)
  })
})

describe('mediaUrl', () => {
  it('ファイル名から URL を組み立てる', () => {
    assert.equal(mediaUrl(USER, TOPIC, NAME), OLD_URL)
  })

  it('古いログの URL を渡しても二重にならない', () => {
    assert.equal(mediaUrl(USER, TOPIC, OLD_URL), OLD_URL)
  })

  it('日本語のトピック名を符号化する', () => {
    const url = mediaUrl(USER, '算数の宿題', NAME)
    assert.equal(url, `/media/${USER}/${encodeURIComponent('算数の宿題')}/${NAME}`)
  })

  it('# を符号化する', () => {
    // 素で入れると # から先が断片として切り落とされ、画像が出なくなる。
    const url = mediaUrl(USER, 'C#入門', NAME)
    assert.ok(url.includes('%23'), url)
    assert.ok(!url.includes('#'), url)
  })

  it('トピックを移しても URL は今の場所を指す', () => {
    assert.equal(mediaUrl(USER, 'science', NAME), `/media/${USER}/science/${NAME}`)
  })
})

describe('withImageUrls', () => {
  it('画像の無いメッセージはそのまま返す', () => {
    const m = message([])
    assert.equal(withImageUrls(USER, TOPIC, m), m)
  })

  it('ファイル名を URL に直す', () => {
    assert.deepEqual(withImageUrls(USER, TOPIC, message([NAME])).images, [OLD_URL])
  })

  it('元のメッセージを書き換えない', () => {
    const m = message([NAME])
    withImageUrls(USER, TOPIC, m)
    assert.deepEqual(m.images, [NAME], 'ログに残す側は名前のままでなければならない')
  })
})

describe('imageAbsPath', () => {
  it('ファイル名から実ファイルの位置を出す', () => {
    assert.equal(imageAbsPath(USER, TOPIC, NAME), path.join(imagesDir(USER, TOPIC), NAME))
  })

  it('上位への参照や別の拡張子は受け付けない', () => {
    assert.equal(imageAbsPath(USER, TOPIC, '../../etc/passwd'), null)
    assert.equal(imageAbsPath(USER, TOPIC, 'a/b.jpg'), null)
    assert.equal(imageAbsPath(USER, TOPIC, 'note.md'), null)
    assert.equal(imageAbsPath(USER, TOPIC, ''), null)
  })
})

describe('saveImage', () => {
  it('JPEG に直して保存し、ファイル名だけを返す', async () => {
    const png = await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer()

    const file = new File([new Uint8Array(png)], 'photo.png', { type: 'image/png' })
    const saved = await saveImage(USER, TOPIC, file)

    assert.match(saved.name, /^\d{8}_\d{6}_[0-9a-f]{4}\.jpg$/)
    assert.ok(!saved.name.includes('/'), '返すのはファイル名だけ')
    assert.equal(saved.absPath, path.join(imagesDir(USER, TOPIC), saved.name))

    const meta = await sharp(await fsp.readFile(saved.absPath)).metadata()
    assert.equal(meta.format, 'jpeg')
  })

  it('長辺を上限まで縮める', async () => {
    const wide = await sharp({
      create: { width: 3000, height: 1000, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer()

    const file = new File([new Uint8Array(wide)], 'wide.png', { type: 'image/png' })
    const saved = await saveImage(USER, TOPIC, file)
    const meta = await sharp(await fsp.readFile(saved.absPath)).metadata()
    // IMAGE_MAX_EDGE の既定値。config は import した時点で環境変数を読むので、
    // ここで書き換えても効かない。
    assert.equal(meta.width, 1568)
  })

  it('画像として読めないものは 400', async () => {
    const junk = new File([new TextEncoder().encode('not an image')], 'x.jpg', { type: 'image/jpeg' })
    await assert.rejects(() => saveImage(USER, TOPIC, junk), { status: 400 })
  })
})
