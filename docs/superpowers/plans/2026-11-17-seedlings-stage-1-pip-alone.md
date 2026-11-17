# Seedlings Stage 1 (Pip Alone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A town that runs unattended on a VPS in which one AI character, Pip, lives on an empty plot, builds buildings from a kit, remembers, keeps a diary, stays inside a model allowance, and can be watched on a private isometric web page.

**Architecture:** One Node service. A pure `World` object is advanced by a scheduler. The world and Pip's mind exchange only a manifest, an observation, and act/result. Everything is persisted in one SQLite file. The same service serves the watch page and pushes live state over server-sent events.

**Tech Stack:** Node 24 (runs `.ts` directly, erasable syntax only), TypeScript, `better-sqlite3`, `node:http`, Vitest, Vite (client bundle only), Canvas 2D. No web framework, no agent framework.

**Spec:** `docs/superpowers/specs/2026-11-17-seedlings-design.md`. This plan covers the spec's stage 1 only. Inhabitants, owner events and facility plug-ins are later plans.

## Global Constraints

- Target machine: a VPS with 5 cores and 6 GB of RAM. No local models.
- Model provider is a setting. Default: OpenCode Go, `https://opencode.ai/inference/go/openai/v1`, model `glm-5.2`.
- Every model request sends `User-Agent: seedlings-town/0.1` and `x-opencode-session: <character id>`.
- Allowance limits: monthly allowance, at most 50% of it in any 7 days, at most 20% in any 5 hours.
- The town must never be charged beyond the allowance. A reply with `billing_source` of `balance` halts all thinking.
- Moves not on offer are left out of the prompt entirely, not forbidden in words.
- A reply that cannot be read is asked for once more, then treated as `wait`.
- Four in-world days pass per real day (a setting). Sleeping characters do not think.
- Nothing is scripted: the world offers moves and consequences only. Pip's character sheet names no interests.
- Every turn is stored in full: observation, prompts, raw reply, decision, results, allowance used.
- The watch page is private behind a password.
- Text written by a model is never inserted into the page as HTML.
- TypeScript throughout; code under `src/shared/` is used by both server and page.
- Imports use explicit `.ts` extensions. No enums, no parameter properties (Node type stripping).

## Review Focus

1. **Restart mid-life.** The service stops while Pip is asleep or a building is half done, and starts hours later. In-world time must not jump by the downtime, and no work is lost or doubled. (Task 9)
2. **A move that is not on offer.** The model returns valid JSON naming a move or target that is not available. The world refuses in words, the turn is still recorded, nothing crashes. (Task 4, Task 9)
3. **Provider failure.** Timeouts, 429 and 5xx. No allowance is recorded, the world keeps ticking, and retries back off instead of looping. (Task 9)
4. **Charged to balance.** Extra Usage is on and a reply reports `billing_source: "balance"`. Thinking halts and the page says why. (Task 7, Task 10)
5. **Model text containing HTML.** A sign or diary line containing `<script>`. The page shows it as text. (Task 11)

## File Structure

```
package.json  tsconfig.json  vitest.config.ts  vite.config.ts  .gitignore  .env.example  README.md
src/shared/types.ts      world, recipe and view types shared by server and page
src/shared/recipe.ts     the building kit: choices, validation, work units
src/shared/iso.ts        isometric projection and building faces (pure)
src/config.ts            settings from environment
src/world/clock.ts       in-world time
src/world/world.ts       create and advance the world: body, weather, sleep
src/world/sites.ts       named places where a building may go
src/world/seam.ts        manifest, observe, act
src/store/store.ts       SQLite: world snapshot, turns, memory, diary, ledger, flags
src/model/client.ts      ModelClient, OpenAI-compatible client
src/model/scripted.ts    stand-in model for tests and fake runs
src/budget/keeper.ts     allowance tracking and pacing
src/mind/sheet.ts        Pip's character sheet
src/mind/prompt.ts       observation to words
src/mind/decision.ts     reply to decision
src/mind/memory.ts       recall, beliefs, tidying
src/mind/reflect.ts      diary and memory reflection
src/town/turn.ts         one full turn, one reflection
src/town/scheduler.ts    the loop that advances time and gives turns
src/server/http.ts       login, state, stream, diary, trace, static files
src/main.ts              wiring
web/index.html  web/style.css  web/main.ts  web/draw.ts  web/panel.ts
scripts/smoke.ts         one real model call, prints the usage block
deploy/seedlings.service systemd unit
tests/**                 mirrors src/
```

---

### Task 1: Project, settings and the clock

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/config.ts`, `src/world/clock.ts`
- Test: `tests/config.test.ts`, `tests/world/clock.test.ts`

**Interfaces:**
- Produces:

```ts
// src/config.ts
export type Config = {
  port: number; dbPath: string; password: string
  baseUrl: string; apiKey: string; pipModel: string; userAgent: string; jsonMode: boolean
  daysPerRealDay: number; tickMs: number; seed: number
  monthlyAllowance: number; periodStartDay: number; fakeModel: boolean
}
export function loadConfig(env: Record<string, string | undefined>): Config

// src/world/clock.ts
export const START_MINUTES = 360                       // day 1, 06:00
export type Clock = { day: number; hour: number; minute: number; night: boolean; label: string; partOfDay: string }
export function clockOf(worldMinutes: number): Clock
export function worldMinutesFor(realMs: number, daysPerRealDay: number): number
```

- Environment names and defaults: `PORT` 8787, `SEEDLINGS_DB` `./data/seedlings.db`, `SEEDLINGS_PASSWORD` (required), `SEEDLINGS_BASE_URL` `https://opencode.ai/inference/go/openai/v1`, `SEEDLINGS_API_KEY` (required unless fake), `SEEDLINGS_PIP_MODEL` `glm-5.2`, `SEEDLINGS_JSON_MODE` `1`, `SEEDLINGS_DAYS_PER_REAL_DAY` 4, `SEEDLINGS_TICK_MS` 5000, `SEEDLINGS_SEED` 1, `SEEDLINGS_MONTHLY_ALLOWANCE` 60, `SEEDLINGS_PERIOD_START_DAY` 1, `SEEDLINGS_FAKE_MODEL` unset. `userAgent` is fixed at `seedlings-town/0.1`.
- Night is `hour < 6 || hour >= 21`. `partOfDay`: 5–8 `Early morning`, 8–11 `Morning`, 11–14 `Midday`, 14–18 `Afternoon`, 18–21 `Evening`, else `Night`. `label` is `"10:30, day 3"`.

- [ ] **Step 1: Scaffold.** `git init`. `package.json` with `"type": "module"`, `"engines": {"node": ">=24"}`, scripts `test` (`vitest run`), `typecheck` (`tsc --noEmit`), `start` (`node src/main.ts`), `build:web` (`vite build`), `smoke` (`node scripts/smoke.ts`). Dev dependencies: `typescript`, `vitest`, `vite`, `@types/node`, `@types/better-sqlite3`. Dependency: `better-sqlite3`. `tsconfig.json`: `strict`, `module` and `moduleResolution` `nodenext`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noEmit`, `lib` `["ES2023","DOM"]`. `.gitignore`: `node_modules`, `dist`, `data`, `.env`, `.superpowers`. `.env.example` lists every variable above with its default.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/world/clock.test.ts
import { clockOf, worldMinutesFor, START_MINUTES } from '../../src/world/clock.ts'
test('the world starts on day 1 at 06:00', () => {
  expect(clockOf(START_MINUTES)).toMatchObject({ day: 1, hour: 6, minute: 0, night: false, label: '06:00, day 1' })
})
test('days roll over and night is flagged', () => {
  expect(clockOf(1440 * 2 + 630)).toMatchObject({ day: 3, hour: 10, minute: 30, label: '10:30, day 3', partOfDay: 'Morning' })
  expect(clockOf(21 * 60).night).toBe(true)
  expect(clockOf(5 * 60 + 59).night).toBe(true)
})
test('four in-world days per real day means one real minute is four world minutes', () => {
  expect(worldMinutesFor(60_000, 4)).toBe(4)
})

// tests/config.test.ts
import { loadConfig } from '../src/config.ts'
test('defaults', () => {
  const c = loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_API_KEY: 'k' })
  expect(c).toMatchObject({ port: 8787, pipModel: 'glm-5.2', daysPerRealDay: 4, monthlyAllowance: 60,
    baseUrl: 'https://opencode.ai/inference/go/openai/v1', userAgent: 'seedlings-town/0.1', jsonMode: true })
})
test('names the missing variable', () => {
  expect(() => loadConfig({ SEEDLINGS_API_KEY: 'k' })).toThrow('SEEDLINGS_PASSWORD')
  expect(() => loadConfig({ SEEDLINGS_PASSWORD: 'p' })).toThrow('SEEDLINGS_API_KEY')
})
test('a fake model needs no key', () => {
  expect(loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_FAKE_MODEL: '1' }).fakeModel).toBe(true)
})
```

- [ ] **Step 3: Run** `npm install && npm test`. Expected: FAIL, modules not found.
- [ ] **Step 4: Implement** `src/world/clock.ts` and `src/config.ts` to the signatures above.
- [ ] **Step 5: Run** `npm test && npm run typecheck`. Expected: PASS, no type errors.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: project scaffold, settings and world clock"`

---

### Task 2: The world: plot, body, weather, time

**Files:**
- Create: `src/shared/types.ts`, `src/world/world.ts`
- Test: `tests/world/world.test.ts`

**Interfaces:**
- Consumes: `START_MINUTES`, `clockOf`.
- Produces:

```ts
// src/shared/types.ts
export type Tile = { x: number; y: number }
export type Urgency = 'satisfied' | 'mild' | 'strong' | 'urgent'
export type FeatureKind = 'berry_bush' | 'hollow_tree' | 'pond' | 'tree'
export type Feature = { id: string; kind: FeatureKind; name: string; at: Tile }
export type Colour = 'cream' | 'white' | 'sand' | 'brick' | 'red' | 'blue' | 'green' | 'yellow' | 'grey' | 'brown'
export type RoofShape = 'flat' | 'pitched' | 'pyramid' | 'dome'
export type Extra = 'chimney' | 'awning' | 'garden' | 'lantern'
export type Recipe = { footprint: 1 | 2 | 3; floors: 1 | 2 | 3; wall: Colour; roof: RoofShape; roofColour: Colour
  door: boolean; windows: 0 | 1 | 2 | 3; sign: string; extras: Extra[] }
export type Purpose = 'home' | 'food' | 'other'
export type Building = { id: string; name: string; purpose: Purpose; about: string; recipe: Recipe; at: Tile
  workLeft: number; workTotal: number; startedDay: number }
export type Body = { hunger: number; tiredness: number; mood: number }   // 0..1, 0..1, -1..1
export type Act = { action: string; params: Record<string, string> }
export type Character = { id: string; name: string; tier: 'origin' | 'inhabitant'; at: Tile; body: Body
  asleep: boolean; busyUntil: number; doing: string; said: string; saidAt: number
  queue: Act[]; queueTurn: number }       // moves still to do from the last decision, and that turn's id
export type World = { size: number; seed: number; rng: number; minutes: number; rain: 0 | 1 | 2 | 3
  features: Feature[]; buildings: Building[]; characters: Character[]
  events: { minute: number; text: string }[]; nextId: number }

// src/world/world.ts
export const PIP_ID = 'pip'
export function createWorld(seed: number): World
export function advance(world: World, minutes: number): void          // mutates
export function urgency(level: number): Urgency
export function addEvent(world: World, text: string): void            // keeps the newest 50
export function random(world: World): number                          // seeded, advances world.rng
export function character(world: World, id: string): Character
```

