import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import type { Message } from '../../shared/types'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokuboke-file-'))
process.env.DATA_DIR = dataDir
process.env.USERS = 'taro'
process.env.TZ = 'Asia/Tokyo'

const { fileAbsPath, fileContentType, fileName, filesOf, isDocument, saveFile } =
  await import('./file')
const { withImageUrls } = await import('./image')
const { assertTopicName, assertUser, filesDir } = await import('./paths')

after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

const USER = assertUser('taro')
const TOPIC = assertTopicName('math')
const NAME = '20260823_120000_ab12_宿題.pdf'

function message(files: string[] = []): Message {
  return { id: 'x', role: 'user', text: '', images: [], files, at: new Date().toISOString() }
}

describe('isDocument', () => {
  it('拡張子で PDF とテキストを通す', () => {
    assert.ok(isDocument(new File(['x'], 'a.pdf')))
    assert.ok(isDocument(new File(['x'], 'a.txt')))
    assert.ok(isDocument(new File(['x'], 'a.md')))
    assert.ok(isDocument(new File(['x'], 'a.csv')))
    assert.ok(isDocument(new File(['x'], 'a.json')))
  })

  it('MIME だけでも通す', () => {
    assert.ok(isDocument(new File(['x'], 'a', { type: 'application/pdf' })))
    assert.ok(isDocument(new File(['x'], 'a', { type: 'text/plain' })))
  })

  it('画像は通さない', () => {
    assert.ok(!isDocument(new File(['x'], 'a.jpg', { type: 'image/jpeg' })))
    assert.ok(!isDocument(new File(['x'], 'a.png')))
  })
})

describe('fileName / fileAbsPath / fileContentType', () => {
  it('ファイル名はそのまま返す', () => {
    assert.equal(fileName(NAME), NAME)
  })

  it('URL からもファイル名を取り出す', () => {
    assert.equal(fileName(`/media/taro/math/${NAME}`), NAME)
  })

  it('ファイル名から実ファイルの位置を出す', () => {
    assert.equal(fileAbsPath(USER, TOPIC, NAME), path.join(filesDir(USER, TOPIC), NAME))
  })

  it('上位への参照や別の拡張子は受け付けない', () => {
    assert.equal(fileAbsPath(USER, TOPIC, '../../etc/passwd'), null)
    assert.equal(fileAbsPath(USER, TOPIC, 'a/b.pdf'), null)
    assert.equal(fileAbsPath(USER, TOPIC, 'note.exe'), null)
    assert.equal(fileAbsPath(USER, TOPIC, 'photo.jpg'), null)
    assert.equal(fileAbsPath(USER, TOPIC, ''), null)
  })

  it('Content-Type を拡張子から出す', () => {
    assert.equal(fileContentType('a.pdf'), 'application/pdf')
    assert.equal(fileContentType('a.txt'), 'text/plain; charset=utf-8')
    assert.equal(fileContentType('a.json'), 'application/json; charset=utf-8')
    assert.equal(fileContentType('a.exe'), null)
  })
})

describe('filesOf', () => {
  it('古いログの files 無しは空配列', () => {
    const m: Message = { id: 'x', role: 'user', text: '', images: [], at: new Date().toISOString() }
    assert.deepEqual(filesOf(m), [])
  })
})

describe('saveFile', () => {
  it('PDF をそのまま保存し、元の名前を残す', async () => {
    const file = new File([new TextEncoder().encode('%PDF-1.4\n%')], '宿題.pdf', {
      type: 'application/pdf',
    })
    const saved = await saveFile(USER, TOPIC, file)

    assert.match(saved.name, /^\d{8}_\d{6}_[0-9a-f]{4}_宿題\.pdf$/)
    assert.ok(!saved.name.includes('/'), '返すのはファイル名だけ')
    assert.equal(saved.absPath, path.join(filesDir(USER, TOPIC), saved.name))
    assert.equal(await fsp.readFile(saved.absPath, 'utf8'), '%PDF-1.4\n%')
  })

  it('テキストをそのまま保存する', async () => {
    const file = new File(['こんにちは'], 'メモ.txt', { type: 'text/plain' })
    const saved = await saveFile(USER, TOPIC, file)
    assert.match(saved.name, /_メモ\.txt$/)
    assert.equal(await fsp.readFile(saved.absPath, 'utf8'), 'こんにちは')
  })

  it('PDF として読めないものは 400', async () => {
    const junk = new File([new TextEncoder().encode('not a pdf')], 'x.pdf', {
      type: 'application/pdf',
    })
    await assert.rejects(() => saveFile(USER, TOPIC, junk), { status: 400 })
  })

  it('画像は 400', async () => {
    const img = new File(['x'], 'a.png', { type: 'image/png' })
    await assert.rejects(() => saveFile(USER, TOPIC, img), { status: 400 })
  })
})

describe('withImageUrls（ファイル）', () => {
  it('ファイル名を URL に直す', () => {
    assert.deepEqual(withImageUrls(USER, TOPIC, message([NAME])).files, [
      `/media/${USER}/math/${encodeURIComponent(NAME)}`,
    ])
  })

  it('元のメッセージを書き換えない', () => {
    const m = message([NAME])
    withImageUrls(USER, TOPIC, m)
    assert.deepEqual(m.files, [NAME], 'ログに残す側は名前のままでなければならない')
  })
})
