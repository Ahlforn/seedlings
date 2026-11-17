/** In-world time. The world counts minutes; everything else is derived. */

export const START_MINUTES = 360 // day 1, 06:00

export type Clock = {
  day: number
  hour: number
  minute: number
  night: boolean
  label: string
  partOfDay: string
}

function partOfDay(hour: number): string {
  if (hour >= 5 && hour < 8) return 'Early morning'
  if (hour >= 8 && hour < 11) return 'Morning'
  if (hour >= 11 && hour < 14) return 'Midday'
  if (hour >= 14 && hour < 18) return 'Afternoon'
  if (hour >= 18 && hour < 21) return 'Evening'
  return 'Night'
}

const two = (n: number) => String(n).padStart(2, '0')

export function clockOf(worldMinutes: number): Clock {
  const whole = Math.floor(worldMinutes)
  const day = Math.floor(whole / 1440) + 1
  const hour = Math.floor((whole % 1440) / 60)
  const minute = whole % 60
  return {
    day,
    hour,
    minute,
    night: hour < 6 || hour >= 21,
    label: `${two(hour)}:${two(minute)}, day ${day}`,
    partOfDay: partOfDay(hour),
  }
}

export function worldMinutesFor(realMs: number, daysPerRealDay: number): number {
  return (realMs * daysPerRealDay) / 60_000
}
