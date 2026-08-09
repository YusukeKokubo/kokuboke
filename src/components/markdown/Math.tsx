import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { normalizeMath } from '@/lib/math'
import { elements } from './elements'

/**
 * 数式を含む返答用。KaTeX は大きいので、この形でだけ読み込まれるように
 * 呼び出し側から遅延読み込みしている。
 */
export default function MathMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      // 数式が壊れていても本文ごと落とさない。赤字で式を出して先へ進む。
      rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
      components={elements}
    >
      {normalizeMath(text)}
    </ReactMarkdown>
  )
}
