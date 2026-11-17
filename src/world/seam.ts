/**
 * The seam between the world and a mind. A mind only ever gets a manifest (what this world is and
 * every move it has), an observation (what is true right now), and the result of an act.
 * One table of moves drives all three, so they cannot drift apart.
 */

import { COLOURS, EXTRAS, MARKS, PURPOSES, ROOFS, cleanText, validateRecipe, workUnits } from '../shared/recipe.ts'
import type { Act, Building, Character, Colour, Mark, MemoryKind, Purpose, Tile, Urgency, World } from '../shared/types.ts'
import { clockOf } from './clock.ts'
import { HEARD_MAX, NOTES_MAX, RESERVED_NAMES, distance, homesWithRoom, others, residents, withinHearing } from './people.ts'
import { candidateSites } from './sites.ts'
import { addEvent, character, clamp, random, urgency } from './world.ts'

export type { Act } from '../shared/types.ts'

/** optional: may be left out of an act; the move then uses its own default */
export type ParamSpec = { values?: string[]; hint?: string; role?: 'words'; optional?: boolean }
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
  /** inhabitants: where they live, or that they have none; empty for the origin */
  home: string
  /** every other character, nearest first */
  people: string[]
  /** what was said within earshot since the last turn, oldest first */
  heard: string[]
  /** notes within arm's reach */
  notes: string[]
}
export type Left = { characterId: string; text: string; kind: MemoryKind }
export type ActResult = {
  success: boolean
  message: string
  moodDelta: number
  minutes: number
  label: string
  /** ids of the characters who heard this move */
  heardBy: string[]
  /** memories this move leaves in characters, the actor or others */
  leaves: Left[]
  /** id of a character this move brought to life */
  created: string | null
}

const WALK_MINUTES_PER_TILE = 3
const WANDER_REACH = 5
const MAX_SITES_UNFINISHED = 2
const REFUSAL_MOOD = -0.05
export const RAIN_WORDS = ['dry', 'a thin rain', 'raining hard', 'a storm']
const RECENT_EVENTS = 8
const NAME_MAX = 30
const ABOUT_MAX = 80
const SPEECH_MAX = 200
const NOTE_MAX = 200
const WHO_MAX = 300
const KIND_MAX = 40
const LIST_ITEM_MAX = 40
const MAX_TRAITS = 4
const MAX_OTHERS = 3

type Thing = { name: string; at: Tile; describe: string; look: string }
type Offer = { ok: true; params: Record<string, string[]> } | { ok: false; reason: string }
type Done = {
  message: string; moodDelta: number; minutes: number; label: string; event: string
  heardBy?: string[]; leaves?: Left[]; created?: string | null
}
type Outcome = { ok: true; done: Done } | { ok: false; reason: string; label?: string }
type MoveDef = {
  spec: MoveSpec
  offer(world: World, c: Character): Offer
  perform(world: World, c: Character, params: Record<string, string>): Outcome
}

/** Names match whatever their case, and with or without a leading "the" or "a": models drop both. */
const plain = (name: string) => name.trim().toLowerCase().replace(/^(the|an|a)\s+/, '')
const same = (a: string, b: string) => plain(a) === plain(b)
const finished = (b: Building) => b.workLeft === 0

const PURPOSE_WORDS: Record<Purpose, string> = { home: 'a home', food: 'a place to eat', other: 'a building' }
const FEATURE_LOOKS: Record<string, string> = {
  berry_bush: 'A low bush heavy with dark berries. There are always a few more than you remember.',
  hollow_tree: 'An old tree with a hollow at its foot, dry inside and just big enough to curl up in.',
  pond: 'Still water with the sky in it. Something small moves under the surface.',
  tree: 'A tree. It was here before you were.',
}

