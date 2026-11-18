import { featured, lookUp, trim, wikipediaUserAgent } from '../../src/facilities/cafe/wikipedia.ts'
import { stub } from './stub.ts'

test('a topic is searched, then its summary read and trimmed at a sentence', async () => {
  const fetchJson = stub({ 'search/page?q=moths&limit=1': { pages: [{ key: 'Moth' }] }, 'page/summary/Moth': { title: 'Moth', extract: 'Moths are insects. '.repeat(60) } })
  const read = await lookUp(fetchJson, 'moths')
  expect(read!.title).toBe('Moth'); expect(read!.text.length).toBeLessThanOrEqual(600); expect(read!.text.endsWith('.')).toBe(true)
  expect(fetchJson.asked[0]).toBe('https://en.wikipedia.org/w/rest.php/v1/search/page?q=moths&limit=1')
})
test('nothing found is null, and an odd answer is nothing found too', async () => {
  expect(await lookUp(stub({ 'search/page': { pages: [] } }), 'glowing snails')).toBeNull()
  expect(await lookUp(stub({ 'search/page': { nope: 1 } }), 'x')).toBeNull()
  expect(await lookUp(stub({ 'search/page': { pages: [{ key: 'X' }] }, 'page/summary/X': { title: 'X' } }), 'x')).toBeNull()
})
test('an unreachable Wikipedia rejects, so the café can tell it apart from nothing found', async () => {
  await expect(lookUp(stub({ 'search/page': new Error('timeout') }), 'x')).rejects.toThrow('timeout')
})
test('featured uses the real date', async () => {
  const fetchJson = stub({ 'feed/featured/2026/11/18': { tfa: { titles: { normalized: 'Lighthouse' }, extract: 'A lighthouse is a tower. It has a light.' } } })
  expect(await featured(fetchJson, new Date(Date.UTC(2026, 10, 18, 9)))).toEqual({ title: 'Lighthouse', text: 'A lighthouse is a tower. It has a light.' })
  expect(await featured(stub({ 'feed/featured': {} }), new Date(Date.UTC(2026, 10, 18)))).toBeNull()
})
test('trimming cleans the text and cuts at a sentence end', () => {
  expect(trim('One.\u0000 Two. Three.', 10)).toBe('One. Two.')
  expect(trim('No sentence end here at all', 10).length).toBeLessThanOrEqual(10)
})
test('the user agent carries a contact only when one is set', () => {
  expect(wikipediaUserAgent('')).toBe('seedlings-town/0.1')
  expect(wikipediaUserAgent('me@x.org')).toBe('seedlings-town/0.1 (me@x.org)')
})
