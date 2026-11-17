# Seedlings Stage 2 (Inhabitants) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pip can create inhabitants who live in its homes, run on a small cheap model with fewer moves, hear and answer each other and Pip, leave notes, remember one another, and write one diary entry per in-world day, all inside the same allowance and visible on the watch page.

**Architecture:** Inhabitants are ordinary `Character`s with `tier: 'inhabitant'`, a sheet Pip wrote, a look and a home, all saved in the world JSON. The seam grows people, hearing and notes, and one Pip-only move, `create_inhabitant`. Minds pick their sheet, model and memory sizes from a small per-tier table. The budget keeper splits each day's share into an origin pool and an inhabitants pool and says how many inhabitants the town can support. The scheduler keeps per-character pacing, gives Pip and at most one inhabitant a model call per step, and moves a spoken-to character's next turn closer.

**Tech Stack:** unchanged from stage 1: Node 24.2+ running `.ts` directly, TypeScript, `better-sqlite3`, `node:http`, Vitest, Vite, Canvas 2D.

**Spec:** `docs/superpowers/specs/2026-11-17-seedlings-design.md`, stage 2 of its build order. Stage 1 is built (plan: `docs/superpowers/plans/2026-11-17-seedlings-stage-1-pip-alone.md`). Owner events and facilities are stage 3.

## Global Constraints

Everything in stage 1's Global Constraints still holds. In addition:

- Inhabitant model is a setting, `SEEDLINGS_INHABITANT_MODEL`, default `deepseek-v4.1-flash` (OpenCode Go id, checked against `https://opencode.ai/inference/go/v1/models`; it accepts `reasoning_effort` `low`).
- Inhabitant moves: move, talk, eat, rest, leave a note, wait. (Use a facility is stage 3.) They never build or create.
- Inhabitants keep fewer memories than Pip, and write one diary entry per in-world day.
- The daily share is split between Pip and the inhabitants, half each. While there are no inhabitants, Pip gets the whole share.
- The budget keeper sets how many inhabitants the town can support. Beyond that the world refuses in plain words.
- Pip cannot remove an inhabitant once created.
- Speech is heard by whoever is near, and remembered. Notes are left at a place for others to find.
- Rumour and reputation are not built in.
- A character who is spoken to gets its next turn sooner.
- Every model request still sends `x-opencode-session: <character id>`: one stable session per character.
- Never print or log the contents of `.env`.
- A stage 1 database must load and keep running under stage 2 code.

## Calls made in this plan (not the owner's decisions; open to correction)

- A home holds as many inhabitants as it has floors.
- Speech carries 4 tiles. Sleeping characters hear nothing.
- Hearing speech leaves an automatic memory (kind `person`) in each listener. Creating an inhabitant leaves one in Pip and one in the newcomer.
- Inhabitants are told Pip built the town and brought them here.
- How many inhabitants the town supports: one until inhabitants have made 10 paid calls; after that, the inhabitants' daily share divided by (their average call cost × 200 calls a day), at most 12.
- Per step: Pip may think, and at most one inhabitant may think (the most overdue). Calls stay sequential, so spending is recorded before the next call.
- A spoken-to character is moved up to think next, but never sooner than 60 seconds after its last turn, so a conversation cannot outrun the budget.
- A provider failure backs off the whole tier (all inhabitants share one model), not each character separately.
- At most 40 notes in the world; the oldest go first.
- Inhabitants are drawn as small round creatures in their colour, with one mark: ears, antennae, tail, hat, scarf or spots.

## Review Focus

1. **A conversation loop.** Pip and an inhabitant keep answering each other. Turns must stay at least 60 s apart per character and stop when the day's share is spent. (Task 7)
2. **A home pulled down while lived in.** Its inhabitants lose their home, keep living, sleep at the hollow tree, and Pip cannot place anyone in a building that is gone. (Task 3)
3. **A stage 1 database.** The saved world has no notes, homes or looks. It loads, gains the new fields, and Pip carries on. (Task 1)
4. **A name that clashes or carries markup.** An inhabitant named "the pond", "Pip", "anyone" or `<b>Mo</b>`. Clashes are refused in words; markup is shown as text. (Task 3, Task 10)
5. **The small model failing while Pip's works.** Inhabitants back off together; Pip keeps thinking; nothing is spent. (Task 7)

## File Structure

```
src/shared/types.ts      + Sheet, Look, Mark, Heard, Note, MemoryKind; Character and World fields; StateView reshaped
src/world/world.ts       + migrateWorld, PIP_ID stays
src/world/seam.ts        + people, hearing, notes, create_inhabitant, per-tier manifest
src/world/people.ts      new: who is near, who hears, homes and room in them
src/store/store.ts       + spend pools
src/budget/keeper.ts     + pools, supportable()
src/config.ts            + inhabitantModel
src/mind/tiers.ts        new: per-tier mind settings, sheetFor, modelFor
src/mind/prompt.ts       + home, people, heard, notes sections
src/mind/memory.ts       recall scene includes people, heard, notes
src/mind/reflect.ts      shouldReflect knows the tier
src/town/turn.ts         tier-aware turns and reflections, memories left in others
src/town/scheduler.ts    per-character pacing, one inhabitant per step, hurrying listeners, tier backoff
src/model/scripted.ts    wanderingClient creates inhabitants, talks, leaves notes
src/server/http.ts       state for every character, town happenings, population
web/draw.ts web/panel.ts web/main.ts web/index.html web/style.css   inhabitants, notes, selection
scripts/smoke.ts         optional "inhabitant" argument
README.md .env.example   new setting
tests/**                 mirrors src/
```

---

### Task 1: World data for inhabitants, and loading a stage 1 world

**Files:**
- Modify: `src/shared/types.ts`, `src/world/world.ts`, `src/store/store.ts` (re-export `MemoryKind`), `src/mind/sheet.ts` (import `Sheet` from shared), `src/main.ts`
- Test: `tests/world/world.test.ts`

