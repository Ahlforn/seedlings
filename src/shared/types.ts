/** Types shared by the server and the watch page. */

export type Tile = { x: number; y: number }
export type MemoryKind = 'person' | 'work' | 'fact' | 'moment'
export type Urgency = 'satisfied' | 'mild' | 'strong' | 'urgent'

export type FeatureKind = 'berry_bush' | 'hollow_tree' | 'pond' | 'tree'
export type Feature = { id: string; kind: FeatureKind; name: string; at: Tile }

export type Colour = 'cream' | 'white' | 'sand' | 'brick' | 'red' | 'blue' | 'green' | 'yellow' | 'grey' | 'brown'
export type RoofShape = 'flat' | 'pitched' | 'pyramid' | 'dome'
export type Extra = 'chimney' | 'awning' | 'garden' | 'lantern'
export type Recipe = {
  footprint: 1 | 2 | 3
  floors: 1 | 2 | 3
  wall: Colour
  roof: RoofShape
  roofColour: Colour
  door: boolean
  windows: 0 | 1 | 2 | 3
  sign: string
  extras: Extra[]
}

export type Purpose = 'home' | 'food' | 'other'
export type Building = {
  id: string
  name: string
  purpose: Purpose
  about: string
  recipe: Recipe
  at: Tile
  workLeft: number
  workTotal: number
  startedDay: number
}

/** hunger and tiredness run 0..1, mood runs -1..1 */
export type Body = { hunger: number; tiredness: number; mood: number }

export type Act = { action: string; params: Record<string, string> }

/** A character sheet is the only part of a character anyone writes. Everything else is earned. */
export type Sheet = { name: string; you: string; core: string; traits: string[]; values: string[]; fears: string[] }
export type Mark = 'ears' | 'antennae' | 'tail' | 'hat' | 'scarf' | 'spots'
export type Look = { colour: Colour; mark: Mark }
/** Something said within earshot, kept until the listener's next turn. */
export type Heard = { from: string; text: string; minute: number; toYou: boolean }
export type Note = { id: string; at: Tile; place: string; by: string; text: string; minute: number }

export type Character = {
  id: string
  name: string
  tier: 'origin' | 'inhabitant'
  at: Tile
  body: Body
  asleep: boolean
  /** world minutes until which the character is occupied */
  busyUntil: number
  doing: string
  said: string
  saidAt: number
  /** moves still to do from the last decision, and that turn's id */
  queue: Act[]
  queueTurn: number
  /** inhabitants only: where they live, how they look, and the sheet Pip wrote */
  homeId: string | null
  look: Look | null
  sheet: Sheet | null
  heard: Heard[]
}

export type World = {
  size: number
  seed: number
  rng: number
  minutes: number
  rain: 0 | 1 | 2 | 3
  features: Feature[]
  buildings: Building[]
  characters: Character[]
  events: { minute: number; text: string }[]
  notes: Note[]
  /** how many inhabitants the budget can support; set by the scheduler */
  populationLimit: number
  nextId: number
}

/** What the watch page is sent. */
export type StateView = {
  clock: string
  day: number
  night: boolean
  weather: string
  size: number
  features: Feature[]
  buildings: Building[]
  notes: Note[]
  /** Pip first, then the inhabitants in the order they arrived */
  characters: {
    id: string
    name: string
    tier: 'origin' | 'inhabitant'
    look: Look | null
    /** the name of their home, or empty */
    home: string
    at: Tile
    asleep: boolean
    /** 'asleep' while asleep */
    doing: string
    said: string
    mood: number
    thought: string
    onMind: string[]
  }[]
  /** newest first */
  events: { clock: string; text: string }[]
  population: { count: number; limit: number }
  /** trouble is why thinking or saving is failing right now, or empty */
  budget: { leftToday: number; canThink: boolean; reason: string; trouble: string }
}

export type DiaryView = { id: number; clock: string; text: string }

/** A diary entry and the turns it was written about. */
export type TraceView = {
  /** whose diary it is */
  name: string
  entry: DiaryView
  turns: {
    clock: string
    saw: string
    consider: string
    moves: Act[]
    because: string
    results: { success: boolean; message: string }[]
  }[]
}
