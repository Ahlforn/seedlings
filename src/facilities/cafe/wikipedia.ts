/**
 * Reading from Wikipedia's public API. Needs no key. Answers that are not shaped as expected count as
 * nothing found; only an unreachable Wikipedia rejects, so the café can tell the two apart.
 */

import { cleanText } from '../../shared/recipe.ts'
import type { FacilityServices } from '../contract.ts'

export type Read = { title: string; text: string }

export const WIKI = 'https://en.wikipedia.org'
const TEXT_MAX = 600
const USER_AGENT = 'seedlings-town/0.1'

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** Cleaned, then cut at the last sentence end that fits; cut plainly when no sentence ends in time. */
export function trim(words: string, max = TEXT_MAX): string {
  const clean = cleanText(words, 100_000)
  if (clean.length <= max) return clean
  const head = clean.slice(0, max)
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), /[.!?]$/.test(head) ? head.length - 1 : -1)
  return end > 0 ? head.slice(0, end + 1) : head.trimEnd()
}

export function wikipediaUserAgent(contact: string): string {
  return contact ? `${USER_AGENT} (${contact})` : USER_AGENT
}

/** The best match for a topic, as a short summary. Null when nothing is found. */
export async function lookUp(fetchJson: FacilityServices['fetchJson'], topic: string): Promise<Read | null> {
  const found = record(await fetchJson(`${WIKI}/w/rest.php/v1/search/page?q=${encodeURIComponent(topic)}&limit=1`))
  const pages = Array.isArray(found?.pages) ? found.pages : []
  const key = text(record(pages[0])?.key)
  if (key === '') return null
  const summary = record(await fetchJson(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(key)}`))
  const title = text(summary?.title)
  const extract = trim(text(summary?.extract))
  return title && extract ? { title: cleanText(title, 100), text: extract } : null
}

/** The day's featured article. Wikipedia's days are real days, in UTC. */
export async function featured(fetchJson: FacilityServices['fetchJson'], date: Date): Promise<Read | null> {
  const two = (n: number) => String(n).padStart(2, '0')
  const path = `${date.getUTCFullYear()}/${two(date.getUTCMonth() + 1)}/${two(date.getUTCDate())}`
  const feed = record(await fetchJson(`${WIKI}/api/rest_v1/feed/featured/${path}`))
  const tfa = record(feed?.tfa)
  const title = text(record(tfa?.titles)?.normalized)
  const extract = trim(text(tfa?.extract))
  return title && extract ? { title: cleanText(title, 100), text: extract } : null
}
