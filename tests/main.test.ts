import { startTown } from '../src/main.ts'
import { loadConfig } from '../src/config.ts'

test('a fake town starts, serves state, and stops cleanly', async () => {
  const town = await startTown({ ...loadConfig({ SEEDLINGS_PASSWORD: 'secret', SEEDLINGS_FAKE_MODEL: '1' }),
    port: 0, dbPath: ':memory:', tickMs: 20 })
  const login = await fetch(`http://localhost:${town.port}/login`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=secret' })
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  await new Promise(r => setTimeout(r, 200))
  const state = await (await fetch(`http://localhost:${town.port}/api/state`, { headers: { cookie } })).json() as any
  expect(state.characters[0].name).toBe('Pip')
  expect(state.characters[0].thought.length).toBeGreaterThan(0)                 // Pip has had at least one turn
  await town.stop()
})

// Final review I8: the real wiring, stopped and started again on a database file.
test('a town stopped and started again carries on from where it was', async () => {
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path')
  const dbPath = join(mkdtempSync(join(tmpdir(), 'seedlings-')), 'town.db')
  const config = { ...loadConfig({ SEEDLINGS_PASSWORD: 'secret', SEEDLINGS_FAKE_MODEL: '1' }), port: 0, dbPath, tickMs: 20, daysPerRealDay: 2000 }
  const state = async (port: number) => {
    const login = await fetch(`http://localhost:${port}/login`, { method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=secret' })
    return (await fetch(`http://localhost:${port}/api/state`, { headers: { cookie: login.headers.get('set-cookie')!.split(';')[0] } })).json() as Promise<any>
  }
  const first = await startTown(config)
  await new Promise(r => setTimeout(r, 2500))
  const before = await state(first.port)
  await first.stop()
  expect(before.buildings.length).toBeGreaterThan(0)
  const second = await startTown(config)
  const after = await state(second.port)
  await second.stop()
  expect(after.day).toBeGreaterThanOrEqual(before.day)
  expect(after.buildings.map((b: any) => b.name)).toEqual(expect.arrayContaining(before.buildings.map((b: any) => b.name)))
}, 15_000)

// ---- Stage 2 ----
test('a town restarted on its database keeps its inhabitants', async () => {
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path')
  const { openStore } = await import('../src/store/store.ts'); const { addInhabitant } = await import('./world/helpers.ts')
  const dbPath = join(mkdtempSync(join(tmpdir(), 'seedlings-')), 'town.db')
  const config = { ...loadConfig({ SEEDLINGS_PASSWORD: 'secret', SEEDLINGS_FAKE_MODEL: '1' }), port: 0, dbPath, tickMs: 20 }
  const first = await startTown(config); await first.stop()

  const store = openStore(dbPath); const world = store.loadWorld()!
  addInhabitant(world, 'Mo', { x: 3, y: 3 }).sheet = { name: 'Mo', you: 'a moth', core: 'Shy.', traits: ['shy'], values: ['quiet'], fears: ['noise'] }
  store.saveWorld(world); store.close()

  const second = await startTown(config)
  const login = await fetch(`http://localhost:${second.port}/login`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=secret' })
  const state = await (await fetch(`http://localhost:${second.port}/api/state`, { headers: { cookie: login.headers.get('set-cookie')!.split(';')[0] } })).json() as any
  await second.stop()
  expect(state.characters.map((c: any) => c.name)).toEqual(['Pip', 'Mo'])
  expect(state.population.count).toBe(1)
}, 15_000)

// ---- Stage 3 ----
test('a fake town answers an owner event end to end', async () => {
  const town = await startTown({ ...loadConfig({ SEEDLINGS_PASSWORD: 'secret', SEEDLINGS_FAKE_MODEL: '1' }), port: 0, dbPath: ':memory:', tickMs: 20 })
  const base = `http://localhost:${town.port}`
  const login = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=secret' })
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  const { request } = await import('node:http')
  const body = JSON.stringify({ kind: 'weather', weather: 'a storm' })
  const answer = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request({ host: 'localhost', port: town.port, path: '/api/event', method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let text = ''; res.on('data', (c) => { text += c }); res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
    })
    req.on('error', reject); req.end(body)
  })
  expect(answer.status).toBe(200); expect(JSON.parse(answer.text)).toEqual({ ok: true, message: 'The weather turned to a storm.' })
  const state = await (await fetch(`${base}/api/state`, { headers: { cookie } })).json() as any
  expect(state.weather).toBe('a storm')
  await town.stop()
})