- `createWorld`: `size` 24, `minutes` `START_MINUTES`, `rain` 0. Features: `the berry bush` (berry_bush) at (8,9), `the hollow tree` (hollow_tree) at (14,8), `the pond` (pond) at (11,15), plus six `tree` features named `a tree` on free tiles chosen with `random`. Pip: id `pip`, name `Pip`, tier `origin`, at (12,12), hunger 0.2, tiredness 0.1, mood 0, awake, `doing` `idle`, `said` empty, `busyUntil` 0, `queue` empty.
- `advance`, per in-world hour (applied pro rata per minute): awake hunger +0.06, tiredness +0.05; asleep hunger +0.02, tiredness −0.12; mood moves 10% toward 0. All clamped. A sleeper wakes when tiredness ≤ 0.05: `asleep` false, mood +0.1, event `"<name> woke up"`. On each whole-hour boundary crossed, with probability 0.25 rain moves by ±1 (clamped 0..3).
- `urgency`: < 0.3 `satisfied`, < 0.6 `mild`, < 0.85 `strong`, else `urgent`.
- `random` is mulberry32 over `world.rng`, so a world replays identically from its seed.

- [ ] **Step 1: Write the failing tests**

```ts
import { createWorld, advance, urgency, addEvent, character, PIP_ID } from '../../src/world/world.ts'
test('the plot starts with only natural features and Pip', () => {
  const w = createWorld(1)
  expect(w.buildings).toEqual([])
  expect(w.features.map(f => f.kind).sort()).toEqual(
    ['berry_bush', 'hollow_tree', 'pond', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree'])
  expect(w.characters).toHaveLength(1)
  expect(character(w, PIP_ID)).toMatchObject({ name: 'Pip', tier: 'origin', asleep: false })
})
test('the same seed gives the same world', () => {
  expect(createWorld(7)).toEqual(createWorld(7))
  expect(createWorld(7).features).not.toEqual(createWorld(8).features)
})
test('no two features share a tile', () => {
  const tiles = createWorld(3).features.map(f => `${f.at.x},${f.at.y}`)
  expect(new Set(tiles).size).toBe(tiles.length)
})
test('an hour awake makes Pip hungrier and more tired', () => {
  const w = createWorld(1); advance(w, 60)
  expect(character(w, PIP_ID).body.hunger).toBeCloseTo(0.26, 5)
  expect(character(w, PIP_ID).body.tiredness).toBeCloseTo(0.15, 5)
})
test('a sleeper rests and wakes on its own', () => {
  const w = createWorld(1); const p = character(w, PIP_ID)
  p.asleep = true; p.body.tiredness = 0.5
  advance(w, 240)
  expect(p.asleep).toBe(false)
  expect(w.events.at(-1)!.text).toBe('Pip woke up')
})
test('body values stay in range over a long time', () => {
  const w = createWorld(1); advance(w, 1440 * 5)
  const b = character(w, PIP_ID).body
  expect(b.hunger).toBeLessThanOrEqual(1); expect(b.tiredness).toBeLessThanOrEqual(1)
})
test('urgency words', () => {
  expect([0.1, 0.4, 0.7, 0.9].map(urgency)).toEqual(['satisfied', 'mild', 'strong', 'urgent'])
})
test('only the newest 50 events are kept', () => {
  const w = createWorld(1); for (let i = 0; i < 60; i++) addEvent(w, `e${i}`)
  expect(w.events).toHaveLength(50); expect(w.events.at(-1)!.text).toBe('e59')
})
```

- [ ] **Step 2: Run** `npx vitest run tests/world/world.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `src/shared/types.ts` and `src/world/world.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: world with plot, body, weather and time"`

---

### Task 3: The building kit and building sites

**Files:**
- Create: `src/shared/recipe.ts`, `src/world/sites.ts`
- Test: `tests/shared/recipe.test.ts`, `tests/world/sites.test.ts`

**Interfaces:**
- Consumes: types from Task 2.
- Produces:

```ts
// src/shared/recipe.ts
export const COLOURS: Colour[]; export const ROOFS: RoofShape[]; export const EXTRAS: Extra[]
export const PURPOSES: Purpose[]
export function validateRecipe(input: Record<string, string>):
  { ok: true; recipe: Recipe } | { ok: false; reason: string }
export function workUnits(recipe: Recipe): number            // footprint * floors + 1
export function cleanText(text: string, max: number): string // strips control characters, trims, cuts to max

// src/world/sites.ts
export type Site = { name: string; at: Tile; maxFootprint: 1 | 2 | 3 }
export function candidateSites(world: World): Site[]         // at most 6, deterministic
export function footprintTiles(at: Tile, footprint: number): Tile[]
export function isFree(world: World, at: Tile, footprint: number): boolean
```

- `validateRecipe` reads keys `footprint`, `floors`, `wall`, `roof`, `roof_colour`, `windows`, `sign`, `extras` (comma-separated). Missing keys default to footprint 1, floors 1, wall `cream`, roof `pitched`, roof_colour `red`, windows 1, sign empty, no extras. `door` is always true. `sign` is cleaned to 16 characters. `reason` is a plain sentence naming the bad value and the choices.
- `candidateSites`: free spots named after the nearest feature or building and a compass word, e.g. `north of the pond`, `beside the berry bush`, plus `the middle of the plot`, listed first, when free. Characters do not block a site. Names are unique. A site never overlaps a feature, a building, or the plot edge.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/shared/recipe.test.ts
import { validateRecipe, workUnits, cleanText } from '../../src/shared/recipe.ts'
test('defaults make a small cream house with a red pitched roof', () => {
  const r = validateRecipe({})
  expect(r).toEqual({ ok: true, recipe: { footprint: 1, floors: 1, wall: 'cream', roof: 'pitched',
    roofColour: 'red', door: true, windows: 1, sign: '', extras: [] } })
})
test('a full recipe is read', () => {
  const r = validateRecipe({ footprint: '2', floors: '3', wall: 'blue', roof: 'dome', roof_colour: 'grey',
    windows: '3', sign: 'BREAD', extras: 'chimney, garden' })
  expect(r.ok && r.recipe).toMatchObject({ footprint: 2, floors: 3, roof: 'dome', extras: ['chimney', 'garden'] })
})
test('a bad value is refused in words that list the choices', () => {
  const r = validateRecipe({ roof: 'thatched' })
  expect(r.ok).toBe(false)
  expect(!r.ok && r.reason).toContain('thatched')
  expect(!r.ok && r.reason).toContain('pitched')
})
test('sign text is cut and cleaned', () => {
  const r = validateRecipe({ sign: 'A VERY LONG SIGN INDEED\n\u0000' })
  expect(r.ok && r.recipe.sign).toBe('A VERY LONG SIGN')
})
test('bigger buildings take more work', () => {
  const small = validateRecipe({}); const big = validateRecipe({ footprint: '3', floors: '3' })
  expect(small.ok && workUnits(small.recipe)).toBe(2)
  expect(big.ok && workUnits(big.recipe)).toBe(10)
})
test('cleanText', () => { expect(cleanText('  hi\tthere\u0007 ', 5)).toBe('hi th') })

// tests/world/sites.test.ts
import { createWorld } from '../../src/world/world.ts'
import { candidateSites, isFree, footprintTiles } from '../../src/world/sites.ts'
test('sites are few, uniquely named, free and repeatable', () => {
  const w = createWorld(1); const sites = candidateSites(w)
  expect(sites.length).toBeGreaterThan(0); expect(sites.length).toBeLessThanOrEqual(6)
  expect(new Set(sites.map(s => s.name)).size).toBe(sites.length)
  for (const s of sites) expect(isFree(w, s.at, s.maxFootprint)).toBe(true)
  expect(candidateSites(createWorld(1))).toEqual(sites)
})
test('a site taken by a building is no longer offered', () => {
  const w = createWorld(1); const s = candidateSites(w)[0]
  w.buildings.push({ id: 'b1', name: 'x', purpose: 'home', about: '', at: s.at, workLeft: 0, workTotal: 2,
    startedDay: 1, recipe: { footprint: 1, floors: 1, wall: 'cream', roof: 'flat', roofColour: 'red',
      door: true, windows: 0, sign: '', extras: [] } })
  expect(candidateSites(w).some(c => c.at.x === s.at.x && c.at.y === s.at.y)).toBe(false)
})
test('footprint tiles and the plot edge', () => {
  expect(footprintTiles({ x: 2, y: 3 }, 2)).toHaveLength(4)
  expect(isFree(createWorld(1), { x: 23, y: 23 }, 2)).toBe(false)
})
```

- [ ] **Step 2: Run** `npx vitest run tests/shared tests/world/sites.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: building kit and building sites"`

---

### Task 4: The seam: manifest, observe, act

**Files:**
- Create: `src/world/seam.ts`
- Test: `tests/world/seam.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:

```ts
export type ParamSpec = { values?: string[]; hint?: string; role?: 'words' }
export type MoveSpec = { name: string; label: string; description: string
  params: Record<string, ParamSpec>; tier: 'origin' | 'inhabitant' }
export type Manifest = { protocol: 'seedlings/1'; name: string; description: string
  glossary: string[]; stance: string; moves: MoveSpec[] }
