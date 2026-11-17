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