/** "Mo", "Mo and Fen", "Mo, Fen and Dot". */
function andList(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Everything a character can name as a target. Trees share a name; the nearest one stands for all. */
function things(world: World, c: Character): Thing[] {
  const from = c.at
  const builder = world.characters.find((other) => other.tier === 'origin')?.name ?? 'Someone'
  const list: Thing[] = []
  const byDistance = [...world.features].sort((a, b) => distance(a.at, from) - distance(b.at, from))
  for (const f of byDistance) {
    if (list.some((t) => t.name === f.name)) continue
    list.push({ name: f.name, at: f.at, describe: f.name, look: FEATURE_LOOKS[f.kind] })
  }
  for (const b of world.buildings) {
    const what = b.about || PURPOSE_WORDS[b.purpose]
    const living = residents(world, b).map((r) => r.name)
    const who = `${c.tier === 'origin' ? 'You built it.' : `${builder} built it.`}${living.length ? ` Home to ${andList(living)}.` : ''}`
    list.push({
      name: b.name,
      at: b.at,
      describe: finished(b) ? `${b.name} (${what})` : `the building site for ${b.name}`,
      look: finished(b)
        ? `${b.name}: ${what}. ${who}`
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

/** "shy, watchful, , kind" → ['shy', 'watchful', 'kind'], at most max of them. */
function listOf(text: string | undefined, max: number): string[] {
  return (text ?? '').split(',').map((item) => cleanText(item, LIST_ITEM_MAX)).filter((item) => item !== '').slice(0, max)
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
  things(world, c).filter(
    (t) => world.features.some((f) => f.kind === 'berry_bush' && f.name === t.name) ||
      world.buildings.some((b) => b.name === t.name && finished(b) && b.purpose === 'food'),
  )
const sleepSpots = (world: World, c: Character) =>
  things(world, c).filter(
    (t) => world.features.some((f) => f.kind === 'hollow_tree' && f.name === t.name) ||
      world.buildings.some((b) => b.name === t.name && finished(b) && b.purpose === 'home'),
  )

/** Places, things and other characters a character can walk to. */
const destinations = (world: World, c: Character): { name: string; at: Tile }[] => [
  ...things(world, c),
  ...others(world, c).map((other) => ({ name: other.name, at: other.at })),
]

const MOVES: MoveDef[] = [
  {
    spec: {
      name: 'move_to', label: 'walking somewhere', tier: 'inhabitant',
      description: 'Walk to a place, a thing or someone, or wander with nowhere in mind.',
      params: { target: { hint: 'wander, or a place or someone from the list' } },
    },
    offer: (world, c) => ({ ok: true, params: { target: ['wander', ...destinations(world, c).map((t) => t.name)] } }),
    perform(world, c, params) {
      if (same(params.target ?? '', 'wander')) {
        const to = {
          x: clamp(c.at.x + Math.round((random(world) * 2 - 1) * WANDER_REACH), 0, world.size - 1),
          y: clamp(c.at.y + Math.round((random(world) * 2 - 1) * WANDER_REACH), 0, world.size - 1),
        }
        const minutes = Math.max(walk(c, to), WALK_MINUTES_PER_TILE)
        return { ok: true, done: { message: 'You wander a little way and stop somewhere new.', moodDelta: 0, minutes, label: 'wandering', event: `${c.name} wandered about` } }
      }
      const thing = find(destinations(world, c), params.target)!
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
      const sleepy = c.body.tiredness >= 0.3 || (clockOf(world.minutes).night && c.body.tiredness >= 0.15)
      if (!sleepy) return { ok: false, reason: 'you are not tired enough to sleep' }
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
    offer: (world, c) => ({ ok: true, params: { target: things(world, c).map((t) => t.name) } }),
    perform(world, c, params) {
      const thing = find(things(world, c), params.target)!
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
      const homeless = residents(world, building)
      world.buildings = world.buildings.filter((b) => b !== building)
      for (const resident of homeless) {
        resident.homeId = null
        addEvent(world, `${resident.name} no longer has a home`)
      }
      return { ok: true, done: { message: `You pull down ${building.name}. The ground is bare again.`, moodDelta: 0, minutes, label: `pulling down ${building.name}`, event: `${c.name} pulled down ${building.name}` } }
    },
  },
  {
    spec: {
      name: 'create_inhabitant', label: 'bringing someone to life', tier: 'origin',
      description: 'Bring someone new to life to live in one of your homes. You decide who they are; after that they decide for themselves.',
      params: {
        name: { hint: 'what they are called, one or two words' },
        kind: { hint: 'what sort of creature they are, a few words' },
        who: { hint: 'who they are, a sentence or two, in your own words' },
        traits: { hint: 'two to four, separated by commas' },
        cares_about: { hint: 'one to three things, separated by commas' },
        fears: { hint: 'one to three things, separated by commas' },
        colour: { values: COLOURS },
        mark: { values: MARKS, hint: 'the one thing that sets them apart to look at' },
        home: { hint: 'a home with room, from the list' },
      },
    },
    offer(world) {
      const count = world.characters.filter((other) => other.tier === 'inhabitant').length
      if (count >= world.populationLimit) return { ok: false, reason: 'the town cannot support anyone more yet' }
      const homes = homesWithRoom(world)
      if (homes.length === 0) return { ok: false, reason: 'there is no finished home with room for someone new' }
      return { ok: true, params: { home: homes.map((b) => b.name), colour: COLOURS, mark: MARKS } }
    },
    perform(world, c, params) {
      const name = cleanText(params.name ?? '', NAME_MAX)
      if (name === '') return { ok: false, reason: 'They need a name.' }
      const taken = [...world.characters, ...world.buildings, ...world.features].some((t) => same(t.name, name)) ||
        RESERVED_NAMES.some((word) => same(word, name))
      if (taken) return { ok: false, reason: `There is already something called ${name}. Choose another name.` }
      const who = cleanText(params.who ?? '', WHO_MAX)
      if (who === '') return { ok: false, reason: 'Say who they are in a sentence or two.' }
      const traits = listOf(params.traits, MAX_TRAITS)
      if (traits.length === 0) return { ok: false, reason: 'Give them at least one trait.' }
      const home = find(homesWithRoom(world), params.home)!
      const id = `c${world.nextId++}`
      const minutes = walk(c, home.at) + 60
      world.characters.push({
        id, name, tier: 'inhabitant', at: { x: home.at.x, y: home.at.y },
        body: { hunger: 0.2, tiredness: 0.1, mood: 0.1 }, asleep: false, busyUntil: world.minutes, doing: 'idle',
        said: '', saidAt: 0, queue: [], queueTurn: 0, homeId: home.id,
        look: { colour: params.colour as Colour, mark: params.mark as Mark },
        sheet: {
          name, you: cleanText(params.kind ?? '', KIND_MAX) || 'a small creature', core: who, traits,
          values: listOf(params.cares_about, MAX_OTHERS), fears: listOf(params.fears, MAX_OTHERS),
        },
        heard: [],
      })
      return {
        ok: true,
        done: {
          message: `${name} blinks awake at ${home.name} and looks at you.`, moodDelta: 0.2, minutes,
          label: `bringing ${name} to life`, event: `${c.name} made ${name}, who will live at ${home.name}`,
          created: id,
          leaves: [
            { characterId: c.id, text: `I made ${name}. They live at ${home.name}.`, kind: 'person' },
            { characterId: id, text: `I opened my eyes at ${home.name}, and ${c.name} was there.`, kind: 'moment' },
          ],
        },
      }
    },
  },
  {
    spec: {
      name: 'speak', label: 'saying something out loud', tier: 'inhabitant',
      description: 'Say something out loud, to someone near or to whoever is listening. Everyone near enough hears it.',
      params: {
        to: { hint: 'anyone, or someone near enough to hear you', optional: true },
        text: { role: 'words', hint: 'what you say' },
      },
    },
    offer: (world, c) => ({ ok: true, params: { to: ['anyone', ...withinHearing(world, c).map((other) => other.name)] } }),
    perform(world, c, params) {
      const text = cleanText(params.text ?? '', SPEECH_MAX)
      if (text === '') return { ok: false, reason: 'You open your mouth but have nothing to say.' }
      const hearers = withinHearing(world, c)
      const to = params.to === undefined || same(params.to, 'anyone') ? null : find(hearers, params.to)!
      c.said = text
      c.saidAt = world.minutes
      const leaves: Left[] = []
      for (const hearer of hearers) {
        const toYou = hearer === to
        hearer.heard.push({ from: c.name, text, minute: world.minutes, toYou })
        if (hearer.heard.length > HEARD_MAX) hearer.heard.splice(0, hearer.heard.length - HEARD_MAX)
        leaves.push({ characterId: hearer.id, text: `${c.name} said${toYou ? ' to me' : ''}: "${text}"`, kind: 'person' })
      }
      return {
        ok: true,
        done: {
          message: `You say${to ? ` to ${to.name}` : ''}: "${text}"`, moodDelta: 0, minutes: 2, label: 'saying something out loud',
          event: `${c.name} said${to ? ` to ${to.name}` : ''}: "${text}"`,
          heardBy: hearers.map((hearer) => hearer.id), leaves,
        },
      }
    },
  },
  {
    spec: {
      name: 'leave_note', label: 'leaving a note', tier: 'inhabitant',
      description: 'Write a short note and leave it where you are, for whoever comes by.',
      params: { text: { role: 'words', hint: 'what the note says' } },
    },
    offer: () => ({ ok: true, params: {} }),
    perform(world, c, params) {
      const text = cleanText(params.text ?? '', NOTE_MAX)
      if (text === '') return { ok: false, reason: 'You have nothing to write.' }
      const place = things(world, c).find((t) => distance(t.at, c.at) <= 1)?.name ?? 'the open ground'
      world.notes.push({ id: `n${world.nextId++}`, at: { x: c.at.x, y: c.at.y }, place, by: c.name, text, minute: world.minutes })
      if (world.notes.length > NOTES_MAX) world.notes.splice(0, world.notes.length - NOTES_MAX)
      return { ok: true, done: { message: `You leave a note at ${place}.`, moodDelta: 0, minutes: 5, label: 'leaving a note', event: `${c.name} left a note at ${place}` } }
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

const allows = (tier: Character['tier'], move: MoveDef) => move.spec.tier === 'inhabitant' || tier === 'origin'
const tierAllows = (c: Character, move: MoveDef) => allows(c.tier, move)

export function manifest(tier: Character['tier']): Manifest {
  const origin = tier === 'origin'
  return {
    protocol: 'seedlings/1',
    name: 'the plot',
    description: origin
      ? 'A wide green plot of land. It was empty when you arrived: a berry bush, a hollow tree, a pond and a few trees. Anything else here, you built.'
      : 'A small town on a wide green plot: a berry bush, a hollow tree, a pond and a few trees. Pip, a seedling, built everything else here, and brought you here.',
    glossary: [
      origin ? 'a building site is a building you have started and not finished' : 'a building site is a building Pip has started and not finished',
      'a home is somewhere to sleep, and a food place is somewhere to eat',
      'the hollow tree is where you can sleep until there is a home',
    ],
    stance: 'Nobody tells you what to do with your day.',
    moves: MOVES.filter((move) => allows(tier, move)).map((move) => move.spec),
  }
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

  const homeOf = c.homeId === null ? undefined : world.buildings.find((b) => b.id === c.homeId)
  const home = c.tier === 'origin' ? '' : homeOf ? `Your home is ${homeOf.name}.` : 'You have no home.'
  const people = others(world, c)
    .sort((a, b) => distance(a.at, c.at) - distance(b.at, c.at))
    .map((other) => `${other.name}, ${away(distance(other.at, c.at))}, ${other.asleep ? 'asleep' : other.doing}`)
  const heard = c.heard.map((h) => `${h.from} said${h.toYou ? ' to you' : ''}: "${h.text}"`)
  const notes = world.notes.filter((n) => distance(n.at, c.at) <= 1).map((n) => `A note at ${n.place} from ${n.by}: "${n.text}"`)

  const around = things(world, c).map((t) => ({ text: t.describe, tiles: distance(t.at, c.at) }))
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
    home,
    people,
    heard,
    notes,
  }
}

function refuse(world: World, c: Character, message: string, label: string): ActResult {
  c.body.mood = clamp(c.body.mood + REFUSAL_MOOD, -1, 1)
  addEvent(world, `${c.name} tried ${label} and it did not work`)
  return { success: false, message, moodDelta: REFUSAL_MOOD, minutes: 0, label, heardBy: [], leaves: [], created: null }
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
    if (given === undefined && def.spec.params[key]?.optional) continue
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
  return {
    success: true, message: done.message, moodDelta: done.moodDelta, minutes: done.minutes, label: done.label,
    heardBy: done.heardBy ?? [], leaves: done.leaves ?? [], created: done.created ?? null,
  }
}
