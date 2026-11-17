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
import { createWorld, migrateWorld } from './world/world.ts'

const FAKE_INTERVAL_MS = 1000

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
  const scheduler = createScheduler({ world, store, model, budget, config, now: Date.now })
  const server = createServer({
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
