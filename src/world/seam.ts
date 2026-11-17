/**
 * The seam between the world and a mind. A mind only ever gets a manifest (what this world is and
 * every move it has), an observation (what is true right now), and the result of an act.
 * One table of moves drives all three, so they cannot drift apart.
 */

import { COLOURS, EXTRAS, PURPOSES, ROOFS, cleanText, validateRecipe, workUnits } from '../shared/recipe.ts'
import type { Act, Building, Character, Purpose, Tile, Urgency, World } from '../shared/types.ts'
import { clockOf } from './clock.ts'
import { candidateSites } from './sites.ts'
import { addEvent, character, clamp, random, urgency } from './world.ts'

export type { Act } from '../shared/types.ts'

export type ParamSpec = { values?: string[]; hint?: string; role?: 'words' }
export type MoveSpec = {
  name: string
  label: string
  description: string
  params: Record<string, ParamSpec>
  tier: 'origin' | 'inhabitant'
}
export type Manifest = {
  protocol: 'seedlings/1'
  name: string
  description: string
  glossary: string[]
  stance: string
  moves: MoveSpec[]
}
export type Observation = {
  self: {
    name: string
    doing: string
    asleep: boolean
    mood: number
    needs: { hunger: { level: number; urgency: Urgency }; rest: { level: number; urgency: Urgency } }
  }
  clock: string
  environment: string
  room: string
  body: string
  /** newest 8, oldest first */
  recentEvents: string[]
  /** moves on offer, with the choices that are true right now */
  available: { name: string; params: Record<string, string[]> }[]
  /** moves not on offer, each as "name: reason" */
  cannot: string[]
}
export type ActResult = { success: boolean; message: string; moodDelta: number; minutes: number; label: string }

const WALK_MINUTES_PER_TILE = 3
const WANDER_REACH = 5
const MAX_SITES_UNFINISHED = 2
const REFUSAL_MOOD = -0.05
const RAIN_WORDS = ['dry', 'a thin rain', 'raining hard', 'a storm']
const RECENT_EVENTS = 8
const NAME_MAX = 30
const ABOUT_MAX = 80
const SPEECH_MAX = 200

type Thing = { name: string; at: Tile; describe: string; look: string }
type Offer = { ok: true; params: Record<string, string[]> } | { ok: false; reason: string }
type Done = { message: string; moodDelta: number; minutes: number; label: string; event: string }
type Outcome = { ok: true; done: Done } | { ok: false; reason: string; label?: string }
type MoveDef = {
  spec: MoveSpec
  offer(world: World, c: Character): Offer
  perform(world: World, c: Character, params: Record<string, string>): Outcome
}

const distance = (a: Tile, b: Tile) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const finished = (b: Building) => b.workLeft === 0

const PURPOSE_WORDS: Record<Purpose, string> = { home: 'a home', food: 'a place to eat', other: 'a building' }
const FEATURE_LOOKS: Record<string, string> = {
  berry_bush: 'A low bush heavy with dark berries. There are always a few more than you remember.',
  hollow_tree: 'An old tree with a hollow at its foot, dry inside and just big enough to curl up in.',
  pond: 'Still water with the sky in it. Something small moves under the surface.',
  tree: 'A tree. It was here before you were.',
}

/** Everything a character can name as a target. Trees share a name; the nearest one stands for all. */
function things(world: World, from: Tile): Thing[] {
  const list: Thing[] = []
  const byDistance = [...world.features].sort((a, b) => distance(a.at, from) - distance(b.at, from))
  for (const f of byDistance) {
    if (list.some((t) => t.name === f.name)) continue
    list.push({ name: f.name, at: f.at, describe: f.name, look: FEATURE_LOOKS[f.kind] })
  }
  for (const b of world.buildings) {
    const what = b.about || PURPOSE_WORDS[b.purpose]
    list.push({
      name: b.name,
      at: b.at,
      describe: finished(b) ? `${b.name} (${what})` : `the building site for ${b.name}`,
      look: finished(b)
        ? `${b.name}: ${what}. You built it.`
        : `The building site for ${b.name}. ${b.workLeft} of ${b.workTotal} parts of the work are still to do.`,
    })
  }
  return list.sort((a, b) => distance(a.at, from) - distance(b.at, from))
}