**Interfaces:**
- Produces (in `src/shared/types.ts`):

```ts
export type MemoryKind = 'person' | 'work' | 'fact' | 'moment'      // moved here; store.ts re-exports it
export type Sheet = { name: string; you: string; core: string; traits: string[]; values: string[]; fears: string[] }
export type Mark = 'ears' | 'antennae' | 'tail' | 'hat' | 'scarf' | 'spots'
export type Look = { colour: Colour; mark: Mark }
export type Heard = { from: string; text: string; minute: number; toYou: boolean }
export type Note = { id: string; at: Tile; place: string; by: string; text: string; minute: number }
// Character gains:
homeId: string | null; look: Look | null; sheet: Sheet | null; heard: Heard[]
// World gains:
notes: Note[]; populationLimit: number
```

- Produces (in `src/world/world.ts`): `export function migrateWorld(world: World): World` — fills every missing field with its default (`notes: []`, `populationLimit: 0`, and per character `homeId: null`, `look: null`, `sheet: null`, `heard: []`), mutates and returns the same object. `createWorld` sets the new fields too (Pip: all null/empty).
- `src/main.ts`: `const world = migrateWorld(store.loadWorld() ?? createWorld(config.seed))`.

- [ ] **Step 1: Write the failing tests** in `tests/world/world.test.ts`

```ts
test('a new world starts with no notes and room for nobody', () => {
  const w = createWorld(1)
  expect(w.notes).toEqual([]); expect(w.populationLimit).toBe(0)
  expect(character(w, PIP_ID)).toMatchObject({ homeId: null, look: null, sheet: null, heard: [] })
})
// Review Focus 3
test('a stage 1 world gains the new fields and keeps everything else', () => {
  const old = JSON.parse(JSON.stringify(createWorld(1)))
  delete old.notes; delete old.populationLimit
  for (const c of old.characters) { delete c.homeId; delete c.look; delete c.sheet; delete c.heard }
  old.minutes = 5000
  const w = migrateWorld(old)
  expect(w.minutes).toBe(5000); expect(w.notes).toEqual([]); expect(w.populationLimit).toBe(0)
  expect(w.characters[0]).toMatchObject({ id: 'pip', homeId: null, look: null, sheet: null, heard: [] })
})
```

- [ ] **Step 2: Run** `npx vitest run tests/world/world.test.ts`. Expected: FAIL (`migrateWorld` is not exported; `notes` undefined).
- [ ] **Step 3: Implement** the types, `migrateWorld`, the `createWorld` defaults, the `MemoryKind` move and the `main.ts` line. Fix any compile errors the new required `Character` fields cause in tests that build characters by hand (add the four fields).
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass, typecheck clean.
- [ ] **Step 5: Commit** `feat: world data for inhabitants, and loading a stage 1 world`

---

### Task 2: People, hearing and notes in the seam

