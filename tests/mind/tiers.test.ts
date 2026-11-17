import { createWorld, character, PIP_ID } from '../../src/world/world.ts'
import { loadConfig } from '../../src/config.ts'
import { MINDS, modelFor, sheetFor } from '../../src/mind/tiers.ts'
import { PIP_SHEET } from '../../src/mind/sheet.ts'
import { addInhabitant } from '../world/helpers.ts'

test('Pip keeps its own sheet and model; an inhabitant gets what Pip wrote and the small model', () => {
  const config = loadConfig({ SEEDLINGS_PASSWORD: 'p', SEEDLINGS_FAKE_MODEL: '1' })
  const w = createWorld(1); const mo = addInhabitant(w, 'Mo', { x: 1, y: 1 })
  mo.sheet = { name: 'Mo', you: 'a moth', core: 'Shy.', traits: ['shy'], values: ['quiet'], fears: ['noise'] }
  expect(sheetFor(character(w, PIP_ID))).toBe(PIP_SHEET); expect(sheetFor(mo).you).toBe('a moth')
  expect(modelFor(character(w, PIP_ID), config)).toBe('glm-5.2'); expect(modelFor(mo, config)).toBe('glm-5.3-flash')
  expect(MINDS.inhabitant.memoryCap).toBeLessThan(MINDS.origin.memoryCap)
  expect(MINDS.inhabitant.pool).toBe('inhabitants'); expect(MINDS.origin.pool).toBe('origin')
})
test('an inhabitant with no sheet still has someone to be', () => {
  const w = createWorld(1); const mo = addInhabitant(w, 'Mo', { x: 1, y: 1 })
  expect(sheetFor(mo)).toMatchObject({ name: 'Mo', you: 'a small creature', core: 'Mo lives in the town Pip built.' })
})
