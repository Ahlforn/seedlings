/** A stand-in Wikipedia for fake runs and tests: every topic is found except ones mentioning "nothing". */

import type { FacilityServices } from '../contract.ts'

export function fakeWikipedia(): FacilityServices['fetchJson'] {
  return async (url) => {
    const search = /search\/page\?q=([^&]*)/.exec(url)
    if (search) {
      const topic = decodeURIComponent(search[1])
      return topic.includes('nothing') ? { pages: [] } : { pages: [{ key: topic.replace(/\s+/g, '_') }] }
    }
    const summary = /page\/summary\/(.+)$/.exec(url)
    if (summary) {
      const title = decodeURIComponent(summary[1]).replace(/_/g, ' ')
      return { title, extract: `${title} is something people have written a great deal about. Most of it is true.` }
    }
    if (url.includes('feed/featured')) return { tfa: { titles: { normalized: 'Lighthouses' }, extract: 'A lighthouse is a tower with a light that guides ships at night.' } }
    throw new Error(`${url} answered 404`)
  }
}
