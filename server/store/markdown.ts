import fs from 'node:fs/promises'

/** 無ければ空文字。 */
export async function readMarkdown(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

/**
 * 末尾の改行を揃える。空なら空ファイル。
 * 手で直した版と AI が返した版で差が出ないように。
 */
export async function writeMarkdown(file: string, text: string): Promise<void> {
  const body = text.trim()
  await fs.writeFile(file, body ? body + '\n' : '')
}
