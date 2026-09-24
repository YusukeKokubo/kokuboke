/** 使い捨ての相談（タグの相談、診断）に使う吹き出し。会話画面の MessageBubble とは別物。 */
export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap">
        {text}
      </div>
    </div>
  )
}

export function ReplyBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card text-card-foreground max-w-[85%] min-w-0 rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-[15px] leading-relaxed break-words">
      {children}
    </div>
  )
}
