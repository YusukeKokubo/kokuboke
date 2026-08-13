/**
 * SSE に型付きで JSON を流す。stream.writeSSE の殻だけ。
 * 型引数を書き忘れると never になって send が落ちる。
 */
export function sse<T = never>(stream: { writeSSE: (opts: { data: string }) => Promise<void> }) {
  return (event: T) => stream.writeSSE({ data: JSON.stringify(event) })
}
