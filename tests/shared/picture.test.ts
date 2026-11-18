import { MOODS, MOTIFS, paint } from '../../src/shared/picture.ts'

test('the same title, mood and description always make the same picture', () => {
  expect(paint('First Light', 'restless', 'the road at dawn')).toEqual(paint('First Light', 'restless', 'the road at dawn'))
  expect(paint('First Light', 'calm', 'the road at dawn')).not.toEqual(paint('First Light', 'restless', 'the road at dawn'))
  expect(paint('Other', 'restless', 'the road at dawn')).not.toEqual(paint('First Light', 'restless', 'the road at dawn'))
})
test('known words become motifs, at most four', () => {
  const kinds = paint('x', 'calm', 'A sun, a tree, a pond, a bird and the moon').map((s) => s.kind)
  expect(kinds.filter((k) => MOTIFS.includes(k))).toHaveLength(4)
  expect(paint('x', 'calm', 'Sunny days').map((s) => s.kind)).not.toContain('sun')     // whole words only
  expect(paint('x', 'calm', '').every((s) => !MOTIFS.includes(s.kind))).toBe(true)
  expect(paint('x', 'joyful', '').length).toBeGreaterThan(paint('x', 'lonely', '').length)
})
test('every mood paints inside the canvas', () => {
  for (const mood of MOODS) for (const s of paint('t', mood, 'a sun over the pond')) {
    expect(s.x).toBeGreaterThanOrEqual(0); expect(s.x).toBeLessThanOrEqual(100)
    expect(s.y).toBeGreaterThanOrEqual(0); expect(s.y).toBeLessThanOrEqual(100)
    expect(s.colour).toMatch(/^#[0-9a-f]{6}$/i)
  }
})