export type Observation = {
  self: { name: string; doing: string; asleep: boolean; mood: number
    needs: { hunger: { level: number; urgency: Urgency }; rest: { level: number; urgency: Urgency } } }
  clock: string; environment: string; room: string; body: string
  recentEvents: string[]                                   // newest 8, oldest first
  available: { name: string; params: Record<string, string[]> }[]   // choices true right now
  cannot: string[]                                         // "sleep: you are not tired"
}
export type { Act } from '../shared/types.ts'
export type ActResult = { success: boolean; message: string; moodDelta: number; minutes: number; label: string }
export function manifest(): Manifest
export function observe(world: World, characterId: string): Observation
export function act(world: World, characterId: string, move: Act): ActResult   // mutates the world
```

- `manifest().stance` is exactly `Nobody tells you what to do with your day.`
- Moves, all tier `origin` except where marked (I): `move_to` (I), `eat` (I), `sleep` (I), `look_at` (I), `speak` (I), `wait` (I), `start_building`, `work_on`, `change_building`, `pull_down`.
- Targets are names, never ids. `move_to` also accepts `wander`.
- On offer rules: `eat` needs hunger ≥ 0.15. `sleep` needs tiredness ≥ 0.3 or night. `work_on` needs an unfinished building. `start_building` needs fewer than 2 unfinished buildings and at least one site. `change_building` needs a finished building. `pull_down` needs any building. Anything off offer appears in `cannot` with a short reason.
- `eat` targets: the berry bush and finished `food` buildings. `sleep` targets: the hollow tree and finished `home` buildings.
- `start_building` params: `site` (site names), `purpose` (`home|food|other`), the recipe keys of Task 3, and hint-only `name` (cleaned to 30 characters) and `about` (cleaned to 80).
- `change_building` params: `target` (finished buildings) and any of `wall`, `roof`, `roof_colour`, `sign`; other recipe values are kept.
- `ActResult.label` is the move's label with its target, e.g. `eating at the berry bush`, `working on First House`. For an unknown move it is `trying to <action>`.
- `act` adds `moodDelta` to the character's mood (clamped) and, for `speak`, sets `said` and `saidAt`.
- Walking distance is the Manhattan distance from the character's tile to the target's tile, and the character ends on the target's tile.
- Minutes: walking 3 per tile (Manhattan) and added to any targeted move; `wander` goes to a random tile within 5; `eat` 20; `look_at` 5; `start_building` 30; `work_on` 60 and `workLeft` −1; `change_building` 30; `pull_down` 45; `speak` 2; `wait` 15. `act` sets `busyUntil = world.minutes + minutes`, `doing` to the move's label, and adds an event in the third person.
- Mood: `eat` +0.2 when hunger ≥ 0.6 else +0.05, and hunger becomes 0.05. `work_on` +0.03, or +0.3 when it finishes the building. Any refusal −0.05. `sleep` sets `asleep` and has no mood change (waking gives +0.1 in Task 2).
- `act` refuses, never throws, for: an unknown move, a move not on offer, a target or value not among the current choices, a busy or sleeping character, an invalid recipe. The message is a plain sentence.
- `room` reads like `Places and things: the berry bush, a short walk away; the pond, a walk away. In arm's reach: nothing.` Distance words: ≤1 `in arm's reach`, ≤3 `a few steps away`, ≤7 `a short walk away`, ≤14 `a walk away`, else `across the plot`. Unfinished buildings are described as `the building site for <name>`.
- `environment` is `<partOfDay>, <rain word>.` with rain words `dry`, `a thin rain`, `raining hard`, `a storm`.
- `body` lists non-satisfied needs, e.g. `hunger mild, rest strong`, or `comfortable`.

- [ ] **Step 1: Write the failing tests**

```ts
import { createWorld, character, advance, PIP_ID } from '../../src/world/world.ts'
import { manifest, observe, act } from '../../src/world/seam.ts'
const names = (o: ReturnType<typeof observe>) => o.available.map(a => a.name)

test('the manifest carries the stance and ten moves', () => {
  expect(manifest().stance).toBe('Nobody tells you what to do with your day.')
  expect(manifest().moves).toHaveLength(10)
})
test('on day one Pip can start a building but has nothing to work on', () => {
  const o = observe(createWorld(1), PIP_ID)
  expect(names(o)).toContain('start_building')
  expect(names(o)).not.toContain('work_on')
  expect(o.cannot.some(c => c.startsWith('work_on'))).toBe(true)
  expect(o.clock).toBe('06:00, day 1')
  expect(o.environment).toBe('Early morning, dry.')
})
test('observations never leak ids', () => {
  const text = JSON.stringify(observe(createWorld(1), PIP_ID))
  expect(text).not.toMatch(/berry_bush|hollow_tree|"pip"/)
})
test('eating walks there, takes time, fills Pip up and is recorded', () => {
  const w = createWorld(1); character(w, PIP_ID).body.hunger = 0.7
  const r = act(w, PIP_ID, { action: 'eat', params: { target: 'the berry bush' } })
  expect(r).toMatchObject({ success: true, moodDelta: 0.2 })
  expect(r.minutes).toBe(20 + 3 * 7)                       // (12,12) to (8,9) is 7 tiles
  expect(character(w, PIP_ID).body.hunger).toBeCloseTo(0.05)
  expect(character(w, PIP_ID).busyUntil).toBe(w.minutes + r.minutes)
  expect(w.events.at(-1)!.text).toContain('Pip')
})
test('a building goes from site to finished', () => {
  const w = createWorld(1); const site = observe(w, PIP_ID).available
    .find(a => a.name === 'start_building')!.params.site[0]
  const started = act(w, PIP_ID, { action: 'start_building',
    params: { site, purpose: 'home', name: 'First House', about: 'somewhere to be' } })
  expect(started.success).toBe(true)
  expect(w.buildings[0]).toMatchObject({ name: 'First House', purpose: 'home', workLeft: 2, workTotal: 2 })
  advance(w, started.minutes)
  const one = act(w, PIP_ID, { action: 'work_on', params: { target: 'First House' } })
  expect(one.moodDelta).toBeCloseTo(0.03); advance(w, one.minutes)
  const two = act(w, PIP_ID, { action: 'work_on', params: { target: 'First House' } })
  expect(two.moodDelta).toBeCloseTo(0.3)
  expect(w.buildings[0].workLeft).toBe(0)
  advance(w, two.minutes); character(w, PIP_ID).body.tiredness = 0.5
  const o = observe(w, PIP_ID)
  expect(o.available.find(a => a.name === 'sleep')?.params.target ?? []).toContain('First House')
})
test('a third building site is refused while two are unfinished', () => {
  const w = createWorld(1)
  for (let i = 0; i < 2; i++) {
    const site = observe(w, PIP_ID).available.find(a => a.name === 'start_building')!.params.site[0]
    const r = act(w, PIP_ID, { action: 'start_building', params: { site, purpose: 'other', name: `B${i}` } })
    advance(w, r.minutes)
  }
  expect(names(observe(w, PIP_ID))).not.toContain('start_building')
})
test('a finished building can be changed, keeping what was not mentioned', () => {
  const w = createWorld(1)
  const site = observe(w, PIP_ID).available.find(a => a.name === 'start_building')!.params.site[0]
  advance(w, act(w, PIP_ID, { action: 'start_building', params: { site, purpose: 'other', name: 'Hut', floors: '2' } }).minutes)
  w.buildings[0].workLeft = 0
  expect(act(w, PIP_ID, { action: 'change_building', params: { target: 'Hut', wall: 'blue', sign: 'HUT' } }).success).toBe(true)
  expect(w.buildings[0].recipe).toMatchObject({ wall: 'blue', sign: 'HUT', floors: 2, roof: 'pitched' })
})
test('pulling a building down removes it', () => {
  const w = createWorld(1)
  const site = observe(w, PIP_ID).available.find(a => a.name === 'start_building')!.params.site[0]
  advance(w, act(w, PIP_ID, { action: 'start_building', params: { site, purpose: 'other', name: 'Shed' } }).minutes)
  expect(act(w, PIP_ID, { action: 'pull_down', params: { target: 'Shed' } }).success).toBe(true)
  expect(w.buildings).toHaveLength(0)
})
// Review Focus 2
test.each([
  [{ action: 'fly', params: {} }],
  [{ action: 'work_on', params: { target: 'nothing' } }],
  [{ action: 'eat', params: { target: 'the pond' } }],
  [{ action: 'start_building', params: { site: 'the moon', purpose: 'home' } }],
  [{ action: 'start_building', params: { site: 'the middle of the plot', purpose: 'home', roof: 'thatched' } }],
])('a move that is not on offer is refused in words: %j', (move) => {
  const w = createWorld(1); const before = JSON.stringify(w.buildings)
  const r = act(w, PIP_ID, move)
  expect(r.success).toBe(false); expect(r.moodDelta).toBe(-0.05)
  expect(r.message.length).toBeGreaterThan(5)
  expect(JSON.stringify(w.buildings)).toBe(before)
})
test('a busy or sleeping character cannot act', () => {
  const w = createWorld(1)
  act(w, PIP_ID, { action: 'wait', params: {} })
  expect(act(w, PIP_ID, { action: 'wait', params: {} }).success).toBe(false)
  advance(w, 15); character(w, PIP_ID).asleep = true
  expect(act(w, PIP_ID, { action: 'wait', params: {} }).success).toBe(false)
})
test('speech is cleaned and remembered on the character', () => {
  const w = createWorld(1)
  act(w, PIP_ID, { action: 'speak', params: { text: 'hello\u0000 plot' } })
  expect(character(w, PIP_ID).said).toBe('hello plot')
})
```

- [ ] **Step 2: Run** `npx vitest run tests/world/seam.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/world/seam.ts`. Keep one table of moves, each with its spec, an `offer(world, character)` function returning choices or a reason, and a `perform` function; `manifest`, `observe` and `act` all read that one table.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: manifest, observe and act"`

---

### Task 5: The store

**Files:**
- Create: `src/store/store.ts`
- Test: `tests/store/store.test.ts`

**Interfaces:**
- Consumes: `World`.
- Produces:

```ts
export type MemoryKind = 'person' | 'work' | 'fact' | 'moment'
export type MindKind = 'want' | 'worry' | 'question' | 'promise'
export type TurnRow = { id: number; characterId: string; kind: 'turn' | 'reflection'; realTs: number
  worldMinutes: number; observation: string; systemPrompt: string; userPrompt: string; rawReply: string
  decision: string; results: string; model: string; allowance: number; inputTokens: number; outputTokens: number }
export type Memory = { id: number; characterId: string; text: string; kind: MemoryKind; strength: number
  recalled: number; sinceMinutes: number; lastRecalledMinutes: number }
export type Belief = { characterId: string; key: string; text: string; evidence: number }
export type MindItem = { id: number; characterId: string; kind: MindKind; text: string; sinceMinutes: number }
export type DiaryEntry = { id: number; characterId: string; worldMinutes: number; text: string
  fromTurn: number; toTurn: number }
export type Store = {
  saveWorld(w: World): void; loadWorld(): World | null
  addTurn(t: Omit<TurnRow, 'id'>): number; getTurn(id: number): TurnRow | null
  setTurnResults(id: number, results: string): void       // queued moves add their results later
  turnsBetween(characterId: string, fromId: number, toId: number): TurnRow[]   // kind 'turn' only, inclusive
  lastTurnId(characterId: string): number                                      // 0 when none
  addMemory(m: { characterId: string; text: string; kind: MemoryKind; sinceMinutes: number }): number
  memories(characterId: string): Memory[]
  touchMemories(ids: number[], minutes: number): void      // recalled +1, lastRecalledMinutes set
  strengthen(ids: number[]): void                          // strength +1
  dropMemories(ids: number[]): void
  bumpBelief(characterId: string, key: string, text: string): void             // evidence +1, inserts at 1
  beliefs(characterId: string): Belief[]                                       // most evidence first
  addMindItem(i: { characterId: string; kind: MindKind; text: string; sinceMinutes: number }): number
  openMindItems(characterId: string): MindItem[]                               // newest first
  closeMindItems(ids: number[]): void
  addDiary(e: Omit<DiaryEntry, 'id'>): number
  diary(characterId: string, limit: number, beforeId?: number): DiaryEntry[]   // newest first
  diaryEntry(id: number): DiaryEntry | null
  addSpend(ts: number, characterId: string, amount: number): void
  spentBetween(fromTs: number, toTs: number): number
  averageSpend(lastN: number): number                                          // 0 when none
  getFlag(key: string): string | null; setFlag(key: string, value: string | null): void
  close(): void
}
export function openStore(path: string): Store            // ':memory:' for tests; creates the folder and schema
```

- The world is stored as one JSON row. New memories start at strength 1, recalled 0.

- [ ] **Step 1: Write the failing tests**

