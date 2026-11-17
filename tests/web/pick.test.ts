import { characterAt, originFor } from '../../web/draw.ts'
import { tileToScreen } from '../../src/shared/iso.ts'
import type { StateView } from '../../src/shared/types.ts'

const person = (id: string, name: string, x: number, y: number, tier: 'origin' | 'inhabitant') => ({
  id, name, tier, look: tier === 'origin' ? null : { colour: 'blue' as const, mark: 'ears' as const }, home: '', at: { x, y },
  asleep: false, doing: 'idle', said: '', mood: 0, thought: '', onMind: [] })
const state: StateView = {
  clock: '06:00, day 1', day: 1, night: false, weather: 'dry', size: 24, features: [], buildings: [], notes: [], events: [],
  population: { count: 1, limit: 1 }, budget: { leftToday: 1, canThink: true, reason: 'thinking', trouble: '' },
  characters: [person('pip', 'Pip', 12, 12, 'origin'), person('c4', 'Mo', 14, 12, 'inhabitant')],
}

test('clicking on an inhabitant picks it, Pip picks Pip, and empty grass picks nobody', () => {
  const origin = originFor(state, 800, 600)
  const mo = tileToScreen({ x: 14.5, y: 12.5 }, origin)
  const pip = tileToScreen({ x: 12.5, y: 12.5 }, origin)
  expect(characterAt(state, { x: mo.x, y: mo.y - 10 }, 800, 600)).toBe('c4')
  expect(characterAt(state, { x: pip.x, y: pip.y - 15 }, 800, 600)).toBe('pip')
  expect(characterAt(state, { x: mo.x + 300, y: mo.y }, 800, 600)).toBeNull()
})
