# Seedlings Stage 3 (Owner Events and Facilities) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Facilities as plug-in modules (an art place and a Wikipedia café), buildings that can be closed or broken, and five owner events sent from the watch page, including a stranger written from the owner's premise.

**Architecture:** A facility is a module under `src/facilities/<kind>/` exporting one `Facility` object. The seam offers a facility's moves only to a character standing at a finished, open, unbroken building of that kind, within its hours; those moves run through a new asynchronous `actAny`, which the turn awaits, while world moves keep the synchronous `act`. Owner events are pure world functions plus one asynchronous stranger path, reached through one JSON endpoint behind the login.

**Tech Stack:** unchanged: Node 24.2+ running `.ts` directly, TypeScript, `better-sqlite3`, `node:http`, Vitest, Vite, Canvas 2D. Wikipedia's public REST API through `fetch`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-18-seedlings-stage-3-design.md`, an addendum to `docs/superpowers/specs/2026-11-17-seedlings-design.md`. Plans of earlier stages: `docs/superpowers/plans/2026-11-17-seedlings-stage-1-pip-alone.md`, `docs/superpowers/plans/2026-11-17-seedlings-stage-2-inhabitants.md`.

## Global Constraints

Everything in stage 1's and stage 2's Global Constraints still holds. In addition, from the stage 3 design:

- The café and the art place make no model calls. The only new model call is writing a stranger's sheet, on the inhabitants' model.
- A stranger's sheet call is allowed whenever `budget.status('town').canThink`, and is recorded against the character id `stranger` (so it counts as inhabitants' spending).
- Facility moves are offered only at a finished, open, unbroken building of that kind, within its hours, and are left out of the prompt otherwise.
- Facility code answers in plain words, may refuse in plain words, never throws for anything a mind can send. A failed outside fetch is a refusal with no mood penalty.
- Text from Wikipedia reaches a character only as something it read: cleaned with `cleanText`, cut to about 600 characters at a sentence end, and it never changes what moves are on offer.
- Wikipedia requests send `User-Agent: seedlings-town/0.1`, plus ` (<contact>)` only when the optional setting `SEEDLINGS_WIKI_CONTACT` is set. Nothing personal is sent otherwise.
- Café: open 08:00–20:00 in-world; at most 30 lookups per in-world day for the whole town; every lookup recorded as `found`, `missing` or `failed`.
- Art place: always open; at most one picture per character per in-world day; up to 12 hanging per art place, oldest taken down first; moods: calm, joyful, lonely, restless, tender, gloomy.
- Owner events: weather (holds 3 in-world hours), close/reopen, break (repair = a third of the original work, at least 1; unfinished buildings cannot be broken), a stranger (premise up to 300 characters, appears homeless at the plot's edge, refused when the town is full), place a facility (appears finished, built by "nobody you know").
- Pip may change or pull down any building, including owner-placed facilities and broken buildings.
- Events are accepted only as JSON, only from the signed-in owner, only with an `Origin` matching the page's own host.
- Never print or log the contents of `.env`.
- A stage 2 database must load and keep running.

## Review Focus

1. **Wikipedia unreachable, slow or answering oddly.** The café refuses in plain words with no mood dip, the lookup is recorded as `failed` (not `missing`, which would skew the adequacy count), the turn is recorded, nothing throws. (Task 4)
2. **An event from anywhere but the owner's page.** A signed-out request, a form post from another site, a missing or foreign `Origin`, or a non-JSON body is refused and changes nothing. (Task 5)
3. **A stage 2 database.** Buildings without `facility`, `builtBy`, `closed`, `repairLeft`, and a world without `weatherHeldUntil` and `pictures`, load and carry on. (Task 1)
4. **A closed or broken building in use.** A resident of a closed home is told "<name> is closed." when trying to sleep there; a broken café offers nothing; Pip repairs it with `work_on`; Pip can pull down an owner-placed facility. (Task 1, Task 2)
5. **A premise that yields an unusable stranger twice.** Bad JSON or a clashing name on both tries: the event fails with the reason, the world is unchanged, and both calls are recorded as spent. (Task 5)

## File Structure

```
src/shared/types.ts          + Building fields, Mood, Shape, Picture, World fields, StateView additions
src/shared/picture.ts        new: paint(title, mood, description) → Shape[] (pure, used by the art place and the page)
src/world/world.ts           migrate the new fields; weather holds
src/world/owner.ts           new: setWeather, setClosed, breakBuilding, placeFacility (pure world changes for owner events)
src/world/seam.ts            closed/broken buildings, repairs, facility purposes, facility moves in observe, actAny, offer_home, bringToLife
src/facilities/contract.ts   new: Facility, FacilityMove, FacilityContext, FacilityServices, FacilityOutcome
src/facilities/index.ts      new: FACILITIES, facilityOf
src/facilities/art/index.ts  new: the art place
src/facilities/cafe/index.ts new: the café
src/facilities/cafe/wikipedia.ts new: search, summary, featured; trimming
src/facilities/cafe/fake.ts  new: a stand-in Wikipedia for fake runs and tests
src/store/store.ts           + lookups, pictures, owner_events tables
src/town/turn.ts             perform through actAny; performQueued async
src/town/scheduler.ts        await performQueued
src/town/events.ts           new: applyEvent, the stranger
src/server/http.ts           POST /api/event; gallery, café and owner choices in the state
src/config.ts                + wikiContact
src/main.ts                  facility services, applyEvent wiring
src/model/scripted.ts        stand-in uses facilities and writes strangers
web/*                        closed/broken marks, gallery, café counts, the event form
scripts/smoke.ts             unchanged
README.md .env.example
tests/**                     mirrors src/
```

---

### Task 1: Closed and broken buildings, weather that holds, and owner world changes

**Files:**
- Create: `src/world/owner.ts`
- Modify: `src/shared/types.ts`, `src/world/world.ts`, `src/world/seam.ts`, `web/draw.ts`
- Test: `tests/world/owner.test.ts`, `tests/world/world.test.ts`

**Interfaces:**
- Produces (types):

```ts
// Building gains
facility: string | null          // facility kind, or null
builtBy: 'origin' | 'nobody'     // 'nobody' for owner-placed
closed: boolean
repairLeft: number               // 0 = sound
// World gains
weatherHeldUntil: number         // world minutes; rain does not drift before it
pictures: Picture[]              // hanging pictures, all art places (Task 3 fills it)
uses: Record<string, { day: number; count: number }>   // daily use counters for facility limits, keyed e.g. 'cafe' or 'art:<characterId>'
// (Picture, Shape, Mood are declared here; Task 3 uses them)
export type Mood = 'calm' | 'joyful' | 'lonely' | 'restless' | 'tender' | 'gloomy'
export type Shape = { kind: string; x: number; y: number; size: number; colour: string; turn: number }
export type Picture = { id: string; placeId: string; by: string; byName: string; title: string; mood: Mood; description: string; minute: number; shapes: Shape[] }
```

- Produces (`src/world/owner.ts`), each mutating the world and returning plain words for the owner:

```ts
export type OwnerResult = { ok: boolean; message: string }
export const WEATHER_HOLD_MINUTES = 180
export function setWeather(world: World, weather: string): OwnerResult          // weather is one of RAIN_WORDS
export function setClosed(world: World, building: string, closed: boolean): OwnerResult
export function breakBuilding(world: World, building: string): OwnerResult
```

Rules:
- `migrateWorld` fills: per building `facility: null`, `builtBy: 'origin'`, `closed: false`, `repairLeft: 0`; `weatherHeldUntil: 0`; `pictures: []`; `uses: {}`. `createWorld` sets them too. Buildings Pip starts get `builtBy: 'origin'`.
- `advance` skips the hourly rain drift while `world.minutes < world.weatherHeldUntil`.
- `setWeather`: sets `rain` to the index of the matching `RAIN_WORDS` entry (matched with the seam's `same()`), holds it `WEATHER_HOLD_MINUTES`, adds the event `The weather turned to <words>.` (for `dry`: `The weather cleared.`). Unknown words → `{ ok: false, message: 'Choose one of: dry, a thin rain, raining hard, a storm.' }`.
- `setClosed`: by building name (`same()`); event `<name> was closed.` / `<name> opened again.`; unknown name → refusal naming the buildings; already in that state → `{ ok: true }` with no event.
- `breakBuilding`: unfinished → `{ ok: false, message: '<name> is not finished yet.' }`; sets `repairLeft = max(1, ceil(workTotal / 3))`; event `<name> broke.`
- A building that is `closed` or has `repairLeft > 0` is **out of use**: not a food or sleep spot, not a home with room, offers no facility moves (Task 2). `things()` describes it as `<name> (closed)` / `<name> (broken)`.
- When a move's choice check fails and the value given names an out-of-use building, the refusal is `<name> is closed.` or `<name> is broken.` instead of the list of choices.
- `work_on` offers unfinished **and** broken buildings. On a broken one it lowers `repairLeft`; the last spell says `You mend <name>. It works again.` (mood +0.2, event `<Name> mended <name>`), others `You mend <name>. <n> more to go.` `start_building`'s limit of two unfinished sites ignores broken buildings.
- `look_at` a building whose `builtBy` is `'nobody'` ends `Nobody you know built it.` instead of `You built it.` / `Pip built it.`
- `pull_down` and `change_building` keep offering every building (owner's decision: any building).
- `web/draw.ts`: an out-of-use building gets a small sign over its door: `CLOSED` or `BROKEN` (text through `fillText`).

- [ ] **Step 1: Write the failing tests** (`tests/world/owner.test.ts`; helper `home(w, name)` pushes a finished one-floor home with `workTotal: 3`)

```ts
test('the owner can set the weather and it holds for three hours', () => {
  const w = createWorld(1)
  expect(setWeather(w, 'a storm')).toEqual({ ok: true, message: 'The weather turned to a storm.' })
  expect(w.rain).toBe(3); expect(w.events.at(-1)!.text).toBe('The weather turned to a storm.')
  for (let h = 0; h < 3; h++) { advance(w, 60); expect(w.rain).toBe(3) }
  expect(setWeather(w, 'snow').ok).toBe(false)
})
// Review Focus 4
test('a closed home is not slept in, and the resident is told why', () => {
  const w = createWorld(1); const b = home(w, 'Burrow'); const mo = addInhabitant(w, 'Mo', b.at); mo.homeId = b.id; mo.body.tiredness = 0.8
  setClosed(w, 'burrow', true)
  expect(observe(w, mo.id).available.find((m) => m.name === 'sleep')!.params.target).not.toContain('Burrow')
  expect(act(w, mo.id, { action: 'sleep', params: { target: 'Burrow' } }).message).toBe('Burrow is closed.')
  expect(observe(w, mo.id).room).toContain('Burrow (closed)')
  setClosed(w, 'Burrow', false); mo.busyUntil = 0
  expect(act(w, mo.id, { action: 'sleep', params: { target: 'Burrow' } }).success).toBe(true)
})
// Review Focus 4
test('a broken building needs mending, and Pip mends it with work_on', () => {
  const w = createWorld(1); home(w, 'Burrow')
  expect(breakBuilding(w, 'Burrow')).toEqual({ ok: true, message: 'Burrow broke.' })
  expect(w.buildings[0].repairLeft).toBe(1)
  const r = act(w, PIP_ID, { action: 'work_on', params: { target: 'Burrow' } })
  expect(r.message).toBe('You mend Burrow. It works again.'); expect(w.buildings[0].repairLeft).toBe(0)
})
test('an unfinished building cannot be broken', () => { /* workLeft 2 → ok false, 'Burrow is not finished yet.' */ })
test('a building nobody you know built says so', () => { /* builtBy 'nobody' → look_at message ends 'Nobody you know built it.' */ })
```

`tests/world/world.test.ts`:

```ts
// Review Focus 3
test('a stage 2 world gains the stage 3 fields', () => {
  const old = JSON.parse(JSON.stringify(createWorld(1))); delete old.weatherHeldUntil; delete old.pictures
  old.buildings.push({ id: 'b1', name: 'Burrow', purpose: 'home', about: '', at: { x: 2, y: 2 }, workLeft: 0, workTotal: 3, startedDay: 1,
    recipe: { footprint: 1, floors: 1, wall: 'cream', roof: 'flat', roofColour: 'red', door: true, windows: 0, sign: '', extras: [] } })
  const w = migrateWorld(old)
  expect(w).toMatchObject({ weatherHeldUntil: 0, pictures: [], uses: {} })
  expect(w.buildings[0]).toMatchObject({ facility: null, builtBy: 'origin', closed: false, repairLeft: 0 })
})
```

- [ ] **Step 2: Run** `npx vitest run tests/world`. Expected: FAIL (module `owner.ts` missing; new fields undefined).
- [ ] **Step 3: Implement** the types, migration, weather hold, `owner.ts` and the seam changes above. Building literals in existing tests need the four new fields: add them to a shared test helper rather than to every literal where you can.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build:web`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: closed and broken buildings, weather that holds`

---

### Task 2: The facility contract

**Files:**
- Create: `src/facilities/contract.ts`, `src/facilities/index.ts`
- Modify: `src/world/seam.ts`, `src/world/owner.ts`, `src/mind/prompt.ts`, `src/mind/memory.ts`, `src/town/turn.ts`, `src/town/scheduler.ts`, `src/main.ts`, `tests/town/helpers.ts` (deps gain `services`)
- Test: `tests/facilities/contract.test.ts`, `tests/town/turn.test.ts`, `tests/mind/prompt.test.ts`

**Interfaces:**
- Consumes: Task 1's building fields and `OwnerResult`.
- Produces (`src/facilities/contract.ts`):

```ts
export type FacilityServices = {
  store: Store
  /** GET a URL and parse JSON; rejects on network errors, timeouts (10 s) and non-2xx answers */
  fetchJson(url: string): Promise<unknown>
  now(): number
}
export type FacilityContext = { world: World; c: Character; building: Building; services: FacilityServices }
export type FacilityOutcome =
  | { ok: true; message: string; minutes: number; moodDelta: number; label: string; event: string; leaves?: Left[] }
  | { ok: false; reason: string; quiet?: boolean }       // quiet: no mood penalty (not the character's doing)
export type FacilityMove = {
  spec: MoveSpec                                          // spec.tier is the smallest tier allowed
  /** choices that are true right now; a string refuses the move with that reason. Pure: world only. */
  offer(ctx: Omit<FacilityContext, 'services'>): Record<string, string[]> | string
  perform(ctx: FacilityContext, params: Record<string, string>): FacilityOutcome | Promise<FacilityOutcome>
}
export type Facility = {
  kind: string                     // 'art', 'cafe'
  name: string                     // 'an art place'
  about: string                    // one line, shown in the glossary
  look: Recipe                     // default recipe when the owner places one
  hours: { opens: number; closes: number } | null   // in-world hours, closes exclusive; null = always
  moves: FacilityMove[]
  /** extra lines a character standing here observes, e.g. pictures hanging */
  observe?(world: World, building: Building): string[]
}
```

- Produces (`src/facilities/contract.ts`), for daily limits kept in the world so that offers stay pure:

```ts
/** The in-world day a use counts towards: days run from 06:00, as for diaries. */
export function usesToday(world: World, key: string): number
export function countUse(world: World, key: string): void
```

- Produces (`src/facilities/index.ts`): `export const FACILITIES: Facility[]` (empty in this task; Tasks 3 and 4 add theirs) and `export function facilityOf(kind: string | null, facilities?: Facility[]): Facility | undefined`.
- Produces (seam):

```ts
// Observation gains
here: string[]   // facility lines for the building the character stands at (from Facility.observe), plus its hours when shut
export function observe(world: World, characterId: string, facilities?: Facility[]): Observation
export function manifest(tier: Character['tier'], facilities?: Facility[]): Manifest
export async function actAny(world: World, characterId: string, move: Act, services: FacilityServices, facilities?: Facility[]): Promise<ActResult>
export function bringToLife(world: World, sheet: Record<string, string>, place: { at: Tile; homeId: string | null }): { ok: true; character: Character } | { ok: false; reason: string }
```
  (`facilities` defaults to `FACILITIES` everywhere.)
- Produces (owner): `export function placeFacility(world: World, kind: string, site: string, name?: string, facilities?: Facility[]): OwnerResult`.
- `TownDeps` gains `services: FacilityServices`. `performQueued` becomes `async` (returns `Promise<TurnOutcome | null>`).

Rules:
- **Standing at** a building: the character's tile is within 1 tile of any tile of its footprint.
- `observe` adds, for each facility building the character stands at that is finished and in use and within hours, that facility's moves (tier permitting) with the choices from `offer`; when `offer` returns a string the move goes to `cannot` as `<move>: <reason>`. Outside its hours: `cannot` gets `<move>: <name> is shut until <opens>:00` and `here` gets `<name> opens at <opens>:00.`
- `whatISee` (`src/mind/prompt.ts`) adds a `HERE:` section listing `o.here`, right after `THE PLACE` (left out when empty), and `recall`'s scene words include `o.here`.
- `manifest(tier)` lists every facility move the tier may use, and adds one glossary line per facility: `<name>: <about>`.
- `actAny`: a world move goes to `act`. A facility move is checked exactly like a world move (asleep, busy, tier, on offer here, choices) with the same refusal words, then performed and awaited. A `quiet` refusal returns `success: false` with `moodDelta: 0` and no event; a thrown error inside `perform` becomes the quiet refusal `Something went wrong there. It might work later.` The result has the usual `ActResult` shape.
- `start_building`'s `purpose` choices become `home | food | other | <each facility kind>`; choosing a kind stores `purpose: 'other'`, `facility: <kind>`.
- `create_inhabitant`'s body moves into `bringToLife` (validation, naming rules, sheet, look); `create_inhabitant` calls it with the home. Nothing about its behaviour or messages changes.
- `placeFacility`: unknown kind → refusal naming kinds; site must be one of `candidateSites` (matched with `same()`), else refusal naming them; creates a finished building with the facility's `look`, `purpose: 'other'`, `facility: kind`, `builtBy: 'nobody'`, `about` = facility `about`, name = given (cleaned, made unique) or the facility name made unique; event `<name> appeared <site>.` (site names already read "north of the pond" etc.; for "the middle of the plot" use "in the middle of the plot").
- `turn.ts`'s `perform` uses `actAny` with `deps.services`; `scheduler.ts` awaits `performQueued`. `main.ts` wires `services` (store, `Date.now`, and a `fetchJson` built on global `fetch` with the Wikipedia user agent from Task 4's config; in this task a plain `fetch` with `AbortSignal.timeout(10_000)` and `User-Agent: seedlings-town/0.1` is enough).

- [ ] **Step 1: Write the failing tests** (`tests/facilities/contract.test.ts`, with a test facility `bench` whose one move `sit` (inhabitant tier, no params) answers `You sit on the bench.`, a second move `wish` (origin tier) that throws, hours 8–20)

```ts
const services = { store: openStore(':memory:'), fetchJson: async () => ({}), now: () => 0 }
test('a facility move is offered only at a finished, open, unbroken building of its kind, within hours', () => {
  const w = createWorld(1); w.minutes = 10 * 60
  const b = placed(w, 'bench')                     // via placeFacility(w, 'bench', <first site>, undefined, [BENCH])
  const mo = addInhabitant(w, 'Mo', b.at)
  expect(observe(w, mo.id, [BENCH]).available.map((m) => m.name)).toContain('sit')
  mo.at = { x: b.at.x + 5, y: b.at.y }; expect(observe(w, mo.id, [BENCH]).available.map((m) => m.name)).not.toContain('sit')
  mo.at = b.at; w.minutes = 22 * 60
  expect(observe(w, mo.id, [BENCH]).cannot).toContain('sit: Bench is shut until 08:00')
  w.minutes = 10 * 60; b.closed = true; expect(observe(w, mo.id, [BENCH]).available.map((m) => m.name)).not.toContain('sit')
})
test('a facility move is carried out and answered in words', async () => {
  /* actAny(w, mo.id, { action: 'sit', params: {} }, services, [BENCH]) → { success: true, message: 'You sit on the bench.' }; mo.busyUntil advanced; event added */
})
test('a facility error is a quiet refusal, never a throw', async () => {
  /* Pip at the bench, actAny 'wish' → { success: false, moodDelta: 0, message: 'Something went wrong there. It might work later.' }, Pip's mood unchanged */
})
test('Pip can build a facility kind, and the owner can place one', () => {
  /* manifest('origin', [BENCH]) glossary has 'a bench: somewhere to sit'; start_building purpose 'bench' → building.facility 'bench', purpose 'other', builtBy 'origin';
     placeFacility(w, 'bench', site) → { ok: true, message: 'Bench appeared <site words>.' }, workLeft 0, builtBy 'nobody'; placeFacility(w, 'spa', site).ok false */
})
// Review Focus 4
test('Pip can pull down a facility the owner placed', () => { /* pull_down target the placed bench → success, building gone */ })
test('daily uses count per in-world day from 06:00', () => { /* countUse twice at 10:00 → usesToday 2; at 05:00 next calendar day still 2; at 06:00 → 0 */ })
// tests/mind/prompt.test.ts
test('what is here comes right after the place', () => { /* o.here ['Pictures on the wall: "X" by Mo (calm)'] → 'HERE:\n- Pictures on the wall' appears after 'THE PLACE' and before 'YOUR BODY'; empty here → no 'HERE:' */ })
```

`tests/town/turn.test.ts`: `test('a queued facility move is performed and awaited')` — a reply `[move_to the bench, sit]` with deps whose `services` and facility list include `BENCH` (pass the list through a `facilities` field on `TownDeps`? No: keep `FACILITIES` global and register `BENCH` for the test with `FACILITIES.push(BENCH)` in `beforeAll`, removing it in `afterAll`).

- [ ] **Step 2: Run** `npx vitest run tests/facilities tests/town`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the one-table rule for world moves; facility moves come only from `FACILITIES`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass (existing tests calling `performQueued` need `await`).
- [ ] **Step 5: Commit** `feat: the facility contract`

---

### Task 3: The art place

**Files:**
- Create: `src/shared/picture.ts`, `src/facilities/art/index.ts`
- Modify: `src/facilities/index.ts`, `src/store/store.ts`, `src/shared/types.ts` (`StateView.gallery`), `src/server/http.ts`, `web/panel.ts`, `web/draw.ts`, `web/index.html`, `web/style.css`
- Test: `tests/shared/picture.test.ts`, `tests/facilities/art.test.ts`, `tests/server/http.test.ts`

**Interfaces:**
- Consumes: Task 2's contract; `Picture`, `Shape`, `Mood` from Task 1.
- Produces:

```ts
// src/shared/picture.ts
export const MOODS: Mood[] = ['calm', 'joyful', 'lonely', 'restless', 'tender', 'gloomy']
export const MOTIFS: string[]              // words the place knows, at least: sun moon star tree flower house pond water rain bird road heart
export function paint(title: string, mood: Mood, description: string): Shape[]   // pure, deterministic; shapes on a 100×100 canvas
export function drawPicture(ctx: CanvasRenderingContext2D, shapes: Shape[], size: number): void   // used by the page only
// store
addPicture(p: Picture): void
gallery(limit: number): Picture[]                         // newest first, hanging or not
// StateView gains
gallery: { id: string; title: string; byName: string; mood: Mood; description: string; clock: string; shapes: Shape[] }[]   // newest 12
```

Art place facility (`kind: 'art'`, `name: 'an art place'`, `about: 'somewhere to make pictures and look at them'`, `hours: null`):
- `make_a_picture` (inhabitant tier, label `making a picture`): `title` (hint `a few words`), `mood` (values `MOODS`), `description` (hint `a sentence about it in your own words, or leave it out`, optional). Refusals: title empty → `A picture needs a title.`; already one today (`usesToday(world, 'art:<id>') >= 1`; counted with `countUse` on success) → `You have already made a picture today.` Success: 60 minutes, mood +0.1, message `You make a picture called "<title>". It hangs on the wall now.`, event `<Name> made a picture called "<title>"`, leaves `I made a picture called <title>.` (moment) for the painter. Title cleaned to 40, description to 200. Picture `id` `p<nextId>`, stored in the store and pushed to `world.pictures`; per art place keep the 12 newest hanging.
- `look_at_picture` (inhabitant tier, label `looking at a picture`): `picture`, choices = titles hanging here (refused with `there are no pictures here yet` when none). Message: `"<title>" by <byName>, <mood>. <description>` (or `"<title>", which you made, <mood>.` for the painter). 10 minutes. Leaves for a non-painter: `<byName> made a picture called <title>, <mood>: <description cut to 100>` (without `: …` when there is no description), kind `person`.
- `observe`: `Pictures on the wall: "<title>" by <byName> (<mood>); …` or nothing when there are none.
- `paint`: a seeded random from the three inputs (hash of the joined strings). Mood picks a palette of 4 colours and a liveliness (count and spread of abstract shapes: calm and lonely few and still, joyful and restless many and scattered, tender soft and round, gloomy dark and low). Each `MOTIFS` word found in the description (whole word, case-insensitive) adds one shape of `kind` equal to that word, at most 4 motifs. Same inputs → equal output.
- Page: Town tab gets a "Gallery" section: each picture on a 96 px canvas with title, painter, mood, description and in-world time.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/shared/picture.test.ts
test('the same title, mood and description always make the same picture', () => {
  expect(paint('First Light', 'restless', 'the road at dawn')).toEqual(paint('First Light', 'restless', 'the road at dawn'))
  expect(paint('First Light', 'calm', 'the road at dawn')).not.toEqual(paint('First Light', 'restless', 'the road at dawn'))
})
test('known words become motifs, at most four', () => {
  const kinds = paint('x', 'calm', 'A sun, a tree, a pond, a bird and the moon').map((s) => s.kind)
  expect(kinds.filter((k) => MOTIFS.includes(k))).toHaveLength(4)
  expect(paint('x', 'calm', '').every((s) => !MOTIFS.includes(s.kind))).toBe(true)
  expect(paint('x', 'joyful', '').length).toBeGreaterThan(paint('x', 'lonely', '').length)
})
// tests/facilities/art.test.ts (an art place placed with placeFacility; Mo and Fen standing at it)
test('a picture is made, hangs, is seen and remembered by whoever looks', async () => { /* Mo make_a_picture {title:'First Light', mood:'Restless', description:'the road'} → success; world.pictures[0] matches { title:'First Light', mood:'restless', byName:'Mo' };
   observe(Fen).here contains 'Pictures on the wall: "First Light" by Mo (restless)'; Fen look_at_picture → leaves [{ characterId: fen.id, text: 'Mo made a picture called First Light, restless: the road', kind: 'person' }] */ })
test('one picture a day each', async () => { /* second make_a_picture same in-world day → 'You have already made a picture today.'; after advancing past 06:00 next day → success */ })
test('twelve pictures hang; the oldest comes down but stays in the gallery', async () => { /* 13 painters → world.pictures for that place has 12, the first title gone; store.gallery(20) has 13 */ })
// tests/server/http.test.ts
test('the gallery is in the state, newest first', async () => { /* two addPicture rows → state.gallery[0].title is the newer, with clock and byName */ })
```

- [ ] **Step 2: Run** `npx vitest run tests/shared/picture.test.ts tests/facilities tests/server`. Expected: FAIL.
- [ ] **Step 3: Implement**, and register the art place in `FACILITIES`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build:web`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: the art place`

---

### Task 4: The café

**Files:**
- Create: `src/facilities/cafe/index.ts`, `src/facilities/cafe/wikipedia.ts`, `src/facilities/cafe/fake.ts`
- Modify: `src/facilities/index.ts`, `src/store/store.ts`, `src/config.ts`, `src/main.ts`, `src/shared/types.ts` (`StateView.cafe`), `src/server/http.ts`, `web/panel.ts`, `web/index.html`, `.env.example`, `README.md`
- Test: `tests/facilities/wikipedia.test.ts`, `tests/facilities/cafe.test.ts`, `tests/server/http.test.ts`, `tests/config.test.ts`

**Interfaces:**
- Produces:

```ts
// src/facilities/cafe/wikipedia.ts
export type Read = { title: string; text: string }
export const WIKI = 'https://en.wikipedia.org'
export async function lookUp(fetchJson: FacilityServices['fetchJson'], topic: string): Promise<Read | null>   // null = nothing found; rejects when unreachable
export async function featured(fetchJson: FacilityServices['fetchJson'], date: Date): Promise<Read | null>
export function trim(text: string, max?: number): string        // cleanText, then cut at the last sentence end within max (600)
export function wikipediaUserAgent(contact: string): string     // 'seedlings-town/0.1' or 'seedlings-town/0.1 (<contact>)'
// src/facilities/cafe/fake.ts
export function fakeWikipedia(): FacilityServices['fetchJson']  // canned answers: any topic found except ones containing 'nothing'; a featured article every day
// store
export type Lookup = { characterId: string; realTs: number; worldMinutes: number; kind: 'topic' | 'paper'; words: string; outcome: 'found' | 'missing' | 'failed'; title: string }
addLookup(l: Lookup): void
lookupStats(): { total: number; missing: number; failed: number }
recentMisses(limit: number): Lookup[]           // outcome 'missing', newest first
// config
wikiContact: string                              // SEEDLINGS_WIKI_CONTACT, default ''
// StateView gains
cafe: { today: number /* usesToday(world, 'cafe') */; total: number; missing: number; failed: number; recentMisses: { who: string; words: string; clock: string }[] }   // 10 most recent misses
```

Wikipedia calls:
- `lookUp`: `GET {WIKI}/w/rest.php/v1/search/page?q=<encoded topic>&limit=1`; no `pages[0]` → `null`; else `GET {WIKI}/api/rest_v1/page/summary/<encoded pages[0].key>`; missing or empty `extract` → `null`; else `{ title: summary.title, text: trim(summary.extract) }`. Any response not shaped like that → `null` (missing), never a throw. Rejections from `fetchJson` propagate (unreachable).
- `featured`: `GET {WIKI}/api/rest_v1/feed/featured/<YYYY>/<MM>/<DD>` (UTC, zero-padded); `tfa.titles.normalized` and `tfa.extract`, else `null`.

Café facility (`kind: 'cafe'`, `name: 'an internet café'`, `about: 'somewhere to look things up and read about the world beyond the plot'`, `hours: { opens: 8, closes: 20 }`):
- Offer: when `usesToday(world, 'cafe') >= 30`, both moves refuse with `the café's terminal is busy for the rest of the day`.
- `look_up` (inhabitant tier, label `reading at the café`): `topic` (hint `a few words`). Empty → `You need something to look up.` (not recorded). Found → message `You read about <title>: <text>`, 30 minutes, mood +0.05, event `<Name> read about <title> at <building>`, leaves `I read about <title> at the café: <first sentence of text, cut to 150>` (fact). Missing → refusal `You look for <topic> but find nothing about it.` (normal mood dip). Unreachable → quiet refusal `The café can't reach anything right now.` Every case except empty records a lookup (`found` / `missing` / `failed`, title `''` when none) and counts one `countUse(world, 'cafe')`.
- `read_the_paper` (inhabitant tier, label `reading the paper`): no params; uses `featured` for the real date `new Date(services.now())`; same three outcomes, recorded with `kind: 'paper'`, `words: ''`; found message `You read the paper. Today it is about <title>: <text>`.
- `main.ts`: when `config.fakeModel`, `services.fetchJson = fakeWikipedia()`; otherwise the real one, sending `wikipediaUserAgent(config.wikiContact)`.
- Page: the Town tab shows `Café: <today> lookups today, <total> in all, <missing> found nothing, <failed> could not connect.` and a list `Not found: "<words>" (<who>, <clock>)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/facilities/wikipedia.test.ts (fetchJson stubbed with a map from URL to JSON or Error)
test('a topic is searched, then its summary read and trimmed at a sentence', async () => {
  const fetchJson = stub({ 'search/page?q=moths&limit=1': { pages: [{ key: 'Moth' }] }, 'page/summary/Moth': { title: 'Moth', extract: 'Moths are insects. '.repeat(60) } })
  const read = await lookUp(fetchJson, 'moths')
  expect(read!.title).toBe('Moth'); expect(read!.text.length).toBeLessThanOrEqual(600); expect(read!.text.endsWith('.')).toBe(true)
})
test('nothing found is null, and an odd answer is nothing found too', async () => { /* { pages: [] } → null; { nope: 1 } → null; summary with no extract → null */ })
test('featured uses the real date', async () => { /* Date.UTC(2026,10,18) → requests '.../feed/featured/2026/11/18' */ })
test('the user agent carries a contact only when one is set', () => { /* '' → 'seedlings-town/0.1'; 'me@x.org' → 'seedlings-town/0.1 (me@x.org)' */ })
// tests/facilities/cafe.test.ts (a café placed with placeFacility, Mo standing there at 10:00)
test('a lookup is read, remembered as a gist, and recorded', async () => { /* found → message starts 'You read about Moth: '; leaves[0].text starts 'I read about Moth at the café: Moths are insects.'; store.lookupStats() { total: 1, missing: 0, failed: 0 } */ })
test('a lookup that finds nothing is a miss, recorded with who asked and what for', async () => { /* → success false, message 'You look for glowing snails but find nothing about it.'; recentMisses(5)[0] matches { characterId: mo.id, words: 'glowing snails', outcome: 'missing' } */ })
// Review Focus 1
test('an unreachable Wikipedia is a quiet refusal recorded as failed, never a throw', async () => {
  /* fetchJson rejects with Error('timeout') → { success: false, moodDelta: 0, message: "The café can't reach anything right now." }; lookupStats().failed 1, missing 0 */
})
test('the café is shut at night and full after thirty lookups', () => { /* 21:00 → cannot has 'look_up: The Café is shut until 08:00'; countUse(w, 'cafe') thirty times → cannot has 'look_up: the café's terminal is busy for the rest of the day' */ })
// tests/server/http.test.ts
test('café counts and recent misses are in the state', async () => { /* addLookup rows → state.cafe matches { total: 3, missing: 1, failed: 1 } and recentMisses[0] { who: 'Mo', words: 'x' } */ })
// tests/config.test.ts
test('a contact for Wikipedia is an optional setting', () => { /* default '' ; SEEDLINGS_WIKI_CONTACT='https://example.org' → wikiContact */ })
```

- [ ] **Step 2: Run** `npx vitest run tests/facilities tests/server tests/config.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, register the café in `FACILITIES`, add `SEEDLINGS_WIKI_CONTACT=` to `.env.example` and a README settings row: `| SEEDLINGS_WIKI_CONTACT | (empty) | An email or URL sent to Wikipedia with the café's requests, as Wikimedia asks of automated clients |`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build:web`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: the internet café, reading from Wikipedia`

---

### Task 5: Owner events, the stranger, and homes for the homeless

**Files:**
- Create: `src/town/events.ts`
- Modify: `src/world/seam.ts` (`offer_home`), `src/server/http.ts`, `src/main.ts`, `src/shared/types.ts` (`StateView.owner`), `src/store/store.ts` (`owner_events`), `web/index.html`, `web/panel.ts` or a new `web/events.ts`, `web/style.css`
- Test: `tests/town/events.test.ts`, `tests/server/http.test.ts`, `tests/world/seam.test.ts`

**Interfaces:**
- Consumes: `setWeather`, `setClosed`, `breakBuilding`, `placeFacility` (Tasks 1–2), `bringToLife` (Task 2), `FACILITIES`.
- Produces:

```ts
// src/town/events.ts
export type EventResult = { ok: boolean; message: string }
export async function applyEvent(deps: TownDeps, input: unknown): Promise<EventResult>
export function strangerPrompt(premise: string): { system: string; user: string }
export function readStrangerSheet(text: string): Record<string, string> | null
// store
addOwnerEvent(e: { kind: string; settings: string; realTs: number; ok: boolean; message: string }): void
// server: createServer deps gain
applyEvent(input: unknown): Promise<EventResult>
// StateView gains
owner: { sites: string[]; buildings: string[]; facilities: { kind: string; name: string }[]; weathers: string[] }
```

Event shapes accepted by `applyEvent` (anything else → `{ ok: false, message: 'That is not an event the town knows.' }`):

```ts
{ kind: 'weather', weather: string }
{ kind: 'close', building: string, closed: boolean }
{ kind: 'break', building: string }
{ kind: 'stranger', premise: string }
{ kind: 'facility', facility: string, site: string, name?: string }
```

Every event, accepted or not, is stored with `addOwnerEvent` and the world is saved after a change.

The stranger:
- Premise cleaned to 300; empty → `Write a line or two about who arrives.`
- Refused before any call when the inhabitants already number `world.populationLimit` or more: `The town cannot support anyone more yet.`; or when `!budget.status('town').canThink`: `The town has no thinking left today.`
- `strangerPrompt`: system asks for one JSON object with exactly the keys `create_inhabitant` takes (`name, kind, who, traits, cares_about, fears, colour, mark`), listing the allowed colours and marks, a temperament but no hobbies (as Pip's own sheet); user is the premise.
- Up to two calls on `config.inhabitantModel` with session id `stranger`, `maxTokens` and `reasoningEffort` from config; each `budget.record('stranger', usage)`; a cut-off reply counts as unusable. Each reply is read with `readStrangerSheet` and checked with `bringToLife` at the edge tile `{ x: 0, y: Math.floor(world.size / 2) }` (moved inward to the first tile with no feature), `homeId: null`. The second call is skipped when the budget says no after the first.
- Success: event `A stranger called <name> arrived at the edge of the plot.`, owner message `<name> has arrived.`; failure: `The stranger could not be written: <last reason>.`, world unchanged.

`offer_home` (seam, origin tier, label `offering someone a home`): params `who` (homeless characters within hearing), `home` (`homesWithRoom`). Offer refusals: `nobody near needs a home`, `there is no finished home with room`. Success: sets `homeId`, 10 minutes, message `<Name> will live at <home>.`, event `Pip offered <Name> a home at <home>`, leaves for Pip `I gave <Name> a home at <home>.` (person) and for them `Pip gave me a home at <home>.` (person).

Server: `POST /api/event`, signed in only. Refused with 403 unless the `Origin` header is present and its host equals the `Host` header; 415 unless `Content-Type` starts with `application/json`; 413 over 10 000 bytes; 400 for unparseable JSON. Otherwise answers 200 with the `EventResult`, and notifies stream listeners.

Page: a "Cause an event" button in the top bar opens a `<dialog>` form with a choice of event and only the fields it needs (selects filled from `state.owner`; the stranger's textarea counts to 300; the stranger option shows "The town is full" and is disabled when `population.count >= population.limit`). It sends JSON with `fetch` and shows the answer's message in the dialog.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/town/events.test.ts (deps from tests/town/helpers.ts)
test('weather, closing, breaking and placing go through one door and are recorded', async () => {
  const d = deps([]); expect(await applyEvent(d, { kind: 'weather', weather: 'a storm' })).toEqual({ ok: true, message: 'The weather turned to a storm.' })
  /* then a placed art place via { kind: 'facility', facility: 'art', site: <first candidate> } ok; close it; break it; each ok and in the world */
  expect(await applyEvent(d, { kind: 'parade' })).toEqual({ ok: false, message: 'That is not an event the town knows.' })
})
test('a stranger is written from the premise and arrives homeless at the edge', async () => {
  const sheet = JSON.stringify({ name: 'Bram', kind: 'a tired traveller', who: 'Bram used to bake bread.', traits: 'quiet, patient', cares_about: 'warm bread', fears: 'being turned away', colour: 'brown', mark: 'scarf' })
  const d = deps([sheet]); d.world.populationLimit = 1
  expect(await applyEvent(d, { kind: 'stranger', premise: 'a tired traveller who used to be a baker' })).toEqual({ ok: true, message: 'Bram has arrived.' })
  const bram = d.world.characters.find((c) => c.name === 'Bram')!
  expect(bram).toMatchObject({ tier: 'inhabitant', homeId: null }); expect(bram.at.x).toBeLessThanOrEqual(1)
  expect(d.model.requests[0]).toMatchObject({ model: 'glm-5.3-flash', sessionId: 'stranger' }); expect(d.model.requests[0].user).toContain('used to be a baker')
  expect(d.store.spentBetween(0, d.now() + 1, { except: 'pip' })).toBeCloseTo(0.01)
})
// Review Focus 5
test('a premise that yields an unusable stranger twice fails plainly and changes nothing', async () => {
  const d = deps(['not json', JSON.stringify({ name: 'Pip', kind: 'x', who: 'y', traits: 'z', cares_about: 'a', fears: 'b', colour: 'red', mark: 'hat' })]); d.world.populationLimit = 1
  const r = await applyEvent(d, { kind: 'stranger', premise: 'someone' })
  expect(r.ok).toBe(false); expect(r.message).toMatch(/^The stranger could not be written: There is already something called Pip/)
  expect(d.world.characters).toHaveLength(1); expect(d.model.requests).toHaveLength(2)
  expect(d.store.spentBetween(0, d.now() + 1)).toBeCloseTo(0.02)
})
test('no stranger when the town is full, and no call is made', async () => { /* populationLimit 0 → 'The town cannot support anyone more yet.', requests 0 */ })
// tests/world/seam.test.ts
test('Pip can offer a homeless inhabitant a home', () => { /* Bram homeless next to Pip, a finished home with room → offer_home { who: 'Bram', home: 'Burrow' } success; bram.homeId set; leaves both memories */ })
// tests/server/http.test.ts (applyEvent dep records what it was given and answers { ok: true, message: 'done' })
// Review Focus 2
test('an event is accepted only as JSON, from the page itself, from the signed-in owner', async () => {
  /* no cookie → 401; cookie + Origin http://evil.example → 403; cookie + correct Origin + text/plain → 415; cookie + correct Origin + JSON → 200 { ok: true, message: 'done' } and applyEvent was called once with the parsed body */
})
test('the owner choices are in the state', async () => { /* state.owner.weathers equals RAIN_WORDS; facilities lists { kind: 'art' } and { kind: 'cafe' }; sites match candidateSites */ })
```

- [ ] **Step 2: Run** `npx vitest run tests/town/events.test.ts tests/server tests/world/seam.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; wire `applyEvent` in `main.ts` as `(input) => applyEvent(townDeps, input)` and pass it to `createServer`.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build:web`. Expected: all pass.
- [ ] **Step 5: Look at it.** Start a fake town (as in stage 2, on a database in the scratchpad), sign in, and use the form: place an art place and a café, change the weather, close and break a building, bring a stranger. Check each answer shows in the dialog and each change shows on the town and in the happenings, that closed/broken signs appear, and that at 375 px the dialog fits without sideways scroll. Fix what is wrong before committing.
- [ ] **Step 6: Commit** `feat: owner events, the stranger, and homes for the homeless`

---

### Task 6: The stand-in model, wiring, the README, and a live check

**Files:**
- Modify: `src/model/scripted.ts`, `README.md`, `src/main.ts` (if anything is left)
- Test: `tests/model/wandering.test.ts`, `tests/main.test.ts`

Behaviour of `wanderingClient` additions:
- Pip, once a home and a food place exist, starts an `art` building and then a `cafe` (purpose = the facility kind) before cycling as before.
- Anyone standing where `make_a_picture` is offered makes one on turns that are multiples of 4 (title from a short list, mood cycling through the offered choices, a description using a motif word); `look_at_picture` on multiples of 5; `look_up` on multiples of 3 with a topic from a short list, one of which contains `nothing` so fake runs show misses; `read_the_paper` otherwise. Characters walk to a facility building (`move_to`) on multiples of 6 when one exists.
- Pip uses `offer_home` whenever it is offered.
- A system prompt containing `character sheet` gets a stranger sheet with a name from its own list (`Bram`, `Wren`, `Hollis`, `Tamsin`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/model/wandering.test.ts
test('a fake town builds facilities, paints, reads and misses', async () => {
  /* the stage 2 fake-town loop (fake pacing, daysPerRealDay 480) with services { store, fetchJson: fakeWikipedia(), now }; run until a picture exists and a lookup is recorded (cap 4000 steps):
     d.world.buildings.some(b => b.facility === 'art') and 'cafe'; store.gallery(5).length > 0; lookupStats().total > 0 and missing > 0; every recorded move result either succeeded or was refused for a reason in the café's or art place's own words */
}, 60_000)
// tests/main.test.ts
test('a fake town answers an owner event end to end', async () => { /* startTown fake; POST /api/event { kind: 'weather', weather: 'a storm' } with the right Origin and cookie → 200 ok; then /api/state weather 'a storm' */ })
```

- [ ] **Step 2: Run** `npx vitest run tests/model/wandering.test.ts tests/main.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Live check, with the owner's `.env` (never print it).**
  - Wikipedia: a scratch script in the scratchpad calls `lookUp` and `featured` with the real `fetchJson` and user agent for three topics (one common, one odd, one nonsense). Expected: the first found with a trimmed summary, the nonsense one `null`, no throw. Record titles and lengths in the ledger.
  - The stranger: a scratch script runs `applyEvent` with the real model client and config on an in-memory store and a fresh world with `populationLimit = 1`, premise `a tired traveller who used to be a baker`. Expected: `ok: true`, a sheet in character, output under 2,000 tokens. Record the sheet and the allowance used in the ledger. If it fails twice, stop and report to the owner.
- [ ] **Step 5: README.** A short "Facilities and events" section: what the café and the art place offer and their limits; that misses are counted on the Town tab to judge whether Wikipedia is enough; the five events and that the owner has no voice in the world; that Pip may pull down anything, including what the owner placed.
- [ ] **Step 6: Run** `npm test && npm run typecheck && npm run build:web`. Expected: all pass.
- [ ] **Step 7: Commit** `feat: stage 3 wired in, Wikipedia and the stranger checked live`