```ts
import { openStore } from '../../src/store/store.ts'
import { createWorld } from '../../src/world/world.ts'
const turn = (over = {}) => ({ characterId: 'pip', kind: 'turn' as const, realTs: 1, worldMinutes: 400,
  observation: '{}', systemPrompt: 's', userPrompt: 'u', rawReply: 'r', decision: '{}', results: '[]',
  model: 'm', allowance: 0.01, inputTokens: 10, outputTokens: 5, ...over })

test('a world survives being saved and loaded', () => {
  const s = openStore(':memory:'); expect(s.loadWorld()).toBeNull()
  const w = createWorld(4); s.saveWorld(w); expect(s.loadWorld()).toEqual(w)
})
test('turns are kept in full and reflections are left out of ranges', () => {
  const s = openStore(':memory:')
  const a = s.addTurn(turn()); s.addTurn(turn({ kind: 'reflection' })); const c = s.addTurn(turn())
  expect(s.getTurn(a)).toMatchObject({ id: a, rawReply: 'r', allowance: 0.01 })
  s.setTurnResults(a, '[1]'); expect(s.getTurn(a)!.results).toBe('[1]')
  expect(s.turnsBetween('pip', a, c).map(t => t.id)).toEqual([a, c])
  expect(s.lastTurnId('pip')).toBe(c); expect(s.lastTurnId('nobody')).toBe(0)
})
test('memories are touched, strengthened and dropped', () => {
  const s = openStore(':memory:')
  const id = s.addMemory({ characterId: 'pip', text: 'the pond is cold', kind: 'fact', sinceMinutes: 400 })
  s.touchMemories([id], 500); s.strengthen([id])
  expect(s.memories('pip')[0]).toMatchObject({ strength: 2, recalled: 1, lastRecalledMinutes: 500 })
  s.dropMemories([id]); expect(s.memories('pip')).toEqual([])
})
test('beliefs gather evidence', () => {
  const s = openStore(':memory:')
  s.bumpBelief('pip', 'eat:lifts', 'Eating lifts me.'); s.bumpBelief('pip', 'eat:lifts', 'Eating lifts me.')
  expect(s.beliefs('pip')).toEqual([{ characterId: 'pip', key: 'eat:lifts', text: 'Eating lifts me.', evidence: 2 }])
})
test('mind items open and close', () => {
  const s = openStore(':memory:')
  const id = s.addMindItem({ characterId: 'pip', kind: 'want', text: 'a roof', sinceMinutes: 400 })
  expect(s.openMindItems('pip')).toHaveLength(1); s.closeMindItems([id]); expect(s.openMindItems('pip')).toEqual([])
})
test('diary pages newest first', () => {
  const s = openStore(':memory:')
  const a = s.addDiary({ characterId: 'pip', worldMinutes: 400, text: 'one', fromTurn: 1, toTurn: 2 })
  const b = s.addDiary({ characterId: 'pip', worldMinutes: 800, text: 'two', fromTurn: 3, toTurn: 4 })
  expect(s.diary('pip', 10).map(e => e.id)).toEqual([b, a])
  expect(s.diary('pip', 10, b).map(e => e.id)).toEqual([a])
  expect(s.diaryEntry(a)!.text).toBe('one')
})
test('the ledger sums and averages', () => {
  const s = openStore(':memory:'); expect(s.averageSpend(5)).toBe(0)
  s.addSpend(100, 'pip', 0.02); s.addSpend(200, 'pip', 0.04)
  expect(s.spentBetween(0, 150)).toBeCloseTo(0.02); expect(s.averageSpend(5)).toBeCloseTo(0.03)
})
test('flags', () => {
  const s = openStore(':memory:'); expect(s.getFlag('halt')).toBeNull()
  s.setFlag('halt', 'x'); expect(s.getFlag('halt')).toBe('x'); s.setFlag('halt', null); expect(s.getFlag('halt')).toBeNull()
})
```

- [ ] **Step 2: Run** `npx vitest run tests/store`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/store/store.ts` with `better-sqlite3`, WAL mode, prepared statements.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: sqlite store for world, turns, memory, diary and ledger"`

---

### Task 6: The model client and its stand-in

**Files:**
- Create: `src/model/client.ts`, `src/model/scripted.ts`, `scripts/smoke.ts`
- Test: `tests/model/client.test.ts`

**Interfaces:**
- Produces:

```ts
// src/model/client.ts
export type ModelRequest = { model: string; system: string; user: string; sessionId: string; maxTokens: number }
export type ModelUsage = { allowance: number | null; inputTokens: number; outputTokens: number; billingSource: string | null }
export type ModelReply = { text: string; usage: ModelUsage }
export interface ModelClient { complete(req: ModelRequest): Promise<ModelReply> }
export class ModelError extends Error { status: number | null; retryAfterMs: number | null }
export function openAiClient(opts: { baseUrl: string; apiKey: string; userAgent: string; jsonMode: boolean
  fetch?: typeof fetch; timeoutMs?: number }): ModelClient

// src/model/scripted.ts
export type Scripted = string | Error | ((req: ModelRequest) => string)
export function scriptedClient(replies: Scripted[], loop?: boolean): ModelClient & { requests: ModelRequest[] }
```

- `openAiClient` POSTs to `${baseUrl}/chat/completions` with `{ model, messages: [system, user], max_tokens }`, plus `response_format: { type: 'json_object' }` when `jsonMode`. Timeout default 60000 ms.
- Usage is read from `usage.prompt_tokens`, `usage.completion_tokens`, `usage.opencode.allowance`, `usage.opencode.billing_source`. Missing `opencode` gives `allowance: null`, `billingSource: null`.
- Any non-2xx, timeout, network error or reply without `choices[0].message.content` throws `ModelError`. `retryAfterMs` comes from a `Retry-After` header in seconds.
- `scriptedClient` returns replies in order with usage `{ allowance: 0.01, inputTokens: 100, outputTokens: 20, billingSource: 'go' }`, throws when an entry is an `Error`, and throws `ModelError` when the script runs out unless `loop`.

- [ ] **Step 1: Write the failing tests**

```ts
import { openAiClient, ModelError } from '../../src/model/client.ts'
import { scriptedClient } from '../../src/model/scripted.ts'
const req = { model: 'glm-5.2', system: 'sys', user: 'usr', sessionId: 'pip', maxTokens: 300 }
const ok = (body: unknown, init: ResponseInit = {}) =>
  (async () => new Response(JSON.stringify(body), { status: 200, ...init })) as unknown as typeof fetch

test('sends the right request and identifies itself', async () => {
  let seen: { url: string; init: RequestInit } | undefined
  const f = (async (url: string, init: RequestInit) => { seen = { url, init }
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"do":[]}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 3, opencode: { allowance: 0.004, billing_source: 'go' } } }))
  }) as unknown as typeof fetch
  const c = openAiClient({ baseUrl: 'https://x/v1', apiKey: 'K', userAgent: 'seedlings-town/0.1', jsonMode: true, fetch: f })
  const r = await c.complete(req)
  expect(seen!.url).toBe('https://x/v1/chat/completions')
  const h = new Headers(seen!.init.headers)
  expect(h.get('authorization')).toBe('Bearer K')
  expect(h.get('user-agent')).toBe('seedlings-town/0.1')
  expect(h.get('x-opencode-session')).toBe('pip')
  const body = JSON.parse(seen!.init.body as string)
  expect(body).toMatchObject({ model: 'glm-5.2', max_tokens: 300, response_format: { type: 'json_object' } })
  expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user'])
  expect(r).toEqual({ text: '{"do":[]}', usage: { allowance: 0.004, inputTokens: 12, outputTokens: 3, billingSource: 'go' } })
})
test('another provider without the opencode block still works', async () => {
  const c = openAiClient({ baseUrl: 'https://x/v1', apiKey: 'K', userAgent: 'u', jsonMode: false,
    fetch: ok({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) })
  expect((await c.complete(req)).usage).toMatchObject({ allowance: null, billingSource: null })
})
test('errors carry status and retry-after', async () => {
  const f = (async () => new Response('slow down', { status: 429, headers: { 'retry-after': '30' } })) as unknown as typeof fetch
  const c = openAiClient({ baseUrl: 'https://x/v1', apiKey: 'K', userAgent: 'u', jsonMode: true, fetch: f })
  await expect(c.complete(req)).rejects.toMatchObject({ status: 429, retryAfterMs: 30000 })
})
test('a reply with no content is an error, not an empty string', async () => {
  const c = openAiClient({ baseUrl: 'https://x/v1', apiKey: 'K', userAgent: 'u', jsonMode: true, fetch: ok({ choices: [] }) })
  await expect(c.complete(req)).rejects.toBeInstanceOf(ModelError)
})
test('a hung request times out', async () => {
  const f = ((_: string, init: RequestInit) => new Promise((_, rej) =>
    init.signal!.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch
  const c = openAiClient({ baseUrl: 'https://x/v1', apiKey: 'K', userAgent: 'u', jsonMode: true, fetch: f, timeoutMs: 20 })
  await expect(c.complete(req)).rejects.toBeInstanceOf(ModelError)
})
test('the stand-in replays its script and remembers requests', async () => {
  const c = scriptedClient(['a', new ModelError('down'), (r) => r.sessionId])
  expect((await c.complete(req)).text).toBe('a')
  await expect(c.complete(req)).rejects.toBeInstanceOf(ModelError)
  expect((await c.complete(req)).text).toBe('pip')
  await expect(c.complete(req)).rejects.toBeInstanceOf(ModelError)
  expect(c.requests).toHaveLength(4)
})
```

- [ ] **Step 2: Run** `npx vitest run tests/model`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Write `scripts/smoke.ts`.** It loads the config, makes one real request (`system`: `Reply with JSON only.`, `user`: `{"say":"hi"} — repeat this back.`, session `smoke`), and prints the reply text and the full usage object. It is run by hand in Task 12, not in tests.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: model client and scripted stand-in"`

---

### Task 7: The budget keeper

**Files:**
- Create: `src/budget/keeper.ts`
- Test: `tests/budget/keeper.test.ts`

**Interfaces:**
- Consumes: `Store` ledger and flag methods, `ModelUsage`.
- Produces:

```ts
export type BudgetSettings = { monthlyAllowance: number; periodStartDay: number
  minIntervalMs: number; maxIntervalMs: number; fallbackInputPerM: number; fallbackOutputPerM: number
  seedCost: number }
export const DEFAULT_PACING = { minIntervalMs: 60_000, maxIntervalMs: 3_600_000,
  fallbackInputPerM: 1.4, fallbackOutputPerM: 4.4, seedCost: 0.02 }
export type BudgetReason = 'ok' | 'day_share_spent' | 'five_hour_limit' | 'weekly_limit' | 'month_spent' | 'charged_to_balance'
export type BudgetStatus = { canThink: boolean; reason: BudgetReason; resumeAt: number | null
  leftTodayFraction: number; intervalMs: number }
export type BudgetKeeper = { record(characterId: string, usage: ModelUsage): void; status(): BudgetStatus; clearHalt(): void }
export function createBudgetKeeper(store: Store, settings: BudgetSettings, now: () => number): BudgetKeeper
```

