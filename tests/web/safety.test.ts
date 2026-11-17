import { readdirSync, readFileSync } from 'node:fs'

// Review Focus 5: text written by a model must never be inserted into the page as HTML.
test('the page never inserts text as HTML', () => {
  const files = readdirSync('web').filter(n => n.endsWith('.ts'))
  expect(files.length).toBeGreaterThan(0)
  for (const f of files) {
    expect(readFileSync(`web/${f}`, 'utf8')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
  }
})
