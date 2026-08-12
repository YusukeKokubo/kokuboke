import { Suspense, lazy, memo } from 'react'
import { checkForNewBuild } from '@/lib/refresh'
import { PlainMarkdown } from './markdown/Plain'

/**
 * 数式の側は別ファイルに切り出されていて、名前にはビルドごとのハッシュが入る。
 * 配信が入れ替わったあとも開いたままだった画面は、もう無い名前を頼んでしまう。
 * ここで throw すると Suspense の外まで飛んで画面ごと真っ白になるので、
 * 数式なしの形に落として先へ進める。同じ URL は一度失敗すると読み直しても
 * 取りに行かないため、その場での再試行はしない。
 */
async function loadMathMarkdown() {
  try {
    return await import('./markdown/Math')
  } catch {
    void checkForNewBuild()
    return { default: PlainMarkdown }
  }
}

const MathMarkdown = lazy(loadMathMarkdown)

/** $…$ や \(…\) が出てきたら数式ありとみなす。 */
const MATH = /\$[^$\n]+\$|\$\$|\\\(|\\\[/

/**
 * 吹き出しの中に収める前提の Markdown。
 *
 * 生の HTML は解釈しない（react-markdown の既定）ので、モデルが何を書いても
 * タグとして実行されることはない。
 *
 * KaTeX は本体もフォントも重いので、数式が出てきた返答でだけ読み込む。
 * 読み込みが済むまでは数式なしの形で出しておく。
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const fallback = <PlainMarkdown text={text} />

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {MATH.test(text) ? (
        <Suspense fallback={fallback}>
          <MathMarkdown text={text} />
        </Suspense>
      ) : (
        fallback
      )}
    </div>
  )
})