- Days are UTC days. The period starts at 00:00 UTC on `periodStartDay` of the month, on or before today.
- Cost of a usage: `allowance` when not null, otherwise tokens at the fallback prices.
- Today's share = (monthly − spent in this period before today) ÷ days left in the period, counting today. `leftTodayFraction` = (share − spent today) ÷ share, clamped 0..1.
- Typical cost = `averageSpend(20)`, or `seedCost` when that is 0.
- Turns left today = `Math.floor(leftToday / typicalCost + 1e-9)`. `intervalMs` = `Math.floor(time left in today ÷ turns left)`, clamped to min and max.
- Checks in order: halt flag → `charged_to_balance`, `resumeAt` null. Period spent ≥ monthly → `month_spent`, resume at next period start. Last 7 days + typical cost > 50% of monthly → `weekly_limit`. Last 5 hours + typical cost > 20% of monthly → `five_hour_limit`. Left today < typical cost → `day_share_spent`, resume at next UTC midnight. The two rolling limits resume one hour later.
- `record` writes to the ledger. If `usage.billingSource === 'balance'` it also sets flag `halt` to `charged_to_balance`. `clearHalt` removes the flag.

- [ ] **Step 1: Write the failing tests**

```ts
import { openStore } from '../../src/store/store.ts'
import { createBudgetKeeper, DEFAULT_PACING } from '../../src/budget/keeper.ts'
const DAY = 86_400_000
const t0 = Date.UTC(2026, 10, 1, 0, 0, 0)                     // 1 Nov 2026, 30-day month
const make = (now: { t: number }) => { const store = openStore(':memory:')
  return { store, k: createBudgetKeeper(store, { monthlyAllowance: 60, periodStartDay: 1, ...DEFAULT_PACING }, () => now.t) } }
const used = (allowance: number, billingSource = 'go') => ({ allowance, inputTokens: 0, outputTokens: 0, billingSource })

test('a fresh month gives a thirtieth per day and paces by the seed cost', () => {
  const now = { t: t0 }; const { k } = make(now); const s = k.status()
  expect(s).toMatchObject({ canThink: true, reason: 'ok', leftTodayFraction: 1 })
  expect(s.intervalMs).toBe(DAY / 100)                         // 2.00 share / 0.02 seed cost = 100 turns
})
test('spending shrinks today and stretches the interval', () => {
  const now = { t: t0 + DAY / 2 }; const { k } = make(now)
  for (let i = 0; i < 50; i++) k.record('pip', used(0.02))
  const s = k.status()
  expect(s.leftTodayFraction).toBeCloseTo(0.5)
  expect(s.intervalMs).toBe((DAY / 2) / 50)
})
test('when the day share is gone the town sleeps until midnight', () => {
  const now = { t: t0 + 1000 }; const { k } = make(now)
  for (let i = 0; i < 100; i++) k.record('pip', used(0.02))
  expect(k.status()).toMatchObject({ canThink: false, reason: 'day_share_spent', resumeAt: t0 + DAY })
})
test('unspent share carries over to the remaining days', () => {
  const now = { t: t0 + 10 * DAY }; const { k } = make(now)    // nothing spent in ten days
  expect(k.status().intervalMs).toBe(Math.max(60_000, Math.floor(DAY / 150)))  // 60 / 20 days = 3.00 a day
})
test('the five hour limit holds even if the day share allows more', () => {
  const now = { t: t0 + 20 * DAY }; const { store, k } = make(now)
  store.addSpend(now.t - 3_600_000, 'pip', 11.99)
  expect(k.status()).toMatchObject({ canThink: false, reason: 'five_hour_limit', resumeAt: now.t + 3_600_000 })
})
test('the weekly limit', () => {
  const now = { t: t0 + 20 * DAY }; const { store, k } = make(now)
  store.addSpend(now.t - 2 * DAY, 'pip', 29.99)
  expect(k.status().reason).toBe('weekly_limit')
})
test('a spent month waits for the next period', () => {
  const now = { t: t0 + 20 * DAY }; const { store, k } = make(now)
  store.addSpend(t0 + DAY, 'pip', 60)
  expect(k.status()).toMatchObject({ canThink: false, reason: 'month_spent', resumeAt: Date.UTC(2026, 11, 1) })
})
test('without an allowance figure, cost is estimated from tokens', () => {
  const now = { t: t0 }; const { store, k } = make(now)
  k.record('pip', { allowance: null, inputTokens: 1_000_000, outputTokens: 0, billingSource: null })
  expect(store.spentBetween(0, now.t + 1)).toBeCloseTo(1.4)
})
// Review Focus 4
test('being charged to balance halts thinking until cleared, across restarts', () => {
  const now = { t: t0 }; const { store, k } = make(now)
  k.record('pip', used(0.02, 'balance'))
  expect(k.status()).toMatchObject({ canThink: false, reason: 'charged_to_balance', resumeAt: null })
  const again = createBudgetKeeper(store, { monthlyAllowance: 60, periodStartDay: 1, ...DEFAULT_PACING }, () => now.t)
  expect(again.status().canThink).toBe(false)
  again.clearHalt(); expect(again.status().canThink).toBe(true)
})
test('the interval is clamped', () => {
  const now = { t: t0 + DAY - 5000 }; const { k } = make(now)
  expect(k.status().intervalMs).toBe(60_000)
})
```

- [ ] **Step 2: Run** `npx vitest run tests/budget`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/budget/keeper.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: budget keeper with daily share and rolling limits"`

---

### Task 8: The mind: sheet, prompt, decision, memory, reflection

**Files:**
- Create: `src/mind/sheet.ts`, `src/mind/prompt.ts`, `src/mind/decision.ts`, `src/mind/memory.ts`, `src/mind/reflect.ts`
- Test: `tests/mind/prompt.test.ts`, `tests/mind/decision.test.ts`, `tests/mind/memory.test.ts`, `tests/mind/reflect.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `Observation`, `Act`, `ActResult` (Task 4); `Memory`, `Belief`, `MindItem`, `TurnRow`, `MemoryKind`, `MindKind`, `Store` (Task 5).
- Produces:

```ts
// sheet.ts
export type Sheet = { name: string; you: string; core: string; traits: string[]; values: string[]; fears: string[] }
export const PIP_SHEET: Sheet

// prompt.ts
export function systemPrompt(m: Manifest, o: Observation, sheet: Sheet): string
export function whatISee(o: Observation, recalled: Memory[], beliefs: Belief[], loudest: MindItem[]): string

// decision.ts
export type Decision = { consider: string; moves: Act[]; because: string
  remember: { text: string; kind: MemoryKind } | null }
export function readDecision(text: string): Decision | null
export const WAIT: Decision                                   // one move: wait

// memory.ts
export function recall(memories: Memory[], o: Observation, n: number): Memory[]
export function beliefFor(result: ActResult): { key: string; text: string } | null
export function tidyMemories(store: Store, characterId: string, recalledToday: number[], cap: number): void

// reflect.ts
export type Reflection = { diary: string; memories: { text: string; kind: MemoryKind }[]
  mind: { kind: MindKind; text: string }[]; done: number[] }
export function reflectionPrompt(sheet: Sheet, clock: string, turns: TurnRow[], open: MindItem[],
  endOfDay: boolean): { system: string; user: string }
export function readReflection(text: string): Reflection | null
export function shouldReflect(i: { minutesSinceLast: number; turnsSinceLast: number
  buildingFinished: boolean; goingToSleep: boolean }): boolean
```

- `PIP_SHEET` copies the spec's draft sheet verbatim: `you` is `a seedling`; `core` is the two paragraphs plus `Nobody tells you what to do with your day. Building the town is something you want, not your whole self.`; traits, values and fears as listed in the spec.
- `systemPrompt` opens `You are <name>, <you>.` and lists each move as `- <name>: <description>` with its current choices indented beneath.
- `whatISee` opens `THE TIME: <clock>. <environment>`.
- `systemPrompt` follows the shape of Pino's public prompt: who you are (sheet), where you are (manifest description and glossary), the stance, then `WHAT YOU CAN DO:` listing only `o.available` moves with their current choices, then the reply format:
  `{"consider": "...", "do": [{"action": "<name>", "params": {...}}], "because": "...", "remember": {"text": "...", "kind": "person|work|fact|moment"}}`, with `do` holding one to three moves and `remember` optional.
- `whatISee` sections, each omitted when empty: `THE TIME`, `THE PLACE`, `EARLIER`, `YOU REMEMBER`, `YOU HAVE LEARNED` (top 5 beliefs), `ON YOUR MIND` (loudest), `YOUR BODY`, ending `What do you do? It's your call. JSON only.`
- `readDecision`: accepts JSON optionally wrapped in a code fence or surrounded by prose (first `{` to last `}`). Keeps at most 3 moves. Drops moves without a string `action`. Coerces param values to strings. Returns null when not JSON or no moves remain. It does not check moves against what is on offer; the world does that.
- `recall`: score = strength × (1 + number of distinct words of 4+ letters shared with `o.room`, `o.recentEvents` and `o.body`), ties to the more recent; top `n`.
- `beliefFor`: on success with moodDelta ≥ 0.05 → key `<label>:lifts`, text `<Label> lifts me.`; success with moodDelta ≤ −0.05 → `<label>:winds`, `<Label> winds me up.`; failure → `<label>:wrong`, `<Label> keeps going wrong.`; otherwise null.
- `tidyMemories`: strengthens `recalledToday`, then drops the weakest (lowest strength, then oldest) beyond `cap`.
- `shouldReflect`: true when `goingToSleep && turnsSinceLast >= 1`, or `buildingFinished`, or `minutesSinceLast >= 240 && turnsSinceLast >= 3`.
- `reflectionPrompt` gives the sheet, the clock, each turn as `time — what you thought — what you did — what happened`, and open mind items with their ids. It asks for JSON `{"diary": "...", "memories": [...], "mind": [...], "done": [ids]}`: a diary entry in Pip's own voice of at most 80 words, at most 3 memories, at most 3 new mind items, and ids of items now settled. `endOfDay` asks for an entry about the whole day.
- `readReflection` uses the same lenient JSON reading; null when there is no non-empty `diary`. Lists are capped at 3 and filtered to valid kinds.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/mind/prompt.test.ts
import { createWorld, PIP_ID } from '../../src/world/world.ts'
import { manifest, observe } from '../../src/world/seam.ts'
import { systemPrompt, whatISee } from '../../src/mind/prompt.ts'
import { PIP_SHEET } from '../../src/mind/sheet.ts'
test('the sheet gives temperament and no interests', () => {
  expect(PIP_SHEET.you).toBe('a seedling')
  expect(PIP_SHEET.traits).toContain('quick to attach')
  expect(PIP_SHEET.fears).toContain('an empty town')
})
test('only moves on offer are in the prompt', () => {
  const o = observe(createWorld(1), PIP_ID); const p = systemPrompt(manifest(), o, PIP_SHEET)
  expect(p).toContain('You are Pip, a seedling')
  expect(p).toContain('Nobody tells you what to do with your day.')
  expect(p).toContain('- start_building'); expect(p).not.toContain('work_on')
  expect(p).toContain(o.available.find(a => a.name === 'start_building')!.params.site[0])
})
test('empty sections are left out', () => {
  const o = observe(createWorld(1), PIP_ID); const text = whatISee(o, [], [], [])
  expect(text).toContain('THE TIME: 06:00, day 1'); expect(text).not.toContain('YOU REMEMBER')
  expect(text.trimEnd().endsWith('JSON only.')).toBe(true)
})

