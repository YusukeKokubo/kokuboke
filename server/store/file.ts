import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config'
import { BadRequestError, PayloadTooLargeError } from '../errors'
import type { Message } from '../../shared/types'
import { filesDir, type TopicName, type UserName } from './paths'
import { FORBIDDEN_ALL } from './topic-name'
import { localDate } from '../../shared/date'

export interface SavedFile {
  /** ログに残すファイル名。トピックのフォルダの中で一意。 */
  name: string
  /** CLI に渡す絶対パス。 */
  absPath: string
}

const FILE_EXT = /\.(pdf|txt|md|csv|json)$/i

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

function extOf(name: string): string {
  return path.extname(name).toLowerCase()
}

/** 拡張子と MIME のどちらでも判別する。type が空で届く環境がある。 */
export function isDocument(file: File): boolean {
  if (FILE_EXT.test(file.name)) return true
  if (file.type === 'application/pdf' || file.type === 'application/json') return true
  return file.type.startsWith('text/') && extOf(file.name) === ''
}

function safeStem(name: string): string {
  const stem = path.basename(name, path.extname(name)).normalize('NFC')
  const cleaned = stem
    .replace(FORBIDDEN_ALL, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()
  return cleaned || 'file'
}

function filename(original: string): string {
  const ext = extOf(original)
  const date = localDate(new Date()).replaceAll('-', '')
  const time = new Date().toLocaleTimeString('sv-SE', { hour12: false }).replaceAll(':', '')
  const stem = safeStem(original).slice(0, 40)
  return `${date}_${time}_${crypto.randomUUID().slice(0, 4)}_${stem}${ext}`
}

/**
 * テキストと PDF を、変換せずそのまま保存する。
 * 名前は元のファイル名を残しつつ、衝突しないよう時刻と短い乱数を足す。
 */
export async function saveFile(user: UserName, id: TopicName, file: File): Promise<SavedFile> {
  if (file.size > config.uploadMaxBytes) {
    throw new PayloadTooLargeError('ファイルが大きすぎます')
  }
  if (!isDocument(file)) {
    throw new BadRequestError('テキストか PDF だけ添付できます')
  }

  const raw = Buffer.from(await file.arrayBuffer())
  const asPdf = extOf(file.name) === '.pdf' || file.type === 'application/pdf'
  if (asPdf && !raw.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new BadRequestError('PDF を読み取れませんでした')
  }

  const dir = filesDir(user, id)
  await fs.mkdir(dir, { recursive: true })

  const named = FILE_EXT.test(file.name)
    ? file.name
    : `${safeStem(file.name)}${asPdf ? '.pdf' : '.txt'}`
  const name = filename(named)
  const absPath = path.join(dir, name)
  await fs.writeFile(absPath, raw)

  return { name, absPath }
}

/** ログに残っている値からファイル名を取り出す。 */
export function fileName(stored: string): string {
  return stored.split('/').pop() ?? stored
}

/**
 * 保存済みファイルのファイル名から実ファイルの位置を割り出す。
 * パス区切りや別の拡張子は受け付けない。
 */
export function fileAbsPath(user: UserName, id: TopicName, name: string): string | null {
  if (name !== path.basename(name)) return null
  if (!FILE_EXT.test(name)) return null
  // FORBIDDEN_ALL は global なので test() に使わない。
  // eslint-disable-next-line no-control-regex -- ファイル名に制御文字を入れないための検査
  if (/[/\\:*?"<>|\u0000-\u001f\u007f]/.test(name)) return null
  return path.join(filesDir(user, id), name)
}

export function fileContentType(name: string): string | null {
  return MIME[extOf(name)] ?? null
}

export function filesOf(message: Message): string[] {
  return message.files ?? []
}
