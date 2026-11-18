/** What the owner can do to the world. Each states a fact in the world's events; none speaks to anyone. */

import type { World } from '../shared/types.ts'
import { RAIN_WORDS, same } from './seam.ts'
import { addEvent } from './world.ts'

export type OwnerResult = { ok: boolean; message: string }

/** How long the owner's weather holds before it drifts again, in world minutes. */
export const WEATHER_HOLD_MINUTES = 180

const done = (world: World, message: string): OwnerResult => {
  addEvent(world, message)
  return { ok: true, message }
}

function building(world: World, name: string) {
  return world.buildings.find((b) => same(b.name, name))
}
const unknown = (world: World, name: string): OwnerResult => ({
  ok: false,
  message: `There is no building called "${name}". The buildings are: ${world.buildings.map((b) => b.name).join(', ') || 'none yet'}.`,
})

export function setWeather(world: World, weather: string): OwnerResult {
  const index = RAIN_WORDS.findIndex((words) => same(words, weather))
  if (index === -1) return { ok: false, message: `Choose one of: ${RAIN_WORDS.join(', ')}.` }
  world.rain = index as World['rain']
  world.weatherHeldUntil = world.minutes + WEATHER_HOLD_MINUTES
  return done(world, index === 0 ? 'The weather cleared.' : `The weather turned to ${RAIN_WORDS[index]}.`)
}

export function setClosed(world: World, name: string, closed: boolean): OwnerResult {
  const b = building(world, name)
  if (!b) return unknown(world, name)
  if (b.closed === closed) return { ok: true, message: `${b.name} is already ${closed ? 'closed' : 'open'}.` }
  b.closed = closed
  return done(world, closed ? `${b.name} was closed.` : `${b.name} opened again.`)
}

export function breakBuilding(world: World, name: string): OwnerResult {
  const b = building(world, name)
  if (!b) return unknown(world, name)
  if (b.workLeft > 0) return { ok: false, message: `${b.name} is not finished yet.` }
  b.repairLeft = Math.max(1, Math.ceil(b.workTotal / 3))
  return done(world, `${b.name} broke.`)
}
