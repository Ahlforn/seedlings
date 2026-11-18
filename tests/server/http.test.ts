import { request } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from '../../src/server/http.ts'
import { openStore } from '../../src/store/store.ts'
import type { Store } from '../../src/store/store.ts'
import { createWorld } from '../../src/world/world.ts'
import type { World } from '../../src/shared/types.ts'
import { addInhabitant } from '../world/helpers.ts'
import { createBudgetKeeper, DEFAULT_PACING } from '../../src/budget/keeper.ts'

let server: Server; let store: Store; let world: World; let base = ''; let port = 0; let cookie = ''; let trouble = ''
let thoughts: Record<string, string> = {}
let applied: unknown[] = []
const listeners = new Set<() => void>()

beforeEach(async () => {
  store = openStore(':memory:'); world = createWorld(1); cookie = ''; trouble = ''; thoughts = {}; applied = []; listeners.clear()
  const budget = createBudgetKeeper(store, { monthlyAllowance: 60, periodStartDay: 1, ...DEFAULT_PACING }, () => Date.UTC(2026, 10, 1))
  const root = mkdtempSync(join(tmpdir(), 'seedlings-')); mkdirSync(join(root, 'web'))
  writeFileSync(join(root, 'web', 'index.html'), '<p>town</p>'); writeFileSync(join(root, 'secret.txt'), 'top secret')
  server = createServer({ world: () => world, store, budget, password: 'secret', staticDir: join(root, 'web'),
    applyEvent: async (input) => { applied.push(input); return { ok: true, message: 'done' } },
    scheduler: { onChange: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } }, lastThought: (id = 'pip') => thoughts[id] ?? 'hm', trouble: () => trouble } })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  port = (server.address() as AddressInfo).port; base = `http://localhost:${port}`
})
afterEach(() => { server.closeAllConnections(); server.close() })

