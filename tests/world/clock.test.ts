import { clockOf, worldMinutesFor, START_MINUTES } from '../../src/world/clock.ts'

test('the world starts on day 1 at 06:00', () => {
  expect(clockOf(START_MINUTES)).toMatchObject({ day: 1, hour: 6, minute: 0, night: false, label: '06:00, day 1' })
})
test('days roll over and night is flagged', () => {
  expect(clockOf(1440 * 2 + 630)).toMatchObject({ day: 3, hour: 10, minute: 30, label: '10:30, day 3', partOfDay: 'Morning' })
  expect(clockOf(21 * 60).night).toBe(true)
  expect(clockOf(5 * 60 + 59).night).toBe(true)
})
test('four in-world days per real day means one real minute is four world minutes', () => {
  expect(worldMinutesFor(60_000, 4)).toBe(4)
})
