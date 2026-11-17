import { readDecision } from '../../src/mind/decision.ts'

test('a plain decision', () => {
  expect(readDecision('{"consider":"hungry","do":[{"action":"eat","params":{"target":"the berry bush"}}],"because":"food"}'))
    .toEqual({ consider: 'hungry', moves: [{ action: 'eat', params: { target: 'the berry bush' } }], because: 'food', remember: null })
})
test('fences, prose, extra moves and odd values are tolerated', () => {
  const d = readDecision('Sure!\n```json\n{"do":[{"action":"wait"},{"action":"speak","params":{"text":5}},{"action":"wait"},{"action":"wait"},{"nope":1}],"remember":{"text":"cold pond","kind":"fact"}}\n```')
  expect(d!.moves).toHaveLength(3); expect(d!.moves[1].params.text).toBe('5')
  expect(d!.remember).toEqual({ text: 'cold pond', kind: 'fact' })
})
test.each(['', 'I think I will eat.', '{"do":[]}', '{"do":"eat"}', '[1,2]'])('unreadable: %s', (t) => {
  expect(readDecision(t)).toBeNull()
})