// tests/mind/decision.test.ts
import { readDecision } from '../../src/mind/decision.ts'
test('a plain decision', () => {
  expect(readDecision('{"consider":"hungry","do":[{"action":"eat","params":{"target":"the berry bush"}}],"because":"food"}'))
    .toEqual({ consider: 'hungry', moves: [{ action: 'eat', params: { target: 'the berry bush' } }], because: 'food', remember: null })
})
test('fences, prose, extra moves and odd values are tolerated', () => {
  const d = readDecision('Sure!\n```json\n{"do":[{"action":"wait"},{"action":"speak","params":{"text":5}},{"action":"wait"},{"action":"wait"},{"nope":1}],"remember":{"text":"cold pond","kind":"fact"}}\n```')
  expect(d!.moves).toHaveLength(3); expect(d!.moves[1].params.text).toBe('5')
  expect(d!.remember).toEqual({ text: 'cold pond', kind: 'fact' })
})
test.each(['', 'I think I will eat.', '{"do":[]}', '{"do":"eat"}', '[1,2]'])('unreadable: %s', (t) => {
  expect(readDecision(t)).toBeNull()
})

// tests/mind/memory.test.ts
import { recall, beliefFor } from '../../src/mind/memory.ts'
const mem = (id: number, text: string, strength = 1, since = 0) =>
  ({ id, characterId: 'pip', text, kind: 'fact' as const, strength, recalled: 0, sinceMinutes: since, lastRecalledMinutes: 0 })
test('recall prefers memories that share words with what is in front of Pip', () => {
  const o = { ...observe(createWorld(1), PIP_ID), room: 'the pond, a few steps away' }
  const got = recall([mem(1, 'the sky was grey'), mem(2, 'the pond is cold'), mem(3, 'strong one', 3)], o, 2)
  expect(got.map(m => m.id)).toEqual([3, 2])
})
test('beliefs come from how a move turned out', () => {
  const r = { success: true, message: '', moodDelta: 0.2, minutes: 1, label: 'eating at the berry bush' }
  expect(beliefFor(r)).toEqual({ key: 'eating at the berry bush:lifts', text: 'Eating at the berry bush lifts me.' })
  expect(beliefFor({ ...r, success: false, moodDelta: -0.05 })!.text).toBe('Eating at the berry bush keeps going wrong.')
  expect(beliefFor({ ...r, moodDelta: 0.03 })).toBeNull()
})

// tests/mind/reflect.test.ts
import { readReflection, shouldReflect } from '../../src/mind/reflect.ts'
test('when to reflect', () => {
  const base = { minutesSinceLast: 0, turnsSinceLast: 0, buildingFinished: false, goingToSleep: false }
  expect(shouldReflect(base)).toBe(false)
  expect(shouldReflect({ ...base, goingToSleep: true, turnsSinceLast: 1 })).toBe(true)
  expect(shouldReflect({ ...base, buildingFinished: true })).toBe(true)
  expect(shouldReflect({ ...base, minutesSinceLast: 240, turnsSinceLast: 3 })).toBe(true)
  expect(shouldReflect({ ...base, minutesSinceLast: 240, turnsSinceLast: 2 })).toBe(false)
})
test('a reflection is read leniently and capped', () => {
  const r = readReflection('{"diary":"Built a wall.","memories":[{"text":"a","kind":"work"},{"text":"b","kind":"nonsense"},{"text":"c","kind":"fact"},{"text":"d","kind":"fact"},{"text":"e","kind":"fact"}],"mind":[{"kind":"want","text":"a door"}],"done":[4,"x"]}')
  expect(r).toEqual({ diary: 'Built a wall.', memories: [{ text: 'a', kind: 'work' }, { text: 'c', kind: 'fact' }, { text: 'd', kind: 'fact' }],
    mind: [{ kind: 'want', text: 'a door' }], done: [4] })
  expect(readReflection('{"diary":""}')).toBeNull()
})
```

Also add a `tidyMemories` test to `tests/mind/memory.test.ts`: with an in-memory store holding 5 memories and `cap` 3, after `tidyMemories(store, 'pip', [idOfOldest], 3)` three remain and the oldest (now strength 2) is among them.

- [ ] **Step 2: Run** `npx vitest run tests/mind`. Expected: FAIL.
- [ ] **Step 3: Implement** the five modules. Share the lenient JSON reader between `decision.ts` and `reflect.ts` by exporting it from `decision.ts` as `readJson(text: string): unknown | null`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: Pip's mind: prompt, decision, memory and reflection"`

---

### Task 9: Turns and the scheduler

**Files:**
- Create: `src/town/turn.ts`, `src/town/scheduler.ts`, `tests/town/helpers.ts`
- Test: `tests/town/turn.test.ts`, `tests/town/scheduler.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:

```ts
// turn.ts
export type TownDeps = { world: World; store: Store; model: ModelClient; budget: BudgetKeeper
  config: Config; now: () => number }
export type TurnOutcome = { turnId: number; results: ActResult[]; wentToSleep: boolean; finishedBuilding: boolean }
export async function runTurn(deps: TownDeps, characterId: string): Promise<TurnOutcome>   // throws ModelError
export async function runReflection(deps: TownDeps, characterId: string, endOfDay: boolean): Promise<number | null>
export function performQueued(deps: TownDeps, characterId: string): TurnOutcome | null   // null when the queue is empty

// scheduler.ts
export type Scheduler = { step(realElapsedMs: number): Promise<void>; start(): void; stop(): void
  onChange(fn: () => void): () => void; lastThought(): string }
