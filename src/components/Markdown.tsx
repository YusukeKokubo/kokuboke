import { Suspense, lazy, memo } from 'react'
import { PlainMarkdown } from './markdown/Plain'

const MathMarkdown = lazy(() => import('./markdown/Math'))

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
