import { loadConfig } from '../src/config.ts'

test('defaults', () => {
  const c = loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_API_KEY: 'k' })
  expect(c).toMatchObject({ port: 8787, pipModel: 'glm-5.2', daysPerRealDay: 4, monthlyAllowance: 60,
    baseUrl: 'https://opencode.ai/inference/go/openai/v1', userAgent: 'seedlings-town/0.1', jsonMode: true })
})
test('names the missing variable', () => {
  expect(() => loadConfig({ SEEDLINGS_API_KEY: 'k' })).toThrow('SEEDLINGS_PASSWORD')
  expect(() => loadConfig({ SEEDLINGS_PASSWORD: 'p' })).toThrow('SEEDLINGS_API_KEY')
})
test('a fake model needs no key', () => {
  expect(loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_FAKE_MODEL: '1' }).fakeModel).toBe(true)
})

// Final review: settings that make no sense are refused by name.
test.each([
  ['SEEDLINGS_PERIOD_START_DAY', '0'], ['SEEDLINGS_PERIOD_START_DAY', '32'], ['SEEDLINGS_PERIOD_START_DAY', '1.5'],
  ['SEEDLINGS_TICK_MS', '0'], ['SEEDLINGS_DAYS_PER_REAL_DAY', '-1'], ['SEEDLINGS_MONTHLY_ALLOWANCE', '0'],
])('%s=%s is refused', (name, value) => {
  expect(() => loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_API_KEY: 'k', [name]: value })).toThrow(name)
})
test('a fake town keeps its own database unless told otherwise', () => {
  expect(loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_FAKE_MODEL: '1' }).dbPath).toBe('./data/fake.db')
  expect(loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_FAKE_MODEL: '1', SEEDLINGS_DB: './x.db' }).dbPath).toBe('./x.db')
  expect(loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_API_KEY: 'k' }).dbPath).toBe('./data/seedlings.db')
})

test('room for the model to think and answer', () => {
  expect(loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_API_KEY: 'k' }).maxTokens).toBe(8000)
  expect(loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_API_KEY: 'k', SEEDLINGS_MAX_TOKENS: '800' }).maxTokens).toBe(800)
  expect(() => loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_API_KEY: 'k', SEEDLINGS_MAX_TOKENS: '0' })).toThrow('SEEDLINGS_MAX_TOKENS')
})

test('reasoning effort: low by default, may be turned up or left to the provider', () => {
  const base = { SEEDLINGS_PASSWORD: 'p', SEEDLINGS_API_KEY: 'k' }
  expect(loadConfig(base).reasoningEffort).toBe('low')
  expect(loadConfig({ ...base, SEEDLINGS_REASONING_EFFORT: 'high' }).reasoningEffort).toBe('high')
  expect(loadConfig({ ...base, SEEDLINGS_REASONING_EFFORT: '' }).reasoningEffort).toBe('')
  expect(() => loadConfig({ ...base, SEEDLINGS_REASONING_EFFORT: 'lots' })).toThrow('SEEDLINGS_REASONING_EFFORT')
})

test('the inhabitant model is a setting', () => {
  expect(loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_FAKE_MODEL: '1' }).inhabitantModel).toBe('glm-5.3-flash')
  expect(loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_FAKE_MODEL: '1', SEEDLINGS_INHABITANT_MODEL: 'tiny' }).inhabitantModel).toBe('tiny')
})