export function createScheduler(deps: TownDeps): Scheduler
```

- `runTurn`: observe → `recall` 5 memories and `touchMemories` → build prompts → `model.complete` with `model: config.pipModel`, `sessionId: characterId`, `maxTokens: 400` → `readDecision`. If null, ask once more with the same prompts; if still null use `WAIT`. Every model reply is passed to `budget.record` as soon as it arrives. Only the first move is acted now; the rest go into the character's `queue` with `queueTurn` set to this turn. Then: `bumpBelief` when the result has a belief, `addMemory` for `remember`, `addTurn` with everything, `saveWorld`.
- `performQueued`: acts the next queued move with no model call, bumps its belief, appends its result to the turn named by `queueTurn` with `setTurnResults`, and saves the world. A refusal empties the queue. This is how one thought becomes up to three moves.
- `runReflection`: takes the turns since the last diary entry's `toTurn`; returns null without calling the model when there are none. Calls the model with `maxTokens: 500`, records usage and a `reflection` row, and on a readable reply writes the diary entry, memories, mind items and closes `done`. When `endOfDay`, also calls `tidyMemories` with cap 200 and the ids recalled since the previous end-of-day reflection. An unreadable reply writes nothing and returns null.
- `step(realElapsedMs)`: elapsed is capped at `2 × config.tickMs`. Advances the world by `worldMinutesFor`. Then, if Pip is awake and not busy: when the queue is not empty, `performQueued` and nothing else this step. Otherwise, if `budget.status().canThink` and the next-think time has passed: `runTurn`, then `runReflection` when `shouldReflect` says so, then next-think = now + `status().intervalMs`. A `ModelError` sets next-think = now + backoff, where backoff is `retryAfterMs` or 60 s doubling per consecutive failure up to 30 min, and resets on success. Other errors are logged and treated the same. The world is saved every step and listeners are told.
- `start` runs `step` every `config.tickMs` with the measured elapsed time, never overlapping. `lastThought` is the `consider` of the latest turn.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/town/helpers.ts
import { createWorld } from '../../src/world/world.ts'
import { openStore } from '../../src/store/store.ts'
import { scriptedClient } from '../../src/model/scripted.ts'
import { createBudgetKeeper, DEFAULT_PACING } from '../../src/budget/keeper.ts'
import { loadConfig } from '../../src/config.ts'
export const deps = (replies: Parameters<typeof scriptedClient>[0], clock = { t: Date.UTC(2026, 10, 1) }) => {
  const store = openStore(':memory:'); const model = scriptedClient(replies)
  const config = loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_FAKE_MODEL: '1' })
  const budget = createBudgetKeeper(store, { monthlyAllowance: 60, periodStartDay: 1, ...DEFAULT_PACING }, () => clock.t)
  return { world: createWorld(1), store, model, budget, config, now: () => clock.t, clock }
}

// tests/town/turn.test.ts
import { advance, character, PIP_ID } from '../../src/world/world.ts'
import { runTurn, runReflection, performQueued } from '../../src/town/turn.ts'
import { ModelError } from '../../src/model/client.ts'
import { deps } from './helpers.ts'
const eat = '{"consider":"peckish","do":[{"action":"eat","params":{"target":"the berry bush"}}],"because":"food","remember":{"text":"the berries are sour","kind":"fact"}}'

test('a turn acts, records everything, remembers and spends', async () => {
  const d = deps([eat]); character(d.world, PIP_ID).body.hunger = 0.7
  const out = await runTurn(d, PIP_ID)
  expect(out.results[0].success).toBe(true)
  const row = d.store.getTurn(out.turnId)!
  expect(row.rawReply).toBe(eat); expect(row.systemPrompt).toContain('You are Pip')
  expect(JSON.parse(row.results)[0].success).toBe(true); expect(row.allowance).toBeCloseTo(0.01)
  expect(d.store.memories(PIP_ID)[0].text).toBe('the berries are sour')
  expect(d.store.beliefs(PIP_ID)[0].text).toContain('lifts me')
  expect(d.store.spentBetween(0, d.now() + 1)).toBeCloseTo(0.01)
  expect(d.store.loadWorld()!.characters[0].body.hunger).toBeCloseTo(0.05)
})
test('one thought can hold several moves; the later ones happen without thinking again', async () => {
  const d = deps(['{"do":[{"action":"look_at","params":{"target":"the pond"}},{"action":"speak","params":{"text":"cold"}},{"action":"fly","params":{}}]}'])
  const first = await runTurn(d, PIP_ID)
  expect(first.results).toHaveLength(1); expect(character(d.world, PIP_ID).queue).toHaveLength(2)
  advance(d.world, first.results[0].minutes)
  expect(performQueued(d, PIP_ID)!.results[0].success).toBe(true)        // speak
  expect(character(d.world, PIP_ID).said).toBe('cold')
  advance(d.world, 2)
  expect(performQueued(d, PIP_ID)!.results[0].success).toBe(false)       // fly is refused and empties the queue
  expect(character(d.world, PIP_ID).queue).toEqual([])
  expect(performQueued(d, PIP_ID)).toBeNull()
  expect(JSON.parse(d.store.getTurn(first.turnId)!.results)).toHaveLength(3)
  expect(d.model.requests).toHaveLength(1)
})
test('an unreadable reply is asked for once more, then Pip waits', async () => {
  const d = deps(['nonsense', 'still nonsense'])
  const out = await runTurn(d, PIP_ID)
  expect(d.model.requests).toHaveLength(2)
  expect(JSON.parse(d.store.getTurn(out.turnId)!.decision).moves[0].action).toBe('wait')
  expect(d.store.spentBetween(0, d.now() + 1)).toBeCloseTo(0.02)       // both replies cost allowance
})
// Review Focus 2
test('a move that is not on offer is refused, recorded, and does not crash', async () => {
  const d = deps(['{"do":[{"action":"fly","params":{}}]}'])
  const out = await runTurn(d, PIP_ID)
  expect(out.results[0].success).toBe(false)
  expect(d.store.getTurn(out.turnId)).not.toBeNull()
  expect(d.store.beliefs(PIP_ID)[0].text).toContain('keeps going wrong')
})
test('a model failure records nothing and spends nothing', async () => {
  const d = deps([new ModelError('down')])
  await expect(runTurn(d, PIP_ID)).rejects.toBeInstanceOf(ModelError)
  expect(d.store.lastTurnId(PIP_ID)).toBe(0); expect(d.store.spentBetween(0, d.now() + 1)).toBe(0)
})
test('a reflection writes a diary entry that points at its turns', async () => {
  const d = deps([eat, '{"diary":"Ate berries. Sour.","memories":[],"mind":[{"kind":"want","text":"sweeter berries"}],"done":[]}'])
  const t = await runTurn(d, PIP_ID)
  const id = await runReflection(d, PIP_ID, false)
  expect(d.store.diaryEntry(id!)).toMatchObject({ text: 'Ate berries. Sour.', fromTurn: t.turnId, toTurn: t.turnId })
  expect(d.store.openMindItems(PIP_ID)[0].text).toBe('sweeter berries')
  expect(await runReflection(d, PIP_ID, false)).toBeNull()             // nothing new; no model call
  expect(d.model.requests).toHaveLength(2)
})

// tests/town/scheduler.test.ts
import { createScheduler } from '../../src/town/scheduler.ts'
import { character, PIP_ID } from '../../src/world/world.ts'
import { scriptedClient } from '../../src/model/scripted.ts'
import { ModelError } from '../../src/model/client.ts'
import { deps } from './helpers.ts'
const worldMinutesCap = (2 * 5000) * 4 / 60000
const wait = '{"consider":"hm","do":[{"action":"wait","params":{}}],"because":"."}'

test('time passes and Pip thinks when free, at the budget pace', async () => {
  const d = deps([wait, wait, wait]); const s = createScheduler(d)
  await s.step(5000); expect(d.model.requests).toHaveLength(1)        // thinks at once on start
  expect(d.world.minutes).toBeCloseTo(360 + 5000 * 4 / 60000)
  d.clock.t += 5000; await s.step(5000); expect(d.model.requests).toHaveLength(1)   // too soon
  d.clock.t += d.budget.status().intervalMs
  for (let i = 0; i < 60; i++) await s.step(10_000)                   // lets the 15-minute wait finish
  expect(d.model.requests.length).toBeGreaterThanOrEqual(2)
  expect(s.lastThought()).toBe('hm')
})
test('a sleeping Pip does not think', async () => {
  const d = deps([wait]); character(d.world, PIP_ID).asleep = true; character(d.world, PIP_ID).body.tiredness = 0.9
  const s = createScheduler(d); await s.step(5000)
  expect(d.model.requests).toHaveLength(0)
})
test('no thinking when the budget says no', async () => {
  const d = deps([wait]); d.store.setFlag('halt', 'charged_to_balance')
  await createScheduler(d).step(5000); expect(d.model.requests).toHaveLength(0)
})
// Review Focus 3
test('provider failures back off and the world keeps ticking', async () => {
  const d = deps([new ModelError('down'), new ModelError('down'), wait]); const s = createScheduler(d)
  await s.step(5000); const m1 = d.world.minutes
  d.clock.t += 30_000; await s.step(5000)
  expect(d.model.requests).toHaveLength(1)                            // still backing off after 30 s
  expect(d.world.minutes).toBeGreaterThan(m1)
  d.clock.t += 31_000; await s.step(5000); expect(d.model.requests).toHaveLength(2)   // retried after 60 s
  d.clock.t += 100_000; await s.step(5000); expect(d.model.requests).toHaveLength(2)  // now waits 120 s
  d.clock.t += 21_000; await s.step(5000); expect(d.model.requests).toHaveLength(3)
  expect(d.store.spentBetween(0, d.clock.t + 1)).toBeCloseTo(0.01)
})
// Review Focus 1
test('a restart resumes without jumping time or losing work', async () => {
  const d = deps([wait]); const s1 = createScheduler(d)
  d.world.buildings.push({ id: 'b1', name: 'Half', purpose: 'home', about: '', at: { x: 2, y: 2 }, workLeft: 1, workTotal: 2,
    startedDay: 1, recipe: { footprint: 1, floors: 1, wall: 'cream', roof: 'flat', roofColour: 'red', door: true, windows: 0, sign: '', extras: [] } })
  await s1.step(5000); const before = d.world.minutes
  d.clock.t += 6 * 3_600_000                                          // six hours of downtime
  const reloaded = d.store.loadWorld()!
  const s2 = createScheduler({ ...d, world: reloaded, model: scriptedClient([wait]) })
  await s2.step(6 * 3_600_000)                                        // a careless caller passes the whole gap
  expect(reloaded.minutes - before).toBeLessThanOrEqual(worldMinutesCap)
  expect(reloaded.buildings[0]).toMatchObject({ name: 'Half', workLeft: 1 })
})
test('falling asleep triggers the end-of-day diary', async () => {
  const sleep = '{"consider":"tired","do":[{"action":"sleep","params":{"target":"the hollow tree"}}],"because":"night"}'
  const d = deps([sleep, '{"diary":"A long first day.","memories":[],"mind":[],"done":[]}'])
  character(d.world, PIP_ID).body.tiredness = 0.8
  await createScheduler(d).step(5000)
  expect(d.store.diary(PIP_ID, 5)[0].text).toBe('A long first day.')
})
test('listeners hear about every step and can leave', async () => {
  const d = deps([wait]); const s = createScheduler(d); let n = 0
  const off = s.onChange(() => n++); await s.step(5000); off(); await s.step(5000); expect(n).toBe(1)
})
```

- [ ] **Step 2: Run** `npx vitest run tests/town`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/town/turn.ts`, then `src/town/scheduler.ts`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: turns, reflection and the scheduler"`

---

### Task 10: The server

**Files:**
- Create: `src/server/http.ts`
- Modify: `src/shared/types.ts` (add `StateView`, `TraceView`)
- Test: `tests/server/http.test.ts`

**Interfaces:**
- Consumes: `World`, `Store`, `BudgetKeeper`, `Scheduler`, `clockOf`, `whatISee` is not needed (the stored `userPrompt` is shown).
- Produces:

```ts
// src/shared/types.ts
export type StateView = { clock: string; day: number; night: boolean; weather: string; size: number
  features: Feature[]; buildings: Building[]
  characters: { id: string; name: string; at: Tile; asleep: boolean; doing: string; said: string; mood: number }[]
  budget: { leftToday: number; canThink: boolean; reason: string }
  pip: { doing: string; thought: string; onMind: string[] } }
export type TraceView = { entry: { id: number; clock: string; text: string }
  turns: { clock: string; saw: string; consider: string; moves: { action: string; params: Record<string, string> }[]
    because: string; results: { success: boolean; message: string }[] }[] }

// src/server/http.ts
export function stateView(world: World, store: Store, budget: BudgetKeeper, thought: string): StateView
export function createServer(deps: { world: () => World; store: Store; budget: BudgetKeeper
  scheduler: Pick<Scheduler, 'onChange' | 'lastThought'>; password: string; staticDir: string }): import('node:http').Server
```

- Routes: `GET /login` (a plain form), `POST /login` (form field `password`; on success sets cookie `seedlings_session`, `HttpOnly; SameSite=Strict; Path=/`, and redirects to `/`; on failure 401). Every other route without a valid session: `/api/*` answers 401 JSON, pages redirect to `/login`. Sessions are random tokens held in memory. Passwords are compared with `timingSafeEqual`.
- `GET /api/state` → `StateView`. `GET /api/stream` → server-sent events, one `data:` line of `StateView` on connect and on every scheduler change. `GET /api/diary?character=pip&before=<id>` → 20 entries `{ id, clock, text }`, newest first. `GET /api/trace?diary=<id>` → `TraceView`, 404 when unknown. Anything else serves files from `staticDir`, never outside it.
- All JSON responses use `Content-Type: application/json; charset=utf-8`. Static responses send `X-Content-Type-Options: nosniff`.
- `budget.reason` in `StateView` is plain words: `thinking`, `resting until tomorrow's share`, `resting: five-hour limit`, `resting: weekly limit`, `resting: this month's allowance is spent`, `stopped: a reply was charged to your balance`.
- `pip.onMind` is the text of the 3 newest open mind items.
- A character's `said` is sent only for 30 in-world minutes after `saidAt`; after that it is empty.

- [ ] **Step 1: Write the failing tests.** Start the server on port 0 in `beforeEach` with an in-memory store, a fresh world and a stub scheduler; use `fetch`.

```ts
test('everything is locked without a session', async () => {
  expect((await fetch(`${base}/api/state`)).status).toBe(401)
  const page = await fetch(`${base}/`, { redirect: 'manual' })
  expect(page.status).toBe(302); expect(page.headers.get('location')).toBe('/login')
})
test('a wrong password is refused and a right one opens the page', async () => {
  expect((await login('nope')).status).toBe(401)
  const ok = await login('secret')
  expect(ok.status).toBe(302)
  expect(ok.headers.get('set-cookie')).toMatch(/seedlings_session=.+HttpOnly.+SameSite=Strict/)
  expect((await fetch(`${base}/api/state`, { headers: { cookie } })).status).toBe(200)
})
test('state shows the clock, the plot, Pip and the budget', async () => {
  const s = await getJson('/api/state')
  expect(s).toMatchObject({ clock: '06:00, day 1', weather: 'dry', size: 24,
    budget: { canThink: true, reason: 'thinking' }, pip: { doing: 'idle' } })
  expect(s.characters[0]).toMatchObject({ name: 'Pip' }); expect(s.features.length).toBe(9)
})
// Review Focus 4
test('a halt is explained in words', async () => {
  store.setFlag('halt', 'charged_to_balance')
  expect((await getJson('/api/state')).budget).toMatchObject({ canThink: false, reason: 'stopped: a reply was charged to your balance' })
})
test('the diary and its trace', async () => {
  const t = store.addTurn({ /* a turn with decision {"consider":"peckish","moves":[{"action":"eat","params":{}}],"because":"food"}, results [{"success":true,"message":"You ate."}], userPrompt 'THE TIME: 06:00, day 1' */ })
  const id = store.addDiary({ characterId: 'pip', worldMinutes: 400, text: 'Ate <b>berries</b>.', fromTurn: t, toTurn: t })
  const page = await getJson('/api/diary?character=pip')
  expect(page[0]).toEqual({ id, clock: '06:40, day 1', text: 'Ate <b>berries</b>.' })
  const trace = await getJson(`/api/trace?diary=${id}`)
  expect(trace.turns[0]).toMatchObject({ saw: 'THE TIME: 06:00, day 1', consider: 'peckish', because: 'food',
    results: [{ success: true, message: 'You ate.' }] })
  expect((await fetch(`${base}/api/trace?diary=999`, { headers: { cookie } })).status).toBe(404)
})
test('the stream sends state on connect and on change', async () => {
  // read two SSE messages from /api/stream, calling the stub scheduler's change listeners between them;
  // each parses as JSON with a `clock` field
})
test('static files cannot escape the folder', async () => {
  expect((await fetch(`${base}/../package.json`, { headers: { cookie } })).status).toBe(404)
  expect((await fetch(`${base}/%2e%2e/package.json`, { headers: { cookie } })).status).toBe(404)
})
```

