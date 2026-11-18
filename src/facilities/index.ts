/** Every facility the town knows. A new facility is a folder under src/facilities and one line here. */

import type { Facility } from './contract.ts'

export const FACILITIES: Facility[] = []

export function facilityOf(kind: string | null): Facility | undefined {
  return kind === null ? undefined : FACILITIES.find((f) => f.kind === kind)
}
