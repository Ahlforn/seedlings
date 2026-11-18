/**
 * Owner events: the owner shakes the world without speaking in it. Each event is checked, applied,
 * recorded and saved. The only one that asks a model is the stranger, whose sheet is written from
 * the owner's premise by the inhabitants' model.
 */

import { readJson, isRecord } from '../mind/decision.ts'
import { COLOURS, MARKS, cleanText } from '../shared/recipe.ts'
import type { Tile, World } from '../shared/types.ts'
import { breakBuilding, placeFacility, setClosed, setWeather } from '../world/owner.ts'
import { bringToLife } from '../world/seam.ts'
import { addEvent } from '../world/world.ts'
import type { TownDeps } from './turn.ts'

export type EventResult = { ok: boolean; message: string }

const PREMISE_MAX = 300
const ATTEMPTS = 2
const STRANGER = 'stranger'
const UNKNOWN: EventResult = { ok: false, message: 'That is not an event the town knows.' }

const words = (value: unknown): value is string => typeof value === 'string'

export function strangerPrompt(premise: string): { system: string; user: string } {
  return {
    system: `You write a character sheet for someone who has just arrived at a small town. The owner of the world gives you a line or two about who they are; you make them into a whole character.

Give them a temperament, values and fears, never hobbies or interests: what they come to care about here is up to them.

RESPOND WITH JSON ONLY, one object with exactly these keys:
{"name": "one or two words", "kind": "what sort of creature they are, a few words", "who": "who they are, a sentence or two", "traits": "two to four, separated by commas", "cares_about": "one to three things, separated by commas", "fears": "one to three things, separated by commas", "colour": "one of ${COLOURS.join(' | ')}", "mark": "one of ${MARKS.join(' | ')}"}`,
    user: `Who arrives: ${premise}\n\nJSON only.`,
  }
}

/** The sheet as strings, the shape create_inhabitant takes. Lists may come back as arrays. Null when unreadable. */
export function readStrangerSheet(text: string): Record<string, string> | null {
  const answer = readJson(text)
  if (!isRecord(answer)) return null
  const sheet: Record<string, string> = {}
  for (const [key, value] of Object.entries(answer)) {
    if (typeof value === 'string') sheet[key] = value
    else if (Array.isArray(value)) sheet[key] = value.filter(words).join(', ')
  }
  return sheet
}

/** The edge of the plot, halfway down its western side, moved in past anything standing there. */
function edgeOf(world: World): Tile {
  const y = Math.floor(world.size / 2)
  for (let x = 0; x < world.size; x++) {
    if (!world.features.some((f) => f.at.x === x && f.at.y === y)) return { x, y }
  }
  return { x: 0, y }
}

async function stranger(deps: TownDeps, input: Record<string, unknown>): Promise<EventResult> {
  const { world, model, budget, config } = deps
  const premise = cleanText(words(input.premise) ? input.premise : '', PREMISE_MAX)
  if (premise === '') return { ok: false, message: 'Write a line or two about who arrives.' }
  const living = world.characters.filter((c) => c.tier === 'inhabitant').length
  if (living >= world.populationLimit) return { ok: false, message: 'The town cannot support anyone more yet.' }
  // The inhabitants' own share is empty until someone lives here, so the town's share decides.
  if (!budget.status('town').canThink) return { ok: false, message: 'The town has no thinking left today.' }

  const prompt = strangerPrompt(premise)
  let reason = 'the answer could not be read'
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0 && !budget.status('town').canThink) break
    const reply = await model.complete({
      model: config.inhabitantModel, system: prompt.system, user: prompt.user, sessionId: STRANGER,
      maxTokens: config.maxTokens, reasoningEffort: config.reasoningEffort,
    })
    budget.record(STRANGER, reply.usage)
    if (reply.finishReason === 'length') {
      reason = 'the answer was cut off'
      continue
    }
    const sheet = readStrangerSheet(reply.text)
    if (!sheet) {
      reason = 'the answer could not be read'
      continue
    }
    const born = bringToLife(world, sheet, { at: edgeOf(world), homeId: null })
    if (!born.ok) {
      reason = born.reason
      continue
    }
    addEvent(world, `A stranger called ${born.character.name} arrived at the edge of the plot.`)
    return { ok: true, message: `${born.character.name} has arrived.` }
  }
  return { ok: false, message: `The stranger could not be written: ${reason.replace(/\.$/, '')}.` }
}

async function apply(deps: TownDeps, input: unknown): Promise<EventResult> {
  if (!isRecord(input)) return UNKNOWN
  const { world } = deps
  switch (input.kind) {
    case 'weather':
      return words(input.weather) ? setWeather(world, input.weather) : UNKNOWN
    case 'close':
      return words(input.building) && typeof input.closed === 'boolean' ? setClosed(world, input.building, input.closed) : UNKNOWN
    case 'break':
      return words(input.building) ? breakBuilding(world, input.building) : UNKNOWN
    case 'facility':
      return words(input.facility) && words(input.site) && (input.name === undefined || words(input.name))
        ? placeFacility(world, input.facility, input.site, input.name ?? '')
        : UNKNOWN
    case 'stranger':
      return stranger(deps, input)
    default:
      return UNKNOWN
  }
}

/** Applies one event from the owner, records it, and saves the world. Never throws for anything sent. */
export async function applyEvent(deps: TownDeps, input: unknown): Promise<EventResult> {
  let result: EventResult
  try {
    result = await apply(deps, input)
  } catch (error) {
    result = { ok: false, message: `That did not work: ${error instanceof Error ? error.message : String(error)}` }
  }
  const kind = isRecord(input) && words(input.kind) ? cleanText(input.kind, 30) : '?'
  deps.store.addOwnerEvent({ kind, settings: JSON.stringify(input ?? null).slice(0, 1000), realTs: deps.now(), ok: result.ok, message: result.message })
  if (result.ok) deps.store.saveWorld(deps.world)
  return result
}
