import type { Facility } from '../../src/facilities/contract.ts'

/** A test facility: a bench with one move for anyone and one for Pip that always throws. */
export const BENCH: Facility = {
  kind: 'bench', name: 'a bench', about: 'somewhere to sit',
  look: { footprint: 1, floors: 1, wall: 'brown', roof: 'flat', roofColour: 'brown', door: false, windows: 0, sign: '', extras: [] },
  hours: { opens: 8, closes: 20 },
  moves: [
    {
      spec: { name: 'sit', label: 'sitting on the bench', tier: 'inhabitant', description: 'Sit on the bench for a while.', params: {} },
      offer: () => ({}),
      perform: async ({ c }) => ({ ok: true, message: 'You sit on the bench.', minutes: 20, moodDelta: 0.05, label: 'sitting on the bench', event: `${c.name} sat on the bench` }),
    },
    {
      spec: { name: 'wish', label: 'making a wish', tier: 'origin', description: 'Make a wish on the bench.', params: {} },
      offer: () => ({}),
      perform: async () => { throw new Error('wishes are not implemented') },
    },
  ],
  observe: () => ['The bench is warm from the sun.'],
}