- [ ] **Step 2: Run** `npx vitest run tests/server`. Expected: FAIL.
- [ ] **Step 3: Implement** `stateView` and `createServer` with `node:http`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: private server with state, stream, diary and trace"`

---

### Task 11: The watch page

**Files:**
- Create: `src/shared/iso.ts`, `vite.config.ts`, `web/index.html`, `web/style.css`, `web/main.ts`, `web/draw.ts`, `web/panel.ts`
- Test: `tests/shared/iso.test.ts`, `tests/web/safety.test.ts`

**Interfaces:**
- Consumes: `StateView`, `TraceView`, `Building`, `Tile`, `Colour`; routes from Task 10.
- Produces:

```ts
// src/shared/iso.ts
export const TILE_W = 64; export const TILE_H = 32; export const FLOOR_H = 26
export type Point = { x: number; y: number }
export type Face = { points: Point[]; fill: string
  kind: 'wall-left' | 'wall-right' | 'roof' | 'door' | 'window' | 'sign' | 'extra'; text?: string }
export const PALETTE: Record<Colour, { light: string; dark: string }>
export function tileToScreen(t: Tile, origin: Point): Point          // top corner of the tile's diamond
export function screenToTile(p: Point, origin: Point): Tile          // floor()ed; inverse of tileToScreen
export function buildingFaces(b: Building, origin: Point): Face[]    // back to front
export function drawOrder<T extends { at: Tile }>(things: T[]): T[]  // by x + y, then x
```

- Projection: `x = origin.x + (t.x − t.y) × 32`, `y = origin.y + (t.x + t.y) × 16`.
- `buildingFaces`: wall height is `floors × FLOOR_H`, scaled by `1 − workLeft / workTotal` while unfinished. An unfinished building has no roof, door, window, sign or extra faces. A finished one has one left wall (`light`), one right wall (`dark`), roof faces by shape (flat 1, pitched 2, pyramid 2, dome 1), one door, `windows` window faces, a `sign` face carrying `text` when the sign is not empty, and one face per extra.
- Page layout as in the agreed mockup (`.superpowers/brainstorm/*/content/watch-page.html`): top bar (clock, weather, building count, thinking-left bar and the budget reason), town canvas on the left, side panel on the right with `Right now`, `On Pip's mind`, and the diary. Clicking a diary line opens its trace: for each turn, what Pip saw, thought, did and what happened. There are no tabs and no event button in this stage.
- Pip is drawn as the agreed seedling: a cream seed with two green leaves, dot eyes, on a soft shadow; closed eyes when asleep. Features: bush with berries, a tree with a hollow, a blue pond, plain trees. A speech bubble shows `said` whenever the state carries it.
- `web/main.ts` loads `/api/state`, subscribes to `/api/stream`, redraws on each message, and reconnects after 3 s when the stream drops.
- All model-written text reaches the DOM through `textContent` and the canvas through `fillText`.
- `vite.config.ts`: `root: 'web'`, `build.outDir: '../dist/web'`, `emptyOutDir: true`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/shared/iso.test.ts
import { tileToScreen, screenToTile, buildingFaces, drawOrder } from '../../src/shared/iso.ts'
const O = { x: 400, y: 50 }
const b = (over = {}) => ({ id: 'b', name: 'n', purpose: 'home' as const, about: '', at: { x: 3, y: 4 }, workLeft: 0, workTotal: 3,
  startedDay: 1, recipe: { footprint: 1 as const, floors: 2 as const, wall: 'cream' as const, roof: 'pitched' as const,
    roofColour: 'red' as const, door: true, windows: 2 as const, sign: 'BREAD', extras: ['chimney' as const] }, ...over })
test('projection and its inverse', () => {
  expect(tileToScreen({ x: 0, y: 0 }, O)).toEqual(O)
  expect(tileToScreen({ x: 3, y: 1 }, O)).toEqual({ x: 464, y: 114 })
  for (const t of [{ x: 0, y: 0 }, { x: 5, y: 2 }, { x: 23, y: 23 }]) {
    const p = tileToScreen(t, O); expect(screenToTile({ x: p.x, y: p.y + 16 }, O)).toEqual(t)
  }
})
test('a finished building has every part', () => {
  const kinds = buildingFaces(b(), O).map(f => f.kind)
  expect(kinds.filter(k => k === 'wall-left')).toHaveLength(1)
  expect(kinds.filter(k => k === 'roof')).toHaveLength(2)
  expect(kinds.filter(k => k === 'window')).toHaveLength(2)
  expect(kinds).toContain('door'); expect(kinds).toContain('extra')
  expect(buildingFaces(b(), O).find(f => f.kind === 'sign')!.text).toBe('BREAD')
})
test('a building site is low walls and nothing else', () => {
  const faces = buildingFaces(b({ workLeft: 2 }), O)
  expect(faces.map(f => f.kind).sort()).toEqual(['wall-left', 'wall-right'])
  const height = (fs: typeof faces) => Math.max(...fs[0].points.map(p => p.y)) - Math.min(...fs[0].points.map(p => p.y))
  expect(height(faces)).toBeLessThan(height(buildingFaces(b(), O).filter(f => f.kind === 'wall-left')))
})
test('things further back are drawn first', () => {
  expect(drawOrder([{ at: { x: 5, y: 5 } }, { at: { x: 0, y: 1 } }, { at: { x: 1, y: 0 } }]).map(t => t.at.x + t.at.y)).toEqual([1, 1, 10])
})

// tests/web/safety.test.ts   (Review Focus 5)
import { readdirSync, readFileSync } from 'node:fs'
test('the page never inserts text as HTML', () => {
  for (const f of readdirSync('web').filter(n => n.endsWith('.ts'))) {
    expect(readFileSync(`web/${f}`, 'utf8')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/)
  }
})
```

- [ ] **Step 2: Run** `npx vitest run tests/shared/iso.test.ts tests/web`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/shared/iso.ts`, then the page files.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build:web`. Expected: PASS, and `dist/web/index.html` exists.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: isometric watch page with diary and trace"`

---

### Task 12: Wiring, a fake run, a live check, and deployment

**Files:**
- Create: `src/main.ts`, `deploy/seedlings.service`, `README.md`
- Modify: `src/model/scripted.ts` (add `wanderingClient`)
- Test: `tests/main.test.ts`

**Interfaces:**
- Consumes: everything.
- Produces:

```ts
// src/model/scripted.ts
export function wanderingClient(): ModelClient
// A stand-in that reads the moves listed in the system prompt and picks a plausible one,
// so a fake run shows Pip eating, sleeping and building. Its reflection reply is a fixed short diary line.
// It reports an allowance of 0, so a fake town never runs out of budget.

// src/main.ts
export async function startTown(config: Config): Promise<{ port: number; stop(): Promise<void> }>
```

- `startTown`: opens the store, loads the saved world or creates one from `config.seed`, builds the model client (`wanderingClient` when `config.fakeModel`), the budget keeper, the scheduler and the server (`staticDir` `dist/web`), starts both, and returns the bound port. With `config.fakeModel` the budget keeper's `minIntervalMs` and `maxIntervalMs` are both 1000, so Pip thinks every second. `openStore(':memory:')` creates no folder. `stop` stops the scheduler, saves the world, closes server and store.
- When run directly, `main.ts` calls `startTown(loadConfig(process.env))`, logs one line with the port, and calls `stop` on `SIGINT` and `SIGTERM`. Node loads `.env` through `--env-file-if-exists=.env` in the `start` script.
- `deploy/seedlings.service`: a systemd unit running `npm start` in the project folder as an unprivileged user, `Restart=on-failure`, `RestartSec=10`, `EnvironmentFile=` pointing at the `.env`.
- `README.md`: what this is in three sentences, the settings table, `npm run smoke`, how to run a fake town, how to install the unit, how to clear a halt (`sqlite3 data/seedlings.db "delete from flags where key='halt'"`), and a note to keep Extra Usage off on the Go page.

- [ ] **Step 1: Write the failing test**

```ts
import { startTown } from '../src/main.ts'
import { loadConfig } from '../src/config.ts'
test('a fake town starts, serves state, and stops cleanly', async () => {
  const town = await startTown({ ...loadConfig({ SEEDLINGS_PASSWORD: 'secret', SEEDLINGS_FAKE_MODEL: '1' }),
    port: 0, dbPath: ':memory:', tickMs: 20 })
  const login = await fetch(`http://localhost:${town.port}/login`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=secret' })
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  await new Promise(r => setTimeout(r, 200))
  const state = await (await fetch(`http://localhost:${town.port}/api/state`, { headers: { cookie } })).json()
  expect(state.characters[0].name).toBe('Pip')
  expect(state.pip.thought.length).toBeGreaterThan(0)                  // Pip has had at least one turn
  await town.stop()
})
```

- [ ] **Step 2: Run** `npx vitest run tests/main.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `wanderingClient`, `src/main.ts`, the unit file and the README.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Watch a fake town.** Run `npm run build:web`, then `SEEDLINGS_PASSWORD=secret SEEDLINGS_FAKE_MODEL=1 SEEDLINGS_DAYS_PER_REAL_DAY=480 SEEDLINGS_DB=./data/fake.db npm start`. Open `http://localhost:8787`, log in. Expected within two minutes: the clock advances, Pip (a seedling) moves, a building site appears and grows into a building, the diary gains an entry, and clicking the entry shows what Pip saw and did. Stop and restart the command: the same buildings are still there. Then delete `data/fake.db`.
- [ ] **Step 6: Live check (needs the owner's Go key).** With `SEEDLINGS_API_KEY` and `SEEDLINGS_PASSWORD` in `.env`, run `npm run smoke`. Expected: a JSON reply, and a usage object whose `opencode.billing_source` is `go` and whose `opencode.allowance` is a small number. If `billing_source` is `balance`, stop and turn Extra Usage off on the Go page. Note the allowance figure: if the plan's monthly limit turns out not to be 60, set `SEEDLINGS_MONTHLY_ALLOWANCE`. Set `SEEDLINGS_PERIOD_START_DAY` to the day the subscription renews.
- [ ] **Step 7: Commit** `git add -A && git commit -m "feat: wire the town together, fake run and deployment"`

---

## Not in this plan

Inhabitants, talk and notes, memories of each other, the population limit and the Pip/inhabitant budget split (stage 2). Owner events, the facility plug-in contract and the first facilities (stage 3). HTTPS and a domain for the VPS are left to the owner's existing setup.

## Open assumptions to confirm during Task 12

- The Go plan's monthly limit for the purposes of `opencode.allowance` is assumed to be 60. The live check shows the real scale.
- The 7-day and 5-hour limits are treated as rolling windows.
- `response_format: json_object` is assumed to be accepted for `glm-5.2` through Go. If the live check returns HTTP 400, set `SEEDLINGS_JSON_MODE=0`.
