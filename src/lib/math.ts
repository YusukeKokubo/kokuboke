/**
 * `\( … \)` と `\[ … \]` を `$ … $` / `$$ … $$` に直す。
 *
 * remark-math が解釈するのはドル記号の形だけだが、モデルは括弧の形でも書いてくる。
 * どちらで書かれても数式として組めるように、読み込む前に寄せておく。
 * コードの中は書かれたとおりが正しいので触らない。
 */
export function normalizeMath(text: string): string {
  // ``` で囲まれたブロックと ` で囲まれた文中コードを境目にして分割する。
  // 捕捉した区切り自体も配列に残るので、奇数番目がコードになる。
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g)

  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part
      return (
        part
          .replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => `$$${body}$$`)
          .replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => `$${body}$`)
          // remark-math が独立した式として扱うのは $$ が行頭と行末に来た形だけ。
          // モデルは 1 行で書いてくることが多いので、行を分けた形に直す。
          .replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, body: string) => `$$\n${body.trim()}\n$$`)
      )
    })
    .join('')
}
