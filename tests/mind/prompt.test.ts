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

test('who is around, what was heard and notes appear in the scene, and empty ones do not', () => {
  const o = { ...observe(createWorld(1), PIP_ID), home: 'Your home is Burrow.', people: ['Pip, a few steps away, building'], heard: ['Pip said to you: "Hi"'], notes: [] }
  const text = whatISee(o, [], [], [])
  expect(text).toContain('YOUR HOME: Your home is Burrow.'); expect(text).toContain('WHO IS AROUND:\n- Pip, a few steps away, building')
  expect(text).toContain('YOU HEARD:\n- Pip said to you: "Hi"'); expect(text).not.toContain('NOTES HERE')
  expect(text.indexOf('THE PLACE')).toBeLessThan(text.indexOf('YOUR HOME'))
  expect(text.indexOf('YOU HEARD')).toBeLessThan(text.indexOf('EARLIER') === -1 ? text.indexOf('YOUR BODY') : text.indexOf('EARLIER'))
  const quiet = whatISee(observe(createWorld(1), PIP_ID), [], [], [])
  expect(quiet).not.toContain('YOUR HOME'); expect(quiet).not.toContain('WHO IS AROUND'); expect(quiet).not.toContain('YOU HEARD')
  const noted = whatISee({ ...o, notes: ['A note at the pond from Pip: "Hi"'] }, [], [], [])
  expect(noted).toContain('NOTES HERE:\n- A note at the pond from Pip: "Hi"')
})