function away(tiles: number): string {
  if (tiles <= 1) return "in arm's reach"
  if (tiles <= 3) return 'a few steps away'
  if (tiles <= 7) return 'a short walk away'
  if (tiles <= 14) return 'a walk away'
  return 'across the plot'
}

/** Walks the character to a tile and says how long it took. */
function walk(c: Character, to: Tile): number {
  const minutes = distance(c.at, to) * WALK_MINUTES_PER_TILE
  c.at = { x: to.x, y: to.y }
  return minutes
}

function find<T extends { name: string }>(list: T[], name: string | undefined): T | undefined {
  return name === undefined ? undefined : list.find((item) => same(item.name, name))
}

function uniqueBuildingName(world: World, wanted: string, purpose: Purpose): string {
  const base = wanted || { home: 'the new home', food: 'the new food place', other: 'the new building' }[purpose]
  let name = base
  for (let n = 2; world.buildings.some((b) => same(b.name, name)) || world.features.some((f) => same(f.name, name)); n++) {
    name = `${base} ${n}`
  }
  return name
}

const foodSpots = (world: World, c: Character) =>
  things(world, c.at).filter(
    (t) => world.features.some((f) => f.kind === 'berry_bush' && f.name === t.name) ||
      world.buildings.some((b) => b.name === t.name && finished(b) && b.purpose === 'food'),
  )
const sleepSpots = (world: World, c: Character) =>
  things(world, c.at).filter(
    (t) => world.features.some((f) => f.kind === 'hollow_tree' && f.name === t.name) ||
      world.buildings.some((b) => b.name === t.name && finished(b) && b.purpose === 'home'),
  )

