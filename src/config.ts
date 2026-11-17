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

function positive(env: Env, name: string, fallback: number): number {
  const value = number(env, name, fallback)
  if (value <= 0) throw new Error(`Setting ${name} must be greater than 0, got "${env[name]}"`)
  return value
}

function wholeBetween(env: Env, name: string, fallback: number, min: number, max: number): number {
  const value = number(env, name, fallback)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Setting ${name} must be a whole number from ${min} to ${max}, got "${env[name]}"`)
  }
  return value
}

export function loadConfig(env: Env): Config {
  const fakeModel = env.SEEDLINGS_FAKE_MODEL === '1'
  return {
    port: wholeBetween(env, 'PORT', 8787, 0, 65535),
    // A fake town never shares a database with the real one unless told to.
    dbPath: env.SEEDLINGS_DB || (fakeModel ? './data/fake.db' : './data/seedlings.db'),
    password: required(env, 'SEEDLINGS_PASSWORD'),
    baseUrl: env.SEEDLINGS_BASE_URL || 'https://opencode.ai/inference/go/openai/v1',
    apiKey: fakeModel ? (env.SEEDLINGS_API_KEY ?? '') : required(env, 'SEEDLINGS_API_KEY'),
    pipModel: env.SEEDLINGS_PIP_MODEL || 'glm-5.2',
    userAgent: 'seedlings-town/0.1',
    jsonMode: (env.SEEDLINGS_JSON_MODE ?? '1') !== '0',
    daysPerRealDay: positive(env, 'SEEDLINGS_DAYS_PER_REAL_DAY', 4),
    tickMs: positive(env, 'SEEDLINGS_TICK_MS', 5000),
    seed: number(env, 'SEEDLINGS_SEED', 1),
    monthlyAllowance: positive(env, 'SEEDLINGS_MONTHLY_ALLOWANCE', 60),
    periodStartDay: wholeBetween(env, 'SEEDLINGS_PERIOD_START_DAY', 1, 1, 31),
    fakeModel,
  }
}
