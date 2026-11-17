/** Settings, read once from the environment. */

export type Config = {
  port: number
  dbPath: string
  password: string
  baseUrl: string
  apiKey: string
  pipModel: string
  userAgent: string
  jsonMode: boolean
  daysPerRealDay: number
  tickMs: number
  seed: number
  monthlyAllowance: number
  periodStartDay: number
  fakeModel: boolean
}

type Env = Record<string, string | undefined>

function required(env: Env, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`Missing setting: ${name}`)
  return value
}

function number(env: Env, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`Setting ${name} must be a number, got "${raw}"`)
  return value
}

export function loadConfig(env: Env): Config {
  const fakeModel = env.SEEDLINGS_FAKE_MODEL === '1'
  return {
    port: number(env, 'PORT', 8787),
    dbPath: env.SEEDLINGS_DB || './data/seedlings.db',
    password: required(env, 'SEEDLINGS_PASSWORD'),
    baseUrl: env.SEEDLINGS_BASE_URL || 'https://opencode.ai/inference/go/openai/v1',
    apiKey: fakeModel ? (env.SEEDLINGS_API_KEY ?? '') : required(env, 'SEEDLINGS_API_KEY'),
    pipModel: env.SEEDLINGS_PIP_MODEL || 'glm-5.2',
    userAgent: 'seedlings-town/0.1',
    jsonMode: (env.SEEDLINGS_JSON_MODE ?? '1') !== '0',
    daysPerRealDay: number(env, 'SEEDLINGS_DAYS_PER_REAL_DAY', 4),
    tickMs: number(env, 'SEEDLINGS_TICK_MS', 5000),
    seed: number(env, 'SEEDLINGS_SEED', 1),
    monthlyAllowance: number(env, 'SEEDLINGS_MONTHLY_ALLOWANCE', 60),
    periodStartDay: number(env, 'SEEDLINGS_PERIOD_START_DAY', 1),
    fakeModel,
  }
}