**Files:**
- Create: `src/world/people.ts`
- Modify: `src/world/seam.ts`
- Test: `tests/world/people.test.ts`, `tests/world/seam.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces (`src/world/people.ts`):

```ts
export const HEARING = 4             // tiles
export const HEARD_MAX = 5           // per character, oldest dropped
export const NOTES_MAX = 40          // per world, oldest dropped
export const RESERVED_NAMES = ['anyone', 'wander', 'here']
export function others(world: World, c: Character): Character[]          // everyone but c
export function withinHearing(world: World, c: Character): Character[]  // awake others at distance <= HEARING
export function residents(world: World, b: Building): Character[]       // characters whose homeId is b.id
export function homesWithRoom(world: World): Building[]                 // finished, purpose 'home', residents < recipe.floors
```

- Produces (`src/world/seam.ts`):

```ts
export function manifest(tier: Character['tier']): Manifest
// Observation gains:
home: string        // inhabitants: 'Your home is <name>.' or 'You have no home.'; Pip: ''
people: string[]    // every other character: '<Name>, <away words>, <doing or "asleep">', nearest first
heard: string[]     // c.heard, oldest first: '<From> said to you: "..."' or '<From> said: "..."'
notes: string[]     // notes within 1 tile: 'A note at <place> from <by>: "<text>"'
// ActResult gains:
heardBy: string[]   // ids of characters who heard this move (speak only)
leaves: { characterId: string; text: string; kind: MemoryKind }[]   // memories this move leaves in characters
```

Move changes, all inside the existing MOVES table:
- `speak` gains `to`: choices `['anyone', ...withinHearing names]`. Perform pushes a `Heard` to every character within hearing (`toYou` true only for the one named), sets `heardBy`, and for each hearer one `leaves` entry: `<Speaker> said to me: "<text>"` when `toYou`, else `<Speaker> said: "<text>"`, kind `person`. Event: `<Speaker> said to <To>: "<text>"`, or the stage 1 wording when `to` is `anyone`.
- `leave_note` (new, tier `inhabitant`, label `leaving a note`): param `text` (role `words`, hint `what the note says`). Place is the nearest thing within 1 tile, else `the open ground`. 5 minutes. Refuses empty text with `You have nothing to write.` Text through `cleanText(…, 200)`. Event `<Name> left a note at <place>`.
- `move_to` targets also include other characters' names; walking goes to their tile.
- `things()` takes the observing character: a finished building's look says `You built it.` to the origin and `Pip built it.` to an inhabitant (use the origin character's name), and a home adds `Home to <names>.` when it has residents.
- `manifest('inhabitant')` description: `A small town on a wide green plot: a berry bush, a hollow tree, a pond and a few trees. Pip, a seedling, built everything else here, and brought you here.` Glossary drops `a building site is a building you have started and not finished` in favour of `a building site is a building Pip has started and not finished`.
- Every result from `act` (refusals included) carries `heardBy: []` and `leaves: []` unless the move sets them.

- [ ] **Step 1: Write the failing tests** — `tests/world/people.test.ts`. First create the shared test helper `tests/world/helpers.ts` with `addInhabitant(w: World, name: string, at: Tile): Character`: it pushes a Character with id `c${w.nextId++}`, tier `inhabitant`, Pip's starting body, `homeId`/`look`/`sheet` null, empty `heard` and queue, and returns it. Tasks 5, 6 and 7 import it from there.

```ts
test('only awake characters within four tiles can hear', () => {
  const w = createWorld(1); const pip = character(w, PIP_ID)
  const near = addInhabitant(w, 'Mo', { x: pip.at.x + 4, y: pip.at.y })
  const far = addInhabitant(w, 'Fen', { x: pip.at.x + 5, y: pip.at.y })
  const sleeper = addInhabitant(w, 'Dot', pip.at); sleeper.asleep = true
  expect(withinHearing(w, pip).map((c) => c.name)).toEqual(['Mo'])
  void far
})
test('a home has room for as many as it has floors', () => { /* home with floors 2, two residents → not in homesWithRoom; one resident → in it; unfinished home never */ })
```

`tests/world/seam.test.ts`:

```ts
test('speaking to someone is heard by everyone near and remembered by each', () => {
  const w = createWorld(1); const pip = character(w, PIP_ID)
  const mo = addInhabitant(w, 'Mo', pip.at); const fen = addInhabitant(w, 'Fen', { x: pip.at.x + 1, y: pip.at.y })
  const r = act(w, PIP_ID, { action: 'speak', params: { to: 'Mo', text: 'Hello' } })
  expect(r.success).toBe(true); expect(r.heardBy.sort()).toEqual([mo.id, fen.id].sort())
  expect(mo.heard[0]).toMatchObject({ from: 'Pip', text: 'Hello', toYou: true })
  expect(fen.heard[0].toYou).toBe(false)
  expect(r.leaves).toContainEqual({ characterId: mo.id, text: 'Pip said to me: "Hello"', kind: 'person' })
  expect(observe(w, mo.id).heard).toEqual(['Pip said to you: "Hello"'])
})
test('speaking to someone out of earshot is refused in words', () => {
  /* Mo 10 tiles away: success false, message lists the choices "anyone" */
})
test('a note left at the pond is seen by whoever stands there', () => {
  /* Pip walks to the pond (move_to), leave_note "Gone fishing"; an inhabitant at the pond sees 'A note at the pond from Pip: "Gone fishing"'; an inhabitant 5 tiles away sees none */
})
test('notes beyond forty push out the oldest', () => { /* 41 notes → 40 left, the first gone */ })
test('an inhabitant is not offered building moves and learns Pip built the town', () => {
  const w = createWorld(1); const mo = addInhabitant(w, 'Mo', { x: 3, y: 3 })
  const names = observe(w, mo.id).available.map((m) => m.name)
  expect(names).toEqual(expect.arrayContaining(['move_to', 'eat', 'look_at', 'speak', 'leave_note', 'wait']))
  expect(names).not.toContain('start_building'); expect(observe(w, mo.id).cannot.join()).not.toContain('start_building')
  expect(manifest('inhabitant').description).toContain('Pip, a seedling, built everything else here')
  expect(observe(w, mo.id).home).toBe('You have no home.')
})
test('Pip can walk to an inhabitant by name', () => { /* move_to { target: 'mo' } puts Pip on Mo's tile */ })
```

- [ ] **Step 2: Run** `npx vitest run tests/world`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement** `src/world/people.ts` and the seam changes above. Keep the one-table rule: the new move and the new params live in MOVES only.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass (update stage 1 seam tests that call `manifest()` with no argument to `manifest('origin')`).
- [ ] **Step 5: Commit** `feat: people, hearing and notes in the seam`

---

### Task 3: Pip creates inhabitants

**Files:**
- Modify: `src/world/seam.ts`, `src/shared/recipe.ts` (export `MARKS`)
- Test: `tests/world/create.test.ts`

**Interfaces:**
- Consumes: `homesWithRoom`, `residents`, `RESERVED_NAMES` (Task 2); `world.populationLimit` (Task 1).
- Produces: move `create_inhabitant` (tier `origin`, label `bringing someone to life`), `export const MARKS: Mark[]` in `recipe.ts`, `ActResult.created: string | null` (the new character's id; null on every other result).

Params and hints:

| param | choices / hint |
|---|---|
| `name` | hint `what they are called, one or two words` |
| `kind` | hint `what sort of creature they are, a few words` |
| `who` | hint `who they are, a sentence or two, in your own words` |
| `traits` | hint `two to four, separated by commas` |
| `cares_about` | hint `one to three things, separated by commas` |
| `fears` | hint `one to three things, separated by commas` |
| `colour` | `COLOURS` |
| `mark` | `MARKS` |
| `home` | names of `homesWithRoom` |

Offer refusals, checked in this order: inhabitants already ≥ `world.populationLimit` → `the town cannot support anyone more yet`; no home with room → `there is no finished home with room for someone new`.

Perform: name through `cleanText(…, 30)`; refuse empty; refuse when it matches (with `same()`) any character, building, feature, or reserved name: `There is already something called <name>. Choose another name.` `who` through `cleanText(…, 300)`, refused when empty. `kind` through `cleanText(…, 40)`, default `a small creature`. Lists split on commas, trimmed, `cleanText(…, 40)` each, at most 4 traits and 3 of each other, empty items dropped; refuse when there is no trait. New character: id `c${world.nextId++}`, tier `inhabitant`, at the home's tile, body `{ hunger: 0.2, tiredness: 0.1, mood: 0.1 }`, `busyUntil` now, `doing: 'idle'`, `homeId`, `look`, `sheet: { name, you: kind, core: who, traits, values: cares_about, fears }`, `heard: []`, empty queue. Pip walks to the home, 60 minutes, mood +0.2. Message `<Name> blinks awake at <home> and looks at you.` Event `Pip made <Name>, who will live at <home>`. `leaves`: Pip gets `I made <Name>. They live at <home>.` (person); the newcomer gets `I opened my eyes at <home>, and Pip was there.` (moment).

`pull_down` of a home sets `homeId: null` on its residents, and adds the event `<Name> no longer has a home` for each.

- [ ] **Step 1: Write the failing tests** in `tests/world/create.test.ts` (helper: a finished two-floor home called `Burrow`, `w.populationLimit = 3`):

```ts
const sheet = { name: 'Mo', kind: 'a moth', who: 'Mo is shy and notices everything.', traits: 'shy, watchful', cares_about: 'quiet', fears: 'loud noises', colour: 'blue', mark: 'antennae', home: 'Burrow' }
test('Pip brings an inhabitant to life in a home with room', () => {
  const r = act(w, PIP_ID, { action: 'create_inhabitant', params: sheet })
  expect(r.success).toBe(true)
  const mo = character(w, r.created!)
  expect(mo).toMatchObject({ tier: 'inhabitant', name: 'Mo', homeId: burrow.id, look: { colour: 'blue', mark: 'antennae' } })
  expect(mo.sheet).toEqual({ name: 'Mo', you: 'a moth', core: 'Mo is shy and notices everything.', traits: ['shy', 'watchful'], values: ['quiet'], fears: ['loud noises'] })
  expect(r.leaves).toContainEqual({ characterId: PIP_ID, text: 'I made Mo. They live at Burrow.', kind: 'person' })
})
test('the town refuses anyone beyond what it can support', () => { /* populationLimit 0 → not offered; cannot says 'the town cannot support anyone more yet' */ })
test('a full home is not offered', () => { /* two residents in a two-floor home → refused 'there is no finished home with room for someone new' */ })
// Review Focus 4
test.each(['Pip', 'the pond', 'Burrow', 'anyone', ''])('the name %j is refused in words', (name) => {
  const r = act(w, PIP_ID, { action: 'create_inhabitant', params: { ...sheet, name } }); expect(r.success).toBe(false)
  expect(w.characters).toHaveLength(1)
})
test('a name with markup is kept as plain text', () => { /* name '<b>Mo</b>' → character name equals cleanText result; nothing is interpreted */ })
// Review Focus 2
test('pulling down a lived-in home leaves its inhabitants homeless but alive', () => {
  /* create Mo in Burrow; pull_down Burrow → Mo.homeId null; event 'Mo no longer has a home'; observe(Mo).home 'You have no home.'; Mo is offered sleep at the hollow tree when tired */
})
test('inhabitants cannot create inhabitants', () => { /* act as Mo → refused 'That is not something you can do here.' */ })
```

- [ ] **Step 2: Run** `npx vitest run tests/world/create.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the move, `MARKS`, `created`, and the `pull_down` change.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: Pip can create inhabitants`

---

### Task 4: Two budget pools, and how many the town can support

**Files:**
- Modify: `src/store/store.ts`, `src/budget/keeper.ts`
- Test: `tests/store/store.test.ts`, `tests/budget/keeper.test.ts`

**Interfaces:**
- Produces (store):

```ts
export type SpendPool = { only: string } | { except: string }      // by character id
spentBetween(fromTs: number, toTs: number, pool?: SpendPool): number
averageSpend(lastN: number, pool?: SpendPool): number
spendCount(pool?: SpendPool): number
```

- Produces (keeper):

```ts
export type Pool = 'town' | 'origin' | 'inhabitants'
// BudgetSettings gains: inhabitantShare: number; turnsPerInhabitantDay: number; maxPopulation: number; probeCalls: number
// DEFAULT_PACING gains: inhabitantShare: 0.5, turnsPerInhabitantDay: 200, maxPopulation: 12, probeCalls: 10
export function createBudgetKeeper(store: Store, settings: BudgetSettings, now: () => number, population?: () => number): BudgetKeeper
status(pool?: Pool): BudgetStatus          // default 'town'
supportable(): number
```

Rules:
- `origin` is `{ only: PIP_ID }`, `inhabitants` is `{ except: PIP_ID }`, `town` is no filter.
- The town's daily share is computed exactly as now. A pool's share is the town share × its fraction: with no inhabitants (`population() === 0`) origin 1, inhabitants 0; otherwise origin `1 - inhabitantShare`, inhabitants `inhabitantShare`. `town` is 1.
- `leftToday`, `typical` (`averageSpend(HISTORY, pool) || seedCost`), `turnsLeft` and `leftTodayFraction` use the pool's share and the pool's spend.
- For `inhabitants`, `intervalMs` is per inhabitant: `(dayEnd - at) / (turnsLeft / max(1, population()))`, clamped as now.
- Halt, month, weekly and five-hour checks stay town-wide, for every pool.
- `supportable()`: when `spendCount(inhabitants) < probeCalls`, return `max(1, population())`. Otherwise `min(maxPopulation, floor(monthly × inhabitantShare / daysInPeriod / (averageSpend(HISTORY, inhabitants) × turnsPerInhabitantDay)))`, never below 0. `daysInPeriod` is the current period's length in days.

- [ ] **Step 1: Write the failing tests**

`tests/store/store.test.ts`:

```ts
test('spending can be counted for one character or everyone else', () => {
  const s = openStore(':memory:'); s.addSpend(1, 'pip', 0.5); s.addSpend(2, 'c4', 0.1); s.addSpend(3, 'c5', 0.3)
  expect(s.spentBetween(0, 10, { only: 'pip' })).toBeCloseTo(0.5)
  expect(s.spentBetween(0, 10, { except: 'pip' })).toBeCloseTo(0.4)
  expect(s.averageSpend(5, { except: 'pip' })).toBeCloseTo(0.2)
  expect(s.spendCount({ except: 'pip' })).toBe(2); expect(s.spendCount()).toBe(3)
})
```

`tests/budget/keeper.test.ts` (keeper built with `population = () => n`, monthly 60, 30-day November):

```ts
test('alone, Pip has the whole share', () => { /* n=0: status('origin').leftTodayFraction 1, and status('inhabitants').canThink false with reason 'day_share_spent' */ })
test('with inhabitants, each pool has half and spends only its own', () => {
  /* n=2; Pip spends 1.0 of the 2.0 day share → status('origin').canThink false (day_share_spent), status('inhabitants').canThink true */
})
test('an inhabitant waits longer the more inhabitants there are', () => {
  /* same spend history; intervalMs for 'inhabitants' with n=4 is about twice n=2 (within the clamp) */
})
test('the weekly limit stops every pool', () => { /* 31 spent this week (> 50% of 60) → status('inhabitants') stopped 'weekly_limit' */ })
test('the town supports one inhabitant until it knows what they cost', () => {
  /* n=0, no inhabitant spend → supportable() 1; n=1 → 1 */
})
test('after that, the number comes from what inhabitant calls cost', () => {
  /* ten inhabitant calls at 0.001 each: 60*0.5/30 = 1.0 a day; 1.0 / (0.001*200) = 5 → supportable() 5 */
  /* at 0.0001 each → capped at 12 */
})
```

- [ ] **Step 2: Run** `npx vitest run tests/store tests/budget`. Expected: FAIL.
- [ ] **Step 3: Implement.** Existing callers of `status()` keep working: no argument means `town`, and with no inhabitants `town` and `origin` agree.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: budget pools for Pip and the inhabitants, and a population the town can support`

