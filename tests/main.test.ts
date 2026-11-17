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
  expect(state.pip.thought.length).toBeGreaterThan(0)                  // Pip has had at least one turn
  await town.stop()
})
