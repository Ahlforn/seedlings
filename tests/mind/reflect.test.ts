import { readReflection, shouldReflect, reflectionPrompt } from '../../src/mind/reflect.ts'
import { PIP_SHEET } from '../../src/mind/sheet.ts'

test('when to reflect', () => {
  const base = { minutesSinceLast: 0, turnsSinceLast: 0, buildingFinished: false, goingToSleep: false, everyFewHours: true }
  expect(shouldReflect(base)).toBe(false)
  expect(shouldReflect({ ...base, goingToSleep: true, turnsSinceLast: 1 })).toBe(true)
  expect(shouldReflect({ ...base, buildingFinished: true })).toBe(true)
  expect(shouldReflect({ ...base, minutesSinceLast: 240, turnsSinceLast: 3 })).toBe(true)
  expect(shouldReflect({ ...base, minutesSinceLast: 240, turnsSinceLast: 2 })).toBe(false)
})
test('a reflection is read leniently and capped', () => {
  const r = readReflection('{"diary":"Built a wall.","memories":[{"text":"a","kind":"work"},{"text":"b","kind":"nonsense"},{"text":"c","kind":"fact"},{"text":"d","kind":"fact"},{"text":"e","kind":"fact"}],"mind":[{"kind":"want","text":"a door"}],"done":[4,"x"]}')
  expect(r).toEqual({ diary: 'Built a wall.', memories: [{ text: 'a', kind: 'work' }, { text: 'c', kind: 'fact' }, { text: 'd', kind: 'fact' }],
    mind: [{ kind: 'want', text: 'a door' }], done: [4] })
  expect(readReflection('{"diary":""}')).toBeNull()
})
test('the reflection prompt shows each turn and the open items with their ids', () => {
  const turn = { id: 1, characterId: 'pip', kind: 'turn' as const, realTs: 0, worldMinutes: 630, observation: '{}', systemPrompt: '',
    userPrompt: '', rawReply: '', model: 'm', allowance: 0, inputTokens: 0, outputTokens: 0,
    decision: JSON.stringify({ consider: 'peckish', moves: [{ action: 'eat', params: {} }], because: 'food', remember: null }),
    results: JSON.stringify([{ success: true, message: 'You eat until you are full.', moodDelta: 0.2, minutes: 20, label: 'eating at the berry bush' }]) }
  const p = reflectionPrompt(PIP_SHEET, '12:00, day 1', [turn], [{ id: 7, characterId: 'pip', kind: 'want', text: 'a roof', sinceMinutes: 0 }], false)
  expect(p.system).toContain('You are Pip, a seedling')
  expect(p.user).toContain('10:30, day 1'); expect(p.user).toContain('peckish')
  expect(p.user).toContain('eating at the berry bush'); expect(p.user).toContain('You eat until you are full.')
  expect(p.user).toContain('[7] want: a roof')
})

test('an inhabitant writes only at the end of the day', () => {
  expect(shouldReflect({ minutesSinceLast: 600, turnsSinceLast: 9, buildingFinished: true, goingToSleep: false, everyFewHours: false })).toBe(false)
  expect(shouldReflect({ minutesSinceLast: 10, turnsSinceLast: 1, buildingFinished: false, goingToSleep: true, everyFewHours: false })).toBe(true)
  expect(shouldReflect({ minutesSinceLast: 10, turnsSinceLast: 0, buildingFinished: false, goingToSleep: true, everyFewHours: false })).toBe(false)
})
