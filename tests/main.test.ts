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
