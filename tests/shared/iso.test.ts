import { tileToScreen, screenToTile, buildingFaces, drawOrder } from '../../src/shared/iso.ts'

const O = { x: 400, y: 50 }
const b = (over = {}) => ({ id: 'b', name: 'n', purpose: 'home' as const, about: '', at: { x: 3, y: 4 }, workLeft: 0, workTotal: 3,
  startedDay: 1, facility: null, builtBy: 'origin' as const, closed: false, repairLeft: 0, recipe: { footprint: 1 as const, floors: 2 as const, wall: 'cream' as const, roof: 'pitched' as const,
    roofColour: 'red' as const, door: true, windows: 2 as const, sign: 'BREAD', extras: ['chimney' as const] }, ...over })

test('projection and its inverse', () => {
  expect(tileToScreen({ x: 0, y: 0 }, O)).toEqual(O)
  expect(tileToScreen({ x: 3, y: 1 }, O)).toEqual({ x: 464, y: 114 })
  for (const t of [{ x: 0, y: 0 }, { x: 5, y: 2 }, { x: 23, y: 23 }]) {
    const p = tileToScreen(t, O); expect(screenToTile({ x: p.x, y: p.y + 16 }, O)).toEqual(t)
  }
})
test('a finished building has every part', () => {
  const kinds = buildingFaces(b(), O).map(f => f.kind)
  expect(kinds.filter(k => k === 'wall-left')).toHaveLength(1)
  expect(kinds.filter(k => k === 'roof')).toHaveLength(2)
  expect(kinds.filter(k => k === 'window')).toHaveLength(2)
  expect(kinds).toContain('door'); expect(kinds).toContain('extra')
  expect(buildingFaces(b(), O).find(f => f.kind === 'sign')!.text).toBe('BREAD')
})
test('every roof shape and every extra can be drawn', () => {
  const roofs = { flat: 1, pitched: 2, pyramid: 2, dome: 1 } as const
  for (const [roof, count] of Object.entries(roofs)) {
    const faces = buildingFaces(b({ recipe: { ...b().recipe, roof, extras: ['chimney', 'awning', 'garden', 'lantern'] } }), O)
    expect(faces.filter(f => f.kind === 'roof')).toHaveLength(count)
    expect(faces.filter(f => f.kind === 'extra')).toHaveLength(4)
    for (const f of faces) for (const p of f.points) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true) }
  }
})
test('a building site is low walls and nothing else', () => {
  const faces = buildingFaces(b({ workLeft: 2 }), O)
  expect(faces.map(f => f.kind).sort()).toEqual(['wall-left', 'wall-right'])
  const height = (fs: typeof faces) => Math.max(...fs[0].points.map(p => p.y)) - Math.min(...fs[0].points.map(p => p.y))
  expect(height(faces)).toBeLessThan(height(buildingFaces(b(), O).filter(f => f.kind === 'wall-left')))
})
test('things further back are drawn first', () => {
  expect(drawOrder([{ at: { x: 5, y: 5 } }, { at: { x: 0, y: 1 } }, { at: { x: 1, y: 0 } }]).map(t => t.at.x + t.at.y)).toEqual([1, 1, 10])
})