const MOVES: MoveDef[] = [
  {
    spec: {
      name: 'move_to', label: 'walking somewhere', tier: 'inhabitant',
      description: 'Walk to a place or thing, or wander with nowhere in mind.',
      params: { target: { hint: 'wander, or a place from the list' } },
    },
    offer: (world, c) => ({ ok: true, params: { target: ['wander', ...things(world, c.at).map((t) => t.name)] } }),
    perform(world, c, params) {
      if (same(params.target ?? '', 'wander')) {
        const to = {
          x: clamp(c.at.x + Math.round((random(world) * 2 - 1) * WANDER_REACH), 0, world.size - 1),
          y: clamp(c.at.y + Math.round((random(world) * 2 - 1) * WANDER_REACH), 0, world.size - 1),
        }
        const minutes = Math.max(walk(c, to), WALK_MINUTES_PER_TILE)
        return { ok: true, done: { message: 'You wander a little way and stop somewhere new.', moodDelta: 0, minutes, label: 'wandering', event: `${c.name} wandered about` } }
      }
      const thing = find(things(world, c.at), params.target)!
      const minutes = walk(c, thing.at)
      return { ok: true, done: { message: `You walk to ${thing.name}.`, moodDelta: 0, minutes, label: `walking to ${thing.name}`, event: `${c.name} walked to ${thing.name}` } }
    },
  },
  {
    spec: {
      name: 'eat', label: 'eating', tier: 'inhabitant',
      description: 'Eat at a place that has food. You walk there first if you need to.',
      params: { target: { hint: 'a place to eat from the list' } },
    },
    offer(world, c) {
      if (c.body.hunger < 0.15) return { ok: false, reason: 'you are not hungry' }
      return { ok: true, params: { target: foodSpots(world, c).map((t) => t.name) } }
    },
    perform(world, c, params) {
      const spot = find(foodSpots(world, c), params.target)!
      const minutes = walk(c, spot.at) + 20
      const moodDelta = c.body.hunger >= 0.6 ? 0.2 : 0.05
      c.body.hunger = 0.05
      return { ok: true, done: { message: `You eat at ${spot.name} until you are full.`, moodDelta, minutes, label: `eating at ${spot.name}`, event: `${c.name} ate at ${spot.name}` } }
    },
  },
  {
    spec: {
      name: 'sleep', label: 'sleeping', tier: 'inhabitant',
      description: 'Go to sleep somewhere sheltered. You wake when you are rested.',
      params: { target: { hint: 'a place to sleep from the list' } },
    },
    offer(world, c) {
      if (c.body.tiredness < 0.3 && !clockOf(world.minutes).night) return { ok: false, reason: 'you are not tired and it is not night' }
      return { ok: true, params: { target: sleepSpots(world, c).map((t) => t.name) } }
    },
    perform(world, c, params) {
      const spot = find(sleepSpots(world, c), params.target)!
      const minutes = walk(c, spot.at)
      c.asleep = true
      return { ok: true, done: { message: `You settle down at ${spot.name} and fall asleep.`, moodDelta: 0, minutes, label: `sleeping at ${spot.name}`, event: `${c.name} went to sleep at ${spot.name}` } }
    },
  },
  {
    spec: {
      name: 'look_at', label: 'looking closely at something', tier: 'inhabitant',
      description: 'Go and look closely at a place or thing.',
      params: { target: { hint: 'a place or thing from the list' } },
    },
    offer: (world, c) => ({ ok: true, params: { target: things(world, c.at).map((t) => t.name) } }),
    perform(world, c, params) {
      const thing = find(things(world, c.at), params.target)!
      const minutes = walk(c, thing.at) + 5
      return { ok: true, done: { message: thing.look, moodDelta: 0, minutes, label: `looking at ${thing.name}`, event: `${c.name} looked closely at ${thing.name}` } }
    },
  },
  {
    spec: {
      name: 'start_building', label: 'starting a building', tier: 'origin',
      description: 'Mark out a new building and decide what it will be. It then needs work before it is finished.',
      params: {
        site: { hint: 'where it goes, from the list' },
        purpose: { values: PURPOSES, hint: 'home is somewhere to sleep, food is somewhere to eat, other is anything else' },
        name: { hint: 'what you call it, a few words' },
        about: { hint: 'what it is for, in your own words' },
        footprint: { values: ['1', '2', '3'], hint: 'how wide, in plots' },
        floors: { values: ['1', '2', '3'] },
        wall: { values: COLOURS },
        roof: { values: ROOFS },
        roof_colour: { values: COLOURS },
        windows: { values: ['0', '1', '2', '3'] },
        sign: { hint: 'a word or two painted on the front, or leave it out' },
        extras: { hint: `any of ${EXTRAS.join(', ')}, separated by commas, or leave it out` },
      },
    },
    offer(world) {
      if (world.buildings.filter((b) => !finished(b)).length >= MAX_SITES_UNFINISHED) {
        return { ok: false, reason: 'you already have two unfinished buildings' }
      }
      const sites = candidateSites(world)
      if (sites.length === 0) return { ok: false, reason: 'there is no room left to build' }
      return { ok: true, params: { site: sites.map((s) => s.name) } }
    },
    perform(world, c, params) {
      const site = find(candidateSites(world), params.site)!
      const purpose = PURPOSES.find((p) => same(p, params.purpose ?? 'other'))
      if (!purpose) return { ok: false, reason: `"${cleanText(params.purpose, 30)}" is not a purpose. Choose one of: ${PURPOSES.join(', ')}.` }
      const checked = validateRecipe(params)
      if (!checked.ok) return { ok: false, reason: checked.reason }
      if (checked.recipe.footprint > site.maxFootprint) {
        return { ok: false, reason: `There is only room for a footprint of ${site.maxFootprint} at ${site.name}.` }
      }
      const name = uniqueBuildingName(world, cleanText(params.name ?? '', NAME_MAX), purpose)
      const minutes = walk(c, site.at) + 30
      const work = workUnits(checked.recipe)
      world.buildings.push({
        id: `b${world.nextId++}`, name, purpose, about: cleanText(params.about ?? '', ABOUT_MAX),
        recipe: checked.recipe, at: { x: site.at.x, y: site.at.y }, workLeft: work, workTotal: work,
        startedDay: clockOf(world.minutes).day,
      })
      return { ok: true, done: { message: `You mark out the ground for ${name}. It needs ${work} spells of work before it is finished.`, moodDelta: 0, minutes, label: `starting ${name}`, event: `${c.name} marked out a building site for ${name}` } }
    },
  },
  {
    spec: {
      name: 'work_on', label: 'building', tier: 'origin',
      description: 'Put an hour of work into a building you have started.',
      params: { target: { hint: 'an unfinished building from the list' } },
    },
    offer(world) {
      const sites = world.buildings.filter((b) => !finished(b))
      if (sites.length === 0) return { ok: false, reason: 'there is no unfinished building' }
      return { ok: true, params: { target: sites.map((b) => b.name) } }
    },
    perform(world, c, params) {
      const building = find(world.buildings.filter((b) => !finished(b)), params.target)!
      const minutes = walk(c, building.at) + 60
      building.workLeft -= 1
      const label = `working on ${building.name}`
      if (finished(building)) {
        return { ok: true, done: { message: `You finish ${building.name}. It stands.`, moodDelta: 0.3, minutes, label, event: `${c.name} finished building ${building.name}` } }
      }
      return { ok: true, done: { message: `You work on ${building.name}. ${building.workLeft} more to go.`, moodDelta: 0.03, minutes, label, event: `${c.name} worked on ${building.name}` } }
    },
  },
  {
    spec: {
      name: 'change_building', label: 'changing a building', tier: 'origin',
      description: 'Change how a finished building looks. Anything you leave out stays as it is.',
      params: {
        target: { hint: 'a finished building from the list' },
        wall: { values: COLOURS },
        roof: { values: ROOFS },
        roof_colour: { values: COLOURS },
        sign: { hint: 'a word or two painted on the front' },
      },
    },
    offer(world) {
      const done = world.buildings.filter(finished)
      if (done.length === 0) return { ok: false, reason: 'there is no finished building' }
      return { ok: true, params: { target: done.map((b) => b.name) } }
    },
    perform(world, c, params) {
      const building = find(world.buildings.filter(finished), params.target)!
      const changes: Record<string, string> = {}
      for (const key of ['wall', 'roof', 'roof_colour', 'sign']) if (params[key] !== undefined) changes[key] = params[key]
      const checked = validateRecipe(changes, building.recipe)
      if (!checked.ok) return { ok: false, reason: checked.reason }
      const minutes = walk(c, building.at) + 30
      building.recipe = checked.recipe
      return { ok: true, done: { message: `You change ${building.name}. It looks different now.`, moodDelta: 0, minutes, label: `changing ${building.name}`, event: `${c.name} changed how ${building.name} looks` } }
    },
  },
  {
    spec: {
      name: 'pull_down', label: 'pulling a building down', tier: 'origin',
      description: 'Pull down a building, finished or not. It is gone for good.',
      params: { target: { hint: 'a building from the list' } },
    },
    offer(world) {
      if (world.buildings.length === 0) return { ok: false, reason: 'there is no building' }
      return { ok: true, params: { target: world.buildings.map((b) => b.name) } }
    },
    perform(world, c, params) {
      const building = find(world.buildings, params.target)!
      const minutes = walk(c, building.at) + 45
      world.buildings = world.buildings.filter((b) => b !== building)
      return { ok: true, done: { message: `You pull down ${building.name}. The ground is bare again.`, moodDelta: 0, minutes, label: `pulling down ${building.name}`, event: `${c.name} pulled down ${building.name}` } }
    },
  },
  {
    spec: {
      name: 'speak', label: 'saying something out loud', tier: 'inhabitant',
      description: 'Say something out loud, to nobody in particular or to whoever is near.',
      params: { text: { role: 'words', hint: 'what you say' } },
    },
    offer: () => ({ ok: true, params: {} }),
    perform(world, c, params) {
      const text = cleanText(params.text ?? '', SPEECH_MAX)
      if (text === '') return { ok: false, reason: 'You open your mouth but have nothing to say.' }
      c.said = text
      c.saidAt = world.minutes
      return { ok: true, done: { message: `You say: "${text}"`, moodDelta: 0, minutes: 2, label: 'saying something out loud', event: `${c.name} said: "${text}"` } }
    },
  },
  {
    spec: {
      name: 'wait', label: 'staying still', tier: 'inhabitant',
      description: 'Stay where you are for a little while and do nothing in particular.',
      params: {},
    },
    offer: () => ({ ok: true, params: {} }),
    perform: (_world, c) => ({ ok: true, done: { message: 'You stay where you are for a while.', moodDelta: 0, minutes: 15, label: 'staying still', event: `${c.name} stayed still for a while` } }),
  },
]

