/** The world itself: the plot, bodies, weather and the passing of time. Plain data, mutated in place. */

import type { Character, Tile, Urgency, World } from '../shared/types.ts'
import { START_MINUTES } from './clock.ts'

export const PIP_ID = 'pip'

const MAX_EVENTS = 50
const TREES = 6

// Per in-world hour.
const HUNGER_AWAKE = 0.06
const HUNGER_ASLEEP = 0.02
const TIRED_AWAKE = 0.05
const REST_ASLEEP = 0.12
const MOOD_KEEP = 0.9
const WAKE_AT = 0.05
const WAKE_MOOD = 0.1
const RAIN_CHANGE = 0.25

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Seeded random number in [0, 1). Advances world.rng, so a world replays identically. */
export function random(world: World): number {
  const a = (world.rng + 0x6d2b79f5) | 0
  world.rng = a
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function character(world: World, id: string): Character {
  const found = world.characters.find((c) => c.id === id)
  if (!found) throw new Error(`No character with id ${id}`)
  return found
}

export function addEvent(world: World, text: string): void {
  world.events.push({ minute: world.minutes, text })
  if (world.events.length > MAX_EVENTS) world.events.splice(0, world.events.length - MAX_EVENTS)
}

export function urgency(level: number): Urgency {
  if (level < 0.3) return 'satisfied'
  if (level < 0.6) return 'mild'
  if (level < 0.85) return 'strong'
  return 'urgent'
}

export function createWorld(seed: number): World {
  const world: World = {
    size: 24,
    seed,
    rng: seed | 0,
    minutes: START_MINUTES,
    rain: 0,
    features: [
      { id: 'f1', kind: 'berry_bush', name: 'the berry bush', at: { x: 8, y: 9 } },
      { id: 'f2', kind: 'hollow_tree', name: 'the hollow tree', at: { x: 14, y: 8 } },
      { id: 'f3', kind: 'pond', name: 'the pond', at: { x: 11, y: 15 } },
    ],
    buildings: [],
    characters: [],
    events: [],
    notes: [],
    populationLimit: 0,
    nextId: 4,
  }
  const start: Tile = { x: 12, y: 12 }
  const taken = new Set([...world.features.map((f) => `${f.at.x},${f.at.y}`), `${start.x},${start.y}`])
  while (world.features.length < 3 + TREES) {
    const at = { x: 1 + Math.floor(random(world) * (world.size - 2)), y: 1 + Math.floor(random(world) * (world.size - 2)) }
    const key = `${at.x},${at.y}`
    if (taken.has(key)) continue
    taken.add(key)
    world.features.push({ id: `f${world.nextId++}`, kind: 'tree', name: 'a tree', at })
  }
  world.characters.push({
    id: PIP_ID,
    name: 'Pip',
    tier: 'origin',
    at: start,
    body: { hunger: 0.2, tiredness: 0.1, mood: 0 },
    asleep: false,
    busyUntil: 0,
    doing: 'idle',
    said: '',
    saidAt: 0,
    queue: [],
    queueTurn: 0,
    homeId: null,
    look: null,
    sheet: null,
    heard: [],
  })
  return world
}

/** Fills in whatever a world saved by an older version lacks. Mutates and returns the same world. */
export function migrateWorld(world: World): World {
  world.notes ??= []
  world.populationLimit ??= 0
  for (const c of world.characters) {
    c.homeId ??= null
    c.look ??= null
    c.sheet ??= null
    c.heard ??= []
  }
  return world
}

function drift(world: World, c: Character, hours: number): void {
  const body = c.body
  if (c.asleep) {
    body.hunger = clamp(body.hunger + HUNGER_ASLEEP * hours, 0, 1)
    body.tiredness = clamp(body.tiredness - REST_ASLEEP * hours, 0, 1)
  } else {
    body.hunger = clamp(body.hunger + HUNGER_AWAKE * hours, 0, 1)
    body.tiredness = clamp(body.tiredness + TIRED_AWAKE * hours, 0, 1)
  }
  body.mood = clamp(body.mood * MOOD_KEEP ** hours, -1, 1)

  if (c.asleep && body.tiredness <= WAKE_AT) {
    c.asleep = false
    c.doing = 'idle'
    c.busyUntil = world.minutes
    body.mood = clamp(body.mood + WAKE_MOOD, -1, 1)
    addEvent(world, `${c.name} woke up`)
  } else if (!c.asleep && c.doing !== 'idle' && world.minutes >= c.busyUntil) {
    c.doing = 'idle'
  }
}

/** Moves the world forward. Mutates it. */
export function advance(world: World, minutes: number): void {
  let left = minutes
  while (left > 1e-9) {
    const dt = Math.min(1, left)
    const hourBefore = Math.floor(world.minutes / 60)
    world.minutes += dt
    left -= dt
    for (const c of world.characters) drift(world, c, dt / 60)
    if (Math.floor(world.minutes / 60) > hourBefore && random(world) < RAIN_CHANGE) {
      const step = random(world) < 0.5 ? -1 : 1
      world.rain = clamp(world.rain + step, 0, 3) as World['rain']
    }
  }
}
