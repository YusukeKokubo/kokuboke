import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * 吹き出しの中に収める前提の Markdown。
 * 生の HTML は解釈しない（react-markdown の既定）ので、モデルが何を書いても
 * タグとして実行されることはない。
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="break-words">{children}</p>,

          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="opacity-60">{children}</del>,

          // 見出しは吹き出しの中では大きすぎるので、太字の一行として扱う。
          h1: ({ children }) => <p className="font-semibold">{children}</p>,
          h2: ({ children }) => <p className="font-semibold">{children}</p>,
          h3: ({ children }) => <p className="font-semibold">{children}</p>,
          h4: ({ children }) => <p className="font-semibold">{children}</p>,

          ul: ({ children }) => (
            <ul className="ml-4 flex list-outside list-disc flex-col gap-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-4 flex list-outside list-decimal flex-col gap-1">{children}</ol>
          ),
          li: ({ children }) => <li className="break-words">{children}</li>,

          code: ({ className, children }) => {
            // ``` で囲まれたものには言語クラスが付く。付いていなければ文中のコード。
            const block = /language-/.test(className ?? '')
            if (!block) {
              return (
                <code className="bg-background/40 rounded px-1 py-0.5 text-[13px]">{children}</code>
              )
            }
            return <code className="text-[13px]">{children}</code>
          },
          pre: ({ children }) => (
            <pre className="bg-background/40 overflow-x-auto rounded-lg p-2.5">{children}</pre>
          ),

          blockquote: ({ children }) => (
            <blockquote className="border-l-2 pl-3 opacity-80">{children}</blockquote>
          ),
          hr: () => <hr className="my-1" />,

          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2"
            >
              {children}
            </a>
          ),

          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b px-2 py-1 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="border-b px-2 py-1 align-top">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
