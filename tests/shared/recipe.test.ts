import { validateRecipe, workUnits, cleanText } from '../../src/shared/recipe.ts'

test('defaults make a small cream house with a red pitched roof', () => {
  const r = validateRecipe({})
  expect(r).toEqual({ ok: true, recipe: { footprint: 1, floors: 1, wall: 'cream', roof: 'pitched',
    roofColour: 'red', door: true, windows: 1, sign: '', extras: [] } })
})
test('a full recipe is read', () => {
  const r = validateRecipe({ footprint: '2', floors: '3', wall: 'blue', roof: 'dome', roof_colour: 'grey',
    windows: '3', sign: 'BREAD', extras: 'chimney, garden' })
  expect(r.ok && r.recipe).toMatchObject({ footprint: 2, floors: 3, roof: 'dome', extras: ['chimney', 'garden'] })
})
test('a bad value is refused in words that list the choices', () => {
  const r = validateRecipe({ roof: 'thatched' })
  expect(r.ok).toBe(false)
  expect(!r.ok && r.reason).toContain('thatched')
  expect(!r.ok && r.reason).toContain('pitched')
})
test('sign text is cut and cleaned', () => {
  const r = validateRecipe({ sign: 'A VERY LONG SIGN INDEED\n\u0000' })
  expect(r.ok && r.recipe.sign).toBe('A VERY LONG SIGN')
})
test('bigger buildings take more work', () => {
  const small = validateRecipe({}); const big = validateRecipe({ footprint: '3', floors: '3' })
  expect(small.ok && workUnits(small.recipe)).toBe(2)
  expect(big.ok && workUnits(big.recipe)).toBe(10)
})
test('cleanText', () => { expect(cleanText('  hi\tthere\u0007 ', 5)).toBe('hi th') })