---

### Task 5: Minds by tier

**Files:**
- Create: `src/mind/tiers.ts`
- Modify: `src/config.ts`, `src/mind/prompt.ts`, `src/mind/memory.ts`, `src/mind/reflect.ts`, `.env.example`, `README.md`
- Test: `tests/mind/tiers.test.ts`, `tests/mind/prompt.test.ts`, `tests/mind/reflect.test.ts`, `tests/mind/memory.test.ts`, `tests/config.test.ts`

**Interfaces:**
- Produces:

```ts
// src/config.ts — Config gains
inhabitantModel: string      // SEEDLINGS_INHABITANT_MODEL, default 'deepseek-v4.1-flash'

// src/mind/tiers.ts
export type MindSettings = { memoriesRecalled: number; mindShown: number; memoryCap: number; diaryEveryFewHours: boolean; pool: Pool }
export const MINDS: Record<Character['tier'], MindSettings>
//   origin:     { memoriesRecalled: 5, mindShown: 3, memoryCap: 200, diaryEveryFewHours: true,  pool: 'origin' }
//   inhabitant: { memoriesRecalled: 3, mindShown: 2, memoryCap: 60,  diaryEveryFewHours: false, pool: 'inhabitants' }
export function sheetFor(c: Character): Sheet          // PIP_SHEET for the origin; c.sheet for an inhabitant
export function modelFor(c: Character, config: Config): string

// src/mind/reflect.ts — shouldReflect gains everyFewHours: boolean
// when false, only goingToSleep (with at least one turn) is due
```

