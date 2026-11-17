import { createWorld, PIP_ID } from '../../src/world/world.ts'
import { manifest, observe } from '../../src/world/seam.ts'
import { systemPrompt, whatISee } from '../../src/mind/prompt.ts'
import { PIP_SHEET } from '../../src/mind/sheet.ts'

test('the sheet gives temperament and no interests', () => {
  expect(PIP_SHEET.you).toBe('a seedling')
  expect(PIP_SHEET.traits).toContain('quick to attach')
  expect(PIP_SHEET.fears).toContain('an empty town')
})
test('only moves on offer are in the prompt', () => {
  const o = observe(createWorld(1), PIP_ID); const p = systemPrompt(manifest('origin'), o, PIP_SHEET)
  expect(p).toContain('You are Pip, a seedling')
  expect(p).toContain('Nobody tells you what to do with your day.')
  expect(p).toContain('- start_building'); expect(p).not.toContain('work_on')
  expect(p).toContain(o.available.find(a => a.name === 'start_building')!.params.site[0])
})
test('empty sections are left out', () => {
  const o = observe(createWorld(1), PIP_ID); const text = whatISee(o, [], [], [])
  expect(text).toContain('THE TIME: 06:00, day 1'); expect(text).not.toContain('YOU REMEMBER')
  expect(text.trimEnd().endsWith('JSON only.')).toBe(true)
})
