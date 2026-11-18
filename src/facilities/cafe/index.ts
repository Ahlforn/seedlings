/** The internet café: look a topic up on Wikipedia, or read the day's featured article. No model calls. */

import { cleanText } from '../../shared/recipe.ts'
import type { Store } from '../../store/store.ts'
import { countUse, usesToday } from '../contract.ts'
import type { Facility, FacilityContext, FacilityOutcome } from '../contract.ts'
import { featured, lookUp } from './wikipedia.ts'
import type { Read } from './wikipedia.ts'

const DAILY_LOOKUPS = 30
const TOPIC_MAX = 60
const GIST_MAX = 150
const USE_KEY = 'cafe'
const BUSY = "the café's terminal is busy for the rest of the day"

const firstSentence = (words: string) => cleanText(/^.*?[.!?](\s|$)/.exec(words)?.[0] ?? words, GIST_MAX)

/** Reads, then records the lookup however it went. */
async function read(
  { world, c, building, services }: FacilityContext,
  kind: 'topic' | 'paper',
  words: string,
  fetch: () => Promise<Read | null>,
): Promise<{ read: Read | null; failed: boolean }> {
  let found: Read | null = null
  let failed = false
  try {
    found = await fetch()
  } catch (error) {
    failed = true
    console.error(`[seedlings] the café could not reach Wikipedia at ${building.name}:`, error instanceof Error ? error.message : error)
  }
  record(services.store, { characterId: c.id, realTs: services.now(), worldMinutes: world.minutes, kind, words, outcome: failed ? 'failed' : found ? 'found' : 'missing', title: found?.title ?? '' })
  countUse(world, USE_KEY)
  return { read: found, failed }
}
const record = (store: Store, lookup: Parameters<Store['addLookup']>[0]) => store.addLookup(lookup)

function finding(ctx: FacilityContext, found: Read, message: string): FacilityOutcome {
  return {
    ok: true, message, minutes: 30, moodDelta: 0.05, label: 'reading at the café',
    event: `${ctx.c.name} read about ${found.title} at ${ctx.building.name}`,
    leaves: [{ characterId: ctx.c.id, text: `I read about ${found.title} at the café: ${firstSentence(found.text)}`, kind: 'fact' }],
  }
}

const unreachable: FacilityOutcome = { ok: false, reason: "The café can't reach anything right now.", quiet: true }

export const CAFE: Facility = {
  kind: 'cafe',
  name: 'an internet café',
  about: 'somewhere to look things up and read about the world beyond the plot',
  look: { footprint: 2, floors: 1, wall: 'yellow', roof: 'flat', roofColour: 'brown', door: true, windows: 3, sign: 'CAFÉ', extras: ['awning'] },
  hours: { opens: 8, closes: 20 },
  moves: [
    {
      spec: {
        name: 'look_up', label: 'reading at the café', tier: 'inhabitant',
        description: 'Look something up at the café and read a little about it.',
        params: { topic: { hint: 'a few words' } },
      },
      offer: ({ world }) => (usesToday(world, USE_KEY) >= DAILY_LOOKUPS ? BUSY : {}),
      async perform(ctx, params) {
        const topic = cleanText(params.topic ?? '', TOPIC_MAX)
        if (topic === '') return { ok: false, reason: 'You need something to look up.' }
        const { read: found, failed } = await read(ctx, 'topic', topic, () => lookUp(ctx.services.fetchJson, topic))
        if (failed) return unreachable
        if (!found) return { ok: false, reason: `You look for ${topic} but find nothing about it.` }
        return finding(ctx, found, `You read about ${found.title}: ${found.text}`)
      },
    },
    {
      spec: {
        name: 'read_the_paper', label: 'reading the paper', tier: 'inhabitant',
        description: "Read the day's paper at the café: one article about the world beyond the plot.",
        params: {},
      },
      offer: ({ world }) => (usesToday(world, USE_KEY) >= DAILY_LOOKUPS ? BUSY : {}),
      async perform(ctx) {
        const { read: found, failed } = await read(ctx, 'paper', '', () => featured(ctx.services.fetchJson, new Date(ctx.services.now())))
        if (failed) return unreachable
        if (!found) return { ok: false, reason: 'There is no paper today.' }
        return finding(ctx, found, `You read the paper. Today it is about ${found.title}: ${found.text}`)
      },
    },
  ],
}