export function manifest(): Manifest {
  return {
    protocol: 'seedlings/1',
    name: 'the plot',
    description:
      'A wide green plot of land. It was empty when you arrived: a berry bush, a hollow tree, a pond and a few trees. Anything else here, you built.',
    glossary: [
      'a building site is a building you have started and not finished',
      'a home is somewhere to sleep, and a food place is somewhere to eat',
      'the hollow tree is where you can sleep until there is a home',
    ],
    stance: 'Nobody tells you what to do with your day.',
    moves: MOVES.map((move) => move.spec),
  }
}

function tierAllows(c: Character, move: MoveDef): boolean {
  return move.spec.tier === 'inhabitant' || c.tier === 'origin'
}

export function observe(world: World, characterId: string): Observation {
  const c = character(world, characterId)
  const clock = clockOf(world.minutes)
  const hunger = urgency(c.body.hunger)
  const rest = urgency(c.body.tiredness)

  const available: Observation['available'] = []
  const cannot: string[] = []
  for (const move of MOVES) {
    if (!tierAllows(c, move)) continue
    const offer = move.offer(world, c)
    if (offer.ok) available.push({ name: move.spec.name, params: offer.params })
    else cannot.push(`${move.spec.name}: ${offer.reason}`)
  }

  const around = things(world, c.at).map((t) => ({ text: t.describe, tiles: distance(t.at, c.at) }))
  const near = around.filter((t) => t.tiles <= 1).map((t) => t.text)
  const far = around.filter((t) => t.tiles > 1).map((t) => `${t.text}, ${away(t.tiles)}`)
  const room = `Places and things: ${far.join('; ') || 'nothing further off'}. In arm's reach: ${near.join(', ') || 'nothing'}.`

  const needs: string[] = []
  if (hunger !== 'satisfied') needs.push(`hunger ${hunger}`)
  if (rest !== 'satisfied') needs.push(`rest ${rest}`)

  return {
    self: {
      name: c.name,
      doing: c.doing,
      asleep: c.asleep,
      mood: c.body.mood,
      needs: { hunger: { level: c.body.hunger, urgency: hunger }, rest: { level: c.body.tiredness, urgency: rest } },
    },
    clock: clock.label,
    environment: `${clock.partOfDay}, ${RAIN_WORDS[world.rain]}.`,
    room,
    body: needs.join(', ') || 'comfortable',
    recentEvents: world.events.slice(-RECENT_EVENTS).map((e) => e.text),
    available,
    cannot,
  }
}