- `sheetFor` on an inhabitant whose `sheet` is null returns `{ name: c.name, you: 'a small creature', core: `${c.name} lives in the town Pip built.`, traits: ['quiet'], values: ['getting by'], fears: ['being alone'] }`. This only happens with a hand-edited world.
- `whatISee` sections, in this order, each left out when empty: `THE TIME`, `THE PLACE`, `YOUR HOME: <o.home>`, `WHO IS AROUND:` (list of `o.people`), `YOU HEARD:` (list of `o.heard`), `NOTES HERE:` (list of `o.notes`), then `EARLIER`, `YOU REMEMBER`, `YOU HAVE LEARNED`, `ON YOUR MIND`, `YOUR BODY`, the closing line.
- `recall` scene words also come from `o.people`, `o.heard` and `o.notes`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/mind/tiers.test.ts
test('Pip keeps its own sheet and model; an inhabitant gets what Pip wrote and the small model', () => {
  const config = loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_FAKE_MODEL: '1' })
  const w = createWorld(1); const mo = addInhabitant(w, 'Mo', { x: 1, y: 1 })
  mo.sheet = { name: 'Mo', you: 'a moth', core: 'Shy.', traits: ['shy'], values: ['quiet'], fears: ['noise'] }
  expect(sheetFor(character(w, PIP_ID))).toBe(PIP_SHEET); expect(sheetFor(mo).you).toBe('a moth')
  expect(modelFor(character(w, PIP_ID), config)).toBe('glm-5.2'); expect(modelFor(mo, config)).toBe('deepseek-v4.1-flash')
  expect(MINDS.inhabitant.memoryCap).toBeLessThan(MINDS.origin.memoryCap)
})
// tests/config.test.ts
test('the inhabitant model is a setting', () => {
  expect(loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_FAKE_MODEL: '1', SEEDLINGS_INHABITANT_MODEL: 'tiny' }).inhabitantModel).toBe('tiny')
})
// tests/mind/prompt.test.ts
test('who is around, what was heard and notes appear in the scene, and empty ones do not', () => {
  const o = { ...observation, home: 'Your home is Burrow.', people: ['Pip, a few steps away, building'], heard: ['Pip said to you: "Hi"'], notes: [] }
  const text = whatISee(o, [], [], [])
  expect(text).toContain('YOUR HOME: Your home is Burrow.'); expect(text).toContain('WHO IS AROUND:\n- Pip, a few steps away, building')
  expect(text).toContain('YOU HEARD:\n- Pip said to you: "Hi"'); expect(text).not.toContain('NOTES HERE')
  expect(text.indexOf('YOU HEARD')).toBeLessThan(text.indexOf('YOUR BODY'))
})
// tests/mind/reflect.test.ts
test('an inhabitant writes only at the end of the day', () => {
  expect(shouldReflect({ minutesSinceLast: 600, turnsSinceLast: 9, buildingFinished: true, goingToSleep: false, everyFewHours: false })).toBe(false)
  expect(shouldReflect({ minutesSinceLast: 10, turnsSinceLast: 1, buildingFinished: false, goingToSleep: true, everyFewHours: false })).toBe(true)
})
// tests/mind/memory.test.ts
test('a memory about someone who is around comes to mind', () => { /* memory 'Pip hums when building' is recalled first when o.people mentions Pip */ })
```

- [ ] **Step 2: Run** `npx vitest run tests/mind tests/config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `SEEDLINGS_INHABITANT_MODEL=deepseek-v4.1-flash` to `.env.example` and a row to the README settings table: `| SEEDLINGS_INHABITANT_MODEL | deepseek-v4.1-flash | The small model that drives the inhabitants |`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: minds by tier: sheet, model, memory sizes and diary rhythm`

---

### Task 6: Turns for any character

**Files:**
- Modify: `src/town/turn.ts`
- Test: `tests/town/turn.test.ts`

**Interfaces:**
- Consumes: `MINDS`, `sheetFor`, `modelFor` (Task 5); `ActResult.heardBy`, `ActResult.leaves`, `ActResult.created` (Tasks 2–3); `budget.status(pool)` (Task 4).
- Produces: `TurnOutcome` gains `heardBy: string[]` and `created: string | null`. `runTurn`, `performQueued` and `runReflection` keep their signatures and work for any character id.

Changes:
- `runTurn` uses `sheetFor(c)`, `modelFor(c, config)`, `MINDS[c.tier].memoriesRecalled` and `.mindShown`, `manifest(c.tier)`, and `budget.status(MINDS[c.tier].pool)` before the second ask. The turn row records the model used.
- Once a decision has been read (or fallen back to wait), `c.heard = []` before acting: what was heard was seen this turn. A failed model call leaves `c.heard` as it was.
- `perform` writes every `result.leaves` entry with `store.addMemory` at `world.minutes`, and passes `heardBy` and `created` on.
- `runReflection` uses `sheetFor`, `modelFor`, `budget.status(pool)`, and `MINDS[tier].memoryCap` for tidying.

- [ ] **Step 1: Write the failing tests**

(`waitReply` is the wait reply already defined in this file; move its definition above these tests.)

```ts
test('an inhabitant thinks with its own sheet and the small model, and hears once', async () => {
  const d = deps([waitReply]); const mo = addInhabitant(d.world, 'Mo', character(d.world, PIP_ID).at)
  mo.sheet = { name: 'Mo', you: 'a moth', core: 'Shy.', traits: ['shy'], values: ['quiet'], fears: ['noise'] }
  mo.heard = [{ from: 'Pip', text: 'Hi', minute: d.world.minutes, toYou: true }]
  await runTurn(d, mo.id)
  const req = d.model.requests[0]
  expect(req.model).toBe('deepseek-v4.1-flash'); expect(req.sessionId).toBe(mo.id)
  expect(req.system).toContain('You are Mo, a moth'); expect(req.system).not.toContain('start_building')
  expect(req.user).toContain('Pip said to you: "Hi"'); expect(mo.heard).toEqual([])
})
test('what Pip says is remembered by whoever heard it', async () => {
  const say = '{"consider":"hi","do":[{"action":"speak","params":{"to":"Mo","text":"Welcome"}}],"because":"."}'
  const d = deps([say]); const mo = addInhabitant(d.world, 'Mo', character(d.world, PIP_ID).at)
  const out = await runTurn(d, PIP_ID)
  expect(out.heardBy).toEqual([mo.id])
  expect(d.store.memories(mo.id).map((m) => m.text)).toContain('Pip said to me: "Welcome"')
})
test('a failed call leaves what was heard for next time', async () => { /* scripted ModelError → runTurn rejects; mo.heard still has its entry */ })
test('an inhabitant reflection tidies to the smaller cap', async () => { /* 70 memories for Mo, end-of-day reflection → 60 left */ })
```

- [ ] **Step 2: Run** `npx vitest run tests/town/turn.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: turns and diaries for any character`

---

### Task 7: A scheduler for a whole town

**Files:**
- Modify: `src/town/scheduler.ts`
- Test: `tests/town/scheduler.test.ts`

**Interfaces:**
- Consumes: Task 4's `status(pool)` and `supportable()`; Task 5's `MINDS`; Task 6's `TurnOutcome.heardBy`.
- Produces: `Scheduler.lastThought(characterId?: string): string` (default Pip). Everything else unchanged.

Rules:
- Every step first sets `world.populationLimit = budget.supportable()`.
- Per character state: `nextThinkAt`, `lastTurnAt`, `nextReflectAt`, `reflectFailures`, `finishedSinceDiary`, `reflectTrouble`. Created on first sight; a new inhabitant starts with `nextThinkAt` 0. Pip's `nextThinkAt` keeps the flag `next_think_at`; inhabitants use `next_think_at:<id>`. End of day keeps `day_ended:<id>`.
- Per tier state: `failures`, `waitUntil`, `trouble`. A failed think backs off its whole tier with the existing `backoff()`. A success clears its tier.
- Order within a step: every free character with a queue performs one queued move (no model call). Then Pip thinks if due, as in stage 1 but with `status('origin')`. Then at most one inhabitant thinks: of those awake, free, with an empty queue, `now >= nextThinkAt`, tier not waiting, and `status('inhabitants').canThink`, the one with the smallest `nextThinkAt` (ties: lowest id).
- After a successful turn: `nextThinkAt = now + status(pool).intervalMs`, `lastTurnAt = now`.
- After any outcome with `heardBy`, each listener is hurried: `nextThinkAt = min(nextThinkAt, max(now, lastTurnAt + HURRY_GAP_MS))`, `HURRY_GAP_MS = 60_000`.
- Reflection uses `shouldReflect({ …, everyFewHours: MINDS[tier].diaryEveryFewHours })` and `status(pool).canThink`.
- `trouble()` returns the save trouble, else Pip's tier trouble, else `Inhabitants: <message>`, else reflection trouble, else `''`.

- [ ] **Step 1: Write the failing tests** (helper `withInhabitants(d, n)` adds `n` inhabitants at Pip's tile and gives each a sheet)

```ts
test('an inhabitant thinks with the small model on its own pace', async () => {
  const d = deps([wait, wait]); withInhabitants(d, 1); const s = createScheduler(d)
  await s.step(5000)
  expect(d.model.requests.map((r) => r.model)).toEqual(['glm-5.2', 'deepseek-v4.1-flash'])
})
test('at most one inhabitant thinks in a step, the most overdue first', async () => {
  const d = deps([wait, wait, wait, wait]); const [a, b] = withInhabitants(d, 2); const s = createScheduler(d)
  await s.step(5000)
  expect(d.model.requests.filter((r) => r.model === 'deepseek-v4.1-flash')).toHaveLength(1)
  free(d); d.clock.t += 1000; await s.step(5000)
  expect(d.model.requests.filter((r) => r.model === 'deepseek-v4.1-flash').map((r) => r.sessionId)).toEqual([a.id, b.id])
})
// Review Focus 1
test('someone spoken to answers sooner, but never within a minute of their last turn', async () => {
  /* Mo thinks at t0. Pip speaks to Mo at t0+10 s. Mo is not asked at t0+30 s; is asked at t0+61 s, long before its budget interval */
})
// Review Focus 1
test('a conversation stops when the day share is spent', async () => {
  /* scripted replies all speak to each other; inhabitant calls cost 0.6 each against a 1.0 inhabitant share: after the share is gone no further inhabitant request is made while Pip may still think */
})
// Review Focus 5
test('the small model failing backs off every inhabitant and leaves Pip thinking', async () => {
  const fail = (r: ModelRequest) => { if (r.model === 'deepseek-v4.1-flash') throw new ModelError('down'); return wait }
  /* scriptedClient with a function that throws for the small model: two inhabitants; across steps within 60 s only one small-model request is made; Pip's requests continue at its pace; trouble() starts with 'Inhabitants: '; ledger has no inhabitant spend */
})
test('an inhabitant writes its diary only when it goes to bed in the evening', async () => { /* Mo sleeps at 22:00 → reflection with Mo's sheet; Mo working for 6 in-world hours in daytime → none */ })
test('the population the town supports is written into the world', async () => {
  const d = deps([wait]); await createScheduler(d).step(5000); expect(d.world.populationLimit).toBe(1)
})
test('Pip alone behaves exactly as in stage 1', async () => { /* the stage 1 tests in this file still pass unchanged */ })
```

`scriptedClient` needs to accept a function that throws: a `Scripted` function may throw, and the error propagates. (Check: if it already does, no change.)

- [ ] **Step 2: Run** `npx vitest run tests/town/scheduler.test.ts`. Expected: new tests FAIL; stage 1 tests pass.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: the scheduler runs a whole town`

