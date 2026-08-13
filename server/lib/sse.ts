/**
 * SSE に型付きで JSON を流す。stream.writeSSE の殻だけ。
 */
export function sse<T>(stream: { writeSSE: (opts: { data: string }) => Promise<void> }) {
  return (event: T) => stream.writeSSE({ data: JSON.stringify(event) })
}