const login = async (password: string) => {
  const r = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${encodeURIComponent(password)}` })
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]
  return r
}
const getJson = async (path: string) => {
  if (!cookie) await login('secret')
  return (await fetch(`${base}${path}`, { headers: { cookie } })).json() as Promise<any>
}
const rawGet = (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  const req = request({ host: 'localhost', port, path, headers: { cookie } }, (res) => {
    let body = ''; res.on('data', (chunk) => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
  })
  req.on('error', reject); req.end()
})
const turn = (over = {}) => ({ characterId: 'pip', kind: 'turn' as const, realTs: 1, worldMinutes: 360,
  observation: '{}', systemPrompt: 's', userPrompt: 'THE TIME: 06:00, day 1', rawReply: 'r', model: 'm', allowance: 0.01,
  inputTokens: 10, outputTokens: 5,
  decision: JSON.stringify({ consider: 'peckish', moves: [{ action: 'eat', params: {} }], because: 'food', remember: null }),
  results: JSON.stringify([{ success: true, message: 'You ate.', moodDelta: 0.2, minutes: 20, label: 'eating' }]), ...over })

test('everything is locked without a session', async () => {
  expect((await fetch(`${base}/api/state`)).status).toBe(401)
  const page = await fetch(`${base}/`, { redirect: 'manual' })
  expect(page.status).toBe(302); expect(page.headers.get('location')).toBe('/login')
})
test('a wrong password is refused and a right one opens the page', async () => {
  expect((await login('nope')).status).toBe(401)
  expect(cookie).toBe('')
  const ok = await login('secret')
  expect(ok.status).toBe(302)
  expect(ok.headers.get('set-cookie')).toMatch(/seedlings_session=.+HttpOnly.+SameSite=Strict/)
  expect((await fetch(`${base}/api/state`, { headers: { cookie } })).status).toBe(200)
  expect(await (await fetch(`${base}/`, { headers: { cookie } })).text()).toBe('<p>town</p>')
})
test('a made-up session cookie is not accepted', async () => {
  expect((await fetch(`${base}/api/state`, { headers: { cookie: 'seedlings_session=guess' } })).status).toBe(401)
})
test('state shows the clock, the plot, Pip and the budget', async () => {
  const s = await getJson('/api/state')
  expect(s).toMatchObject({ clock: '06:00, day 1', weather: 'dry', size: 24,
    budget: { canThink: true, reason: 'thinking' }, population: { count: 0, limit: 0 } })
  expect(s.characters[0]).toMatchObject({ name: 'Pip', tier: 'origin', doing: 'idle', thought: 'hm', home: '', look: null })
  expect(s.features.length).toBe(9); expect(s.notes).toEqual([])
})
// Review Focus 4
test('a halt is explained in words', async () => {
  store.setFlag('halt', 'charged_to_balance')
  expect((await getJson('/api/state')).budget).toMatchObject({ canThink: false, reason: 'stopped: a reply was charged to your balance' })
})
test('the diary and its trace', async () => {
  const t = store.addTurn(turn())
  const id = store.addDiary({ characterId: 'pip', worldMinutes: 400, text: 'Ate <b>berries</b>.', fromTurn: t, toTurn: t })
  const page = await getJson('/api/diary?character=pip')
  expect(page[0]).toEqual({ id, clock: '06:40, day 1', text: 'Ate <b>berries</b>.' })
  const trace = await getJson(`/api/trace?diary=${id}`)
  expect(trace.entry).toEqual({ id, clock: '06:40, day 1', text: 'Ate <b>berries</b>.' })
  expect(trace.turns[0]).toMatchObject({ clock: '06:00, day 1', saw: 'THE TIME: 06:00, day 1', consider: 'peckish', because: 'food',
    moves: [{ action: 'eat', params: {} }], results: [{ success: true, message: 'You ate.' }] })
  expect((await fetch(`${base}/api/trace?diary=999`, { headers: { cookie } })).status).toBe(404)
})
test('json is served as json', async () => {
  await login('secret')
  const r = await fetch(`${base}/api/state`, { headers: { cookie } })
  expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8')
})
test('the stream sends state on connect and on change', async () => {
  await login('secret')
  const r = await fetch(`${base}/api/stream`, { headers: { cookie } })
  expect(r.headers.get('content-type')).toContain('text/event-stream')
  const reader = r.body!.getReader(); const decoder = new TextDecoder()
  const next = async () => JSON.parse(decoder.decode((await reader.read()).value).replace(/^data: /, ''))
  expect((await next()).clock).toBe('06:00, day 1')
  for (const listener of listeners) listener()
  expect((await next()).clock).toBe('06:00, day 1')
  await reader.cancel()
})
test('static files cannot escape the folder', async () => {
  await login('secret')
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt']) {
    const r = await rawGet(path)
    expect(r.status).toBe(404); expect(r.body).not.toContain('top secret')
  }
  expect((await rawGet('/index.html')).body).toBe('<p>town</p>')
})

// Final review: a town that cannot reach its model must say so on the page.
test('trouble reaching the model is shown instead of "thinking"', async () => {
  trouble = 'The model answered 401: bad key'
  expect((await getJson('/api/state')).budget).toMatchObject({ canThink: true, reason: 'trouble reaching the model, trying again', trouble: 'The model answered 401: bad key' })
})

// ---- Stage 2 ----
test('the state shows every character with its own thought and mind', async () => {
  world.buildings.push({ id: 'b1', name: 'Burrow', purpose: 'home', about: '', at: { x: 2, y: 2 }, workLeft: 0, workTotal: 3, startedDay: 1, facility: null, builtBy: 'origin', closed: false, repairLeft: 0,
    recipe: { footprint: 1, floors: 1, wall: 'cream', roof: 'flat', roofColour: 'red', door: true, windows: 0, sign: '', extras: [] } })
  const mo = addInhabitant(world, 'Mo', { x: 2, y: 2 }); mo.homeId = 'b1'; mo.look = { colour: 'blue', mark: 'antennae' }
  mo.asleep = true; world.populationLimit = 3
  thoughts[mo.id] = 'quiet here'
  store.addMindItem({ characterId: mo.id, kind: 'want', text: 'a friend', sinceMinutes: 0 })
  const s = await getJson('/api/state')
  expect(s.characters[1]).toMatchObject({ id: mo.id, name: 'Mo', tier: 'inhabitant', home: 'Burrow', look: { colour: 'blue', mark: 'antennae' },
    doing: 'asleep', thought: 'quiet here', onMind: ['a friend'] })
  expect(s.population).toEqual({ count: 1, limit: 3 })
})
test('town happenings come newest first, with their time', async () => {
  world.events.push({ minute: 400, text: 'first' }, { minute: 420, text: 'second' }, { minute: 430, text: 'third' })
  const s = await getJson('/api/state')
  expect(s.events[0]).toEqual({ clock: '07:10, day 1', text: 'third' }); expect(s.events).toHaveLength(3)
})
test('an inhabitant diary and its trace are served by character', async () => {
  const mo = addInhabitant(world, 'Mo', { x: 2, y: 2 })
  const t = store.addTurn(turn({ characterId: mo.id }))
  const id = store.addDiary({ characterId: mo.id, worldMinutes: 400, text: 'Quiet.', fromTurn: t, toTurn: t })
  store.addDiary({ characterId: 'pip', worldMinutes: 400, text: 'Busy.', fromTurn: 0, toTurn: 0 })
  expect((await getJson(`/api/diary?character=${mo.id}`)).map((e: { text: string }) => e.text)).toEqual(['Quiet.'])
  const trace = await getJson(`/api/trace?diary=${id}`)
  expect(trace.name).toBe('Mo'); expect(trace.turns).toHaveLength(1)
})

// ---- Stage 3: the gallery ----
test('the gallery is in the state, newest first', async () => {
  const picture = (id: string, title: string, minute: number) => ({ id, placeId: 'b1', by: 'c4', byName: 'Mo', title, mood: 'calm' as const, description: 'd', minute,
    shapes: [{ kind: 'circle', x: 50, y: 50, size: 10, colour: '#ffffff', turn: 0 }] })
  store.addPicture(picture('p1', 'Older', 400)); store.addPicture(picture('p2', 'Newer', 500))
  const s = await getJson('/api/state')
  expect(s.gallery.map((g: { title: string }) => g.title)).toEqual(['Newer', 'Older'])
  expect(s.gallery[0]).toMatchObject({ byName: 'Mo', mood: 'calm', description: 'd', clock: '08:20, day 1' })
  expect(s.gallery[0].shapes).toHaveLength(1)
})

// ---- Stage 3: the café ----
test('café counts and recent misses are in the state', async () => {
  const mo = addInhabitant(world, 'Mo', { x: 2, y: 2 })
  const row = (words: string, outcome: 'found' | 'missing' | 'failed') => ({ characterId: mo.id, realTs: 1, worldMinutes: 400, kind: 'topic' as const, words, outcome, title: '' })
  store.addLookup(row('moths', 'found')); store.addLookup(row('x', 'missing')); store.addLookup(row('y', 'failed'))
  const s = await getJson('/api/state')
  expect(s.cafe).toMatchObject({ today: 0, total: 3, missing: 1, failed: 1 })
  expect(s.cafe.recentMisses).toEqual([{ who: 'Mo', words: 'x', clock: '06:40, day 1' }])
})

// ---- Stage 3: owner events ----
const post = (path: string, body: string, headers: Record<string, string>) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  const req = request({ host: 'localhost', port, path, method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body) } }, (res) => {
    let text = ''; res.on('data', (chunk) => { text += chunk }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }))
  })
  req.on('error', reject); req.end(body)
})
// Review Focus 2
test('an event is accepted only as JSON, from the page itself, from the signed-in owner', async () => {
  const event = JSON.stringify({ kind: 'weather', weather: 'a storm' })
  const json = { 'content-type': 'application/json' }
  expect((await post('/api/event', event, { ...json, origin: `http://localhost:${port}` })).status).toBe(401)
  await login('secret')
  expect((await post('/api/event', event, { ...json, cookie, origin: 'http://evil.example' })).status).toBe(403)
  expect((await post('/api/event', event, { ...json, cookie })).status).toBe(403)
  expect((await post('/api/event', event, { 'content-type': 'text/plain', cookie, origin: `http://localhost:${port}` })).status).toBe(415)
  expect((await post('/api/event', '{nope', { ...json, cookie, origin: `http://localhost:${port}` })).status).toBe(400)
  expect(applied).toEqual([])
  const ok = await post('/api/event', event, { ...json, cookie, origin: `http://localhost:${port}` })
  expect(ok.status).toBe(200); expect(JSON.parse(ok.body)).toEqual({ ok: true, message: 'done' })
  expect(applied).toEqual([{ kind: 'weather', weather: 'a storm' }])
})
test('the owner choices are in the state', async () => {
  const s = await getJson('/api/state')
  expect(s.owner.weathers).toEqual(['dry', 'a thin rain', 'raining hard', 'a storm'])
  expect(s.owner.facilities).toEqual([{ kind: 'art', name: 'an art place' }, { kind: 'cafe', name: 'an internet café' }])
  expect(s.owner.sites.length).toBeGreaterThan(0); expect(s.owner.buildings).toEqual([])
})