---

### Task 8: The stand-in model brings people to life

**Files:**
- Modify: `src/model/scripted.ts`
- Test: `tests/model/wandering.test.ts`

**Interfaces:**
- Consumes: the move names and params from Tasks 2–3, as they appear in the system prompt.

Behaviour of `wanderingClient` (still allowance 0):
- When `create_inhabitant` is offered and the turn number is a multiple of 4, Pip creates someone: names from `['Mo', 'Fen', 'Dot', 'Ash', 'Bree', 'Kit', 'Lu', 'Nim', 'Oz', 'Pell', 'Rue', 'Tam']` in order, `kind: 'a small creature'`, a one-line `who`, `traits: 'curious, quiet'`, `cares_about: 'company'`, `fears: 'the dark'`, colour and mark cycling through the offered choices, the first offered home.
- Pip prefers `start_building` with purpose `home` until one home exists.
- When `speak` offers a `to` other than `anyone` and the turn is a multiple of 3, speak to that person: `Hello, <name>.`
- When `leave_note` is offered and the turn is a multiple of 7, leave `Was here.`
- The diary reply is unchanged.

- [ ] **Step 1: Write the failing test**

```ts
test('a fake town grows a population that talks', async () => {
  /* run the real scheduler with wanderingClient, fake pacing (min/max interval 1000 ms), clock advanced 1000 ms per step, 3000 steps of 5000 ms: at least one inhabitant exists, some event matches /said to/, and no request was refused for a reason other than a move not on offer */
})
```

