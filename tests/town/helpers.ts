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
