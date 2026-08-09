import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { elements } from './elements'

/** 数式を含まない返答用。こちらは KaTeX を読み込まない。 */
export function PlainMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={elements}>
      {text}
    </ReactMarkdown>
  )
}