- [ ] **Step 2: Run** `npx vitest run tests/model/wandering.test.ts`. Expected: FAIL (no inhabitants).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: the stand-in model creates inhabitants who talk`

---

### Task 9: State for every character

**Files:**
- Modify: `src/shared/types.ts` (`StateView`), `src/server/http.ts`
- Test: `tests/server/http.test.ts`

**Interfaces:**
- Produces:

```ts
export type StateView = {
  clock: string; day: number; night: boolean; weather: string; size: number
  features: Feature[]; buildings: Building[]; notes: Note[]
  characters: {
    id: string; name: string; tier: 'origin' | 'inhabitant'; look: Look | null; home: string
    at: Tile; asleep: boolean; doing: string; said: string; mood: number
    thought: string; onMind: string[]
  }[]
  /** newest first, at most 20 */
  events: { clock: string; text: string }[]
  population: { count: number; limit: number }
  budget: { leftToday: number; canThink: boolean; reason: string; trouble: string }
}
```

- The `pip` block is gone: the page reads Pip from `characters`.
- `stateView(world, store, budget, thoughtOf: (id: string) => string, trouble = '')`. `doing` is `asleep` for sleepers. `home` is the home's name or `''`. `budget` uses `status('town')`.
- `createServer`'s `scheduler` dependency is `Pick<Scheduler, 'onChange' | 'lastThought' | 'trouble'>` as before; `thoughtOf` is `(id) => scheduler.lastThought(id)`.
- Trace: `TraceView` gains `name: string` (the character's name, from the world), for "What <name> saw".

- [ ] **Step 1: Write the failing tests**

```ts
test('the state shows every character with its own thought and mind', async () => {
  /* world with Mo (homeId Burrow, look blue/antennae), a Mo turn row with consider 'quiet here', an open mind item for Mo → characters[1] matches { name: 'Mo', tier: 'inhabitant', home: 'Burrow', thought: 'quiet here', onMind: [...] }; population { count: 1, limit: world.populationLimit } */
})
test('town happenings come newest first, with their time', () => { /* three events → events[0].text is the last one added */ })
test('an inhabitant diary and its trace are served by character', async () => { /* /api/diary?character=<mo id> returns Mo's entries only; /api/trace returns name 'Mo' */ })
```

- [ ] **Step 2: Run** `npx vitest run tests/server`. Expected: FAIL.
- [ ] **Step 3: Implement**, and update `src/main.ts` if the server's wiring changes.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass. The typecheck covers `web/`, so in this commit change `web/panel.ts` and `web/main.ts` to read Pip from `state.characters` (the character with tier `origin`), only as far as needed to compile and keep the page working as before.
- [ ] **Step 5: Commit** `feat: state for every character, the town's happenings and its population`

