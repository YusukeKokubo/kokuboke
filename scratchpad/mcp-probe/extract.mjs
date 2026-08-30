import fs from 'node:fs'

const dir = '/Users/yusuke/.local/share/cursor-agent/versions/2026.08.25-3e8eec8'
const marker = '"./src/mcp/project-paths.ts"'
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  const s = fs.readFileSync(`${dir}/${f}`, 'utf8')
  let idx = 0
  while (true) {
    const j = s.indexOf(marker, idx)
    if (j < 0) break
    console.log('--- in', f, 'at', j)
    console.log(s.slice(j, j + 3000))
    console.log('---end---')
    idx = j + 1
  }
}