function refuse(world: World, c: Character, message: string, label: string): ActResult {
  c.body.mood = clamp(c.body.mood + REFUSAL_MOOD, -1, 1)
  addEvent(world, `${c.name} tried ${label} and it did not work`)
  return { success: false, message, moodDelta: REFUSAL_MOOD, minutes: 0, label }
}

/** Carries out a move, or refuses it in plain words. Never throws for anything a mind can send. */
export function act(world: World, characterId: string, move: Act): ActResult {
  const c = character(world, characterId)
  const action = typeof move.action === 'string' ? move.action : ''
  const params = move.params ?? {}
  const def = MOVES.find((m) => m.spec.name === action)
  const label = def?.spec.label ?? `trying to ${cleanText(action, 30) || 'do something'}`

  if (c.asleep) return refuse(world, c, 'You are asleep.', label)
  if (world.minutes < c.busyUntil) return refuse(world, c, `You are still busy ${c.doing}.`, label)
  if (!def || !tierAllows(c, def)) return refuse(world, c, "That is not something you can do here.", label)

  const offer = def.offer(world, c)
  if (!offer.ok) return refuse(world, c, `You cannot do that right now: ${offer.reason}.`, label)
  for (const [key, choices] of Object.entries(offer.params)) {
    const given = params[key]
    if (given === undefined || !choices.some((choice) => same(choice, String(given)))) {
      const shown = given === undefined ? 'nothing' : `"${cleanText(String(given), 40)}"`
      return refuse(world, c, `For ${key} you gave ${shown}. Choose one of: ${choices.join(', ') || 'nothing is available'}.`, label)
    }
  }

  const outcome = def.perform(world, c, params)
  if (!outcome.ok) return refuse(world, c, outcome.reason, outcome.label ?? label)

  const done = outcome.done
  c.busyUntil = world.minutes + done.minutes
  c.doing = done.label
  c.body.mood = clamp(c.body.mood + done.moodDelta, -1, 1)
  addEvent(world, done.event)
  return { success: true, message: done.message, moodDelta: done.moodDelta, minutes: done.minutes, label: done.label }
}
