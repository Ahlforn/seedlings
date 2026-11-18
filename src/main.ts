/** Wires the town together and runs it. Start with: npm start */

import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PACING, createBudgetKeeper } from './budget/keeper.ts'
import { loadConfig } from './config.ts'
import type { Config } from './config.ts'
import { openAiClient } from './model/client.ts'
import { wanderingClient } from './model/scripted.ts'
import { createServer } from './server/http.ts'
import { openStore } from './store/store.ts'
import { createScheduler } from './town/scheduler.ts'
import { applyEvent } from './town/events.ts'
import type { FacilityServices } from './facilities/contract.ts'
import { fakeWikipedia } from './facilities/cafe/fake.ts'
import { wikipediaUserAgent } from './facilities/cafe/wikipedia.ts'
import { createWorld, migrateWorld } from './world/world.ts'

const FAKE_INTERVAL_MS = 1000
const FETCH_TIMEOUT_MS = 10_000

/** GET and parse JSON, identifying the town honestly. Rejects on network errors, timeouts and non-2xx answers. */
function fetchJsonWith(userAgent: string): FacilityServices['fetchJson'] {
  return async (url) => {
    const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`${url} answered ${response.status}`)
    return response.json()
  }
}

export async function startTown(config: Config): Promise<{ port: number; stop(): Promise<void> }> {
  const store = openStore(config.dbPath)
  const world = migrateWorld(store.loadWorld() ?? createWorld(config.seed))
  const model = config.fakeModel
    ? wanderingClient()
    : openAiClient({ baseUrl: config.baseUrl, apiKey: config.apiKey, userAgent: config.userAgent, jsonMode: config.jsonMode })
  const pacing = config.fakeModel ? { ...DEFAULT_PACING, minIntervalMs: FAKE_INTERVAL_MS, maxIntervalMs: FAKE_INTERVAL_MS } : DEFAULT_PACING
  const budget = createBudgetKeeper(
    store,
    { monthlyAllowance: config.monthlyAllowance, periodStartDay: config.periodStartDay, ...pacing },
    Date.now,
    () => world.characters.filter((c) => c.tier === 'inhabitant').length,
  )
  const fetchJson = config.fakeModel ? fakeWikipedia() : fetchJsonWith(wikipediaUserAgent(config.wikiContact))
  const services: FacilityServices = { store, now: Date.now, fetchJson }
  const town = { world, store, model, budget, config, now: Date.now, services }
  const scheduler = createScheduler(town)
  const server = createServer({
    applyEvent: (input) => applyEvent(town, input),
    world: () => world,
    store,
    budget,
    scheduler,
    password: config.password,
    staticDir: fileURLToPath(new URL('../dist/web', import.meta.url)),
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, resolve)
  })
  scheduler.start()

  return {
    port: (server.address() as AddressInfo).port,
    async stop() {
      await scheduler.stop()
      store.saveWorld(world)
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      store.close()
    },
  }
}

if (import.meta.main) {
  const config = loadConfig(process.env)
  const town = await startTown(config)
  console.log(`[seedlings] the town is running on http://localhost:${town.port}${config.fakeModel ? ' (stand-in model)' : ''}`)
  const shutdown = () => {
    void town.stop().then(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