---

### Task 10: The watch page shows the town's people

**Files:**
- Modify: `web/draw.ts`, `web/panel.ts`, `web/main.ts`, `web/index.html`, `web/style.css`
- Test: `tests/web/pick.test.ts`, `tests/web/safety.test.ts`

**Interfaces:**
- Consumes: `StateView` from Task 9.
- Produces (`web/draw.ts`):

```ts
export function originFor(state: StateView, width: number, height: number): Point   // the follow-Pip origin drawTown already computes
export function characterAt(state: StateView, p: Point, width: number, height: number): string | null   // id of the character drawn under p, front-most first
```

Page:
- Inhabitants drawn as `critter(ctx, at, look, asleep)`: a round body about two-thirds of Pip's height in `PALETTE[look.colour].light` with a `dark` outline, two eyes (closed lines when asleep, like Pip), and the mark: ears (two triangles), antennae (two lines with dots), tail (a curve behind), hat (a small dark cap), scarf (a band in red), spots (three darker dots). Pip stays the seedling.
- Notes drawn as a small cream square with a fold line at their tile.
- Top bar town size: `4 buildings, 2 inhabitants` (and `, 1 being built` as now).
- Side panel: a row of buttons, one per character (Pip first) plus `Town`. The selected character's panel shows its name as the heading, `Right now`, `On <name>'s mind` (thought and mind items), `Home` for inhabitants, and its diary with traces (`What <name> saw`). `Town` shows the population (`3 of 5 the town can support`) and the events list.
- Clicking a character on the canvas selects it. Selection is remembered in `localStorage` (wrapped in try/catch) and falls back to Pip when the id is gone.
- The diary refetches when the selected character's `doing` or `thought` changes, or the selection changes.
- Every model-written string (names, notes, speech, diary) is set with `textContent` or `fillText`, never as markup.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/web/pick.test.ts
test('clicking on an inhabitant picks it, and empty grass picks nobody', () => {
  /* state with Pip at 12,12 and Mo at 14,12; compute Mo's screen point from originFor + tileToScreen centre, minus 10 px up → characterAt returns Mo's id; a point 300 px away returns null */
})
// tests/web/safety.test.ts (extend)
test('no model text reaches innerHTML', () => { /* grep web/*.ts: no innerHTML, outerHTML, insertAdjacentHTML */ })
```

- [ ] **Step 2: Run** `npx vitest run tests/web`. Expected: FAIL (`characterAt` missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build:web`. Expected: all pass, build succeeds.
- [ ] **Step 5: Look at it.** Start a fake town (`SEEDLINGS_PASSWORD=secret SEEDLINGS_FAKE_MODEL=1 SEEDLINGS_DAYS_PER_REAL_DAY=480 npm start` after `npm run build:web`), open it in the app's browser pane, sign in, and wait until an inhabitant exists. Check: inhabitants are drawn with their marks; clicking one selects it; its diary appears after its first night; the Town tab lists happenings; a speech bubble shows over the speaker; at 375 px wide the panel stacks below the town with no sideways scroll. Fix what is wrong before committing.
- [ ] **Step 6: Commit** `feat: the watch page shows the town's people`

---

### Task 11: Wiring, the small model live, and the README

**Files:**
- Modify: `scripts/smoke.ts`, `README.md`, `src/main.ts` (only if not done)
- Test: `tests/main.test.ts`

- [ ] **Step 1: Write the failing test** in `tests/main.test.ts`: a fake town started with `startTown` on a temporary database, stopped, then started again on the same database, still has its inhabitants (create one by hand in the saved world between runs).
- [ ] **Step 2: Run** `npx vitest run tests/main.test.ts`. Expected: FAIL only if wiring is missing; if it passes at once, note it in the ledger (the wiring came with Task 1) and continue.
- [ ] **Step 3: `scripts/smoke.ts`** takes an optional first argument `inhabitant`; with it, the request uses `config.inhabitantModel`. `package.json` needs no change: `npm run smoke -- inhabitant`.
- [ ] **Step 4: Live check of the small model.** Run `npm run smoke -- inhabitant` (uses the owner's `.env`; never print it). Expected: the reply text is JSON, `billingSource` is `go`, the finish reason is not `length`. Then make one real inhabitant turn through the real code, as stage 1's live check did for Pip: a scratch script in the scratchpad that builds a world with Mo in a home, calls `runTurn` with `openAiClient` and the real config, and prints the decision and token counts. Expected: a readable decision naming a move on offer, output under 2,000 tokens. Record the figures in the ledger. If the reply is unusable, stop and report to the owner rather than changing the default model.
- [ ] **Step 5: README.** A short "Inhabitants" section: Pip may create them once it has built a home; how many the town supports and why it starts at one; that they run on `SEEDLINGS_INHABITANT_MODEL`; that their diaries are under their names in the side panel.
- [ ] **Step 6: Run** `npm test && npm run typecheck && npm run build:web`. Expected: all pass.
- [ ] **Step 7: Commit** `feat: inhabitants wired in, small model checked live`
