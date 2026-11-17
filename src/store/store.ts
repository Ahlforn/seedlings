/** Everything the town keeps: the world, every turn, memory, diary, and what was spent. One SQLite file. */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { World } from '../shared/types.ts'

export type MemoryKind = 'person' | 'work' | 'fact' | 'moment'
export type MindKind = 'want' | 'worry' | 'question' | 'promise'

export type TurnRow = {
  id: number
  characterId: string
  kind: 'turn' | 'reflection'
  realTs: number
  worldMinutes: number
  observation: string
  systemPrompt: string
  userPrompt: string
  rawReply: string
  decision: string
  results: string
  model: string
  allowance: number
  inputTokens: number
  outputTokens: number
}
export type Memory = {
  id: number
  characterId: string
  text: string
  kind: MemoryKind
  strength: number
  recalled: number
  sinceMinutes: number
  lastRecalledMinutes: number
}
export type Belief = { characterId: string; key: string; text: string; evidence: number }
export type MindItem = { id: number; characterId: string; kind: MindKind; text: string; sinceMinutes: number }
export type DiaryEntry = {
  id: number
  characterId: string
  worldMinutes: number
  text: string
  fromTurn: number
  toTurn: number
}

export type Store = {
  saveWorld(w: World): void
  loadWorld(): World | null
  addTurn(t: Omit<TurnRow, 'id'>): number
  getTurn(id: number): TurnRow | null
  /** queued moves add their results later */
  setTurnResults(id: number, results: string): void
  /** kind 'turn' only, both ends included */
  turnsBetween(characterId: string, fromId: number, toId: number): TurnRow[]
  /** 0 when there is none */
  lastTurnId(characterId: string): number
  addMemory(m: { characterId: string; text: string; kind: MemoryKind; sinceMinutes: number }): number
  memories(characterId: string): Memory[]
  touchMemories(ids: number[], minutes: number): void
  strengthen(ids: number[]): void
  dropMemories(ids: number[]): void
  bumpBelief(characterId: string, key: string, text: string): void
  /** most evidence first */
  beliefs(characterId: string): Belief[]
  addMindItem(i: { characterId: string; kind: MindKind; text: string; sinceMinutes: number }): number
  /** newest first */
  openMindItems(characterId: string): MindItem[]
  closeMindItems(ids: number[]): void
  addDiary(e: Omit<DiaryEntry, 'id'>): number
  /** newest first */
  diary(characterId: string, limit: number, beforeId?: number): DiaryEntry[]
  diaryEntry(id: number): DiaryEntry | null
  addSpend(ts: number, characterId: string, amount: number): void
  /** from is included, to is not */
  spentBetween(fromTs: number, toTs: number): number
  /** 0 when there is no history */
  averageSpend(lastN: number): number
  getFlag(key: string): string | null
  setFlag(key: string, value: string | null): void
  close(): void
}

const SCHEMA = `
create table if not exists world (id integer primary key check (id = 1), json text not null);
create table if not exists turns (
  id integer primary key autoincrement,
  characterId text not null, kind text not null, realTs integer not null, worldMinutes real not null,
  observation text not null, systemPrompt text not null, userPrompt text not null, rawReply text not null,
  decision text not null, results text not null, model text not null,
  allowance real not null, inputTokens integer not null, outputTokens integer not null
);
create index if not exists turns_by_character on turns (characterId, id);
create table if not exists memories (
  id integer primary key autoincrement,
  characterId text not null, text text not null, kind text not null,
  strength integer not null default 1, recalled integer not null default 0,
  sinceMinutes real not null, lastRecalledMinutes real not null default 0
);
create index if not exists memories_by_character on memories (characterId);
create table if not exists beliefs (
  characterId text not null, key text not null, text text not null, evidence integer not null,
  primary key (characterId, key)
);
create table if not exists mind_items (
  id integer primary key autoincrement,
  characterId text not null, kind text not null, text text not null, sinceMinutes real not null,
  open integer not null default 1
);
create table if not exists diary (
  id integer primary key autoincrement,
  characterId text not null, worldMinutes real not null, text text not null,
  fromTurn integer not null, toTurn integer not null
);
create index if not exists diary_by_character on diary (characterId, id);
create table if not exists ledger (
  id integer primary key autoincrement, ts integer not null, characterId text not null, amount real not null
);
create index if not exists ledger_by_ts on ledger (ts);
create table if not exists flags (key text primary key, value text not null);
`

const TURN_COLUMNS =
  'characterId, kind, realTs, worldMinutes, observation, systemPrompt, userPrompt, rawReply, decision, results, model, allowance, inputTokens, outputTokens'

/** Opens the database, creating its folder and tables. Use ':memory:' in tests. */
export function openStore(path: string): Store {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)

  const each = (ids: number[], sql: string, ...before: unknown[]) => {
    const statement = db.prepare(sql)
    db.transaction(() => { for (const id of ids) statement.run(...before, id) })()
  }

  const saveWorld = db.prepare('insert into world (id, json) values (1, ?) on conflict (id) do update set json = excluded.json')
  const loadWorld = db.prepare('select json from world where id = 1')
  const addTurn = db.prepare(`insert into turns (${TURN_COLUMNS}) values (@${TURN_COLUMNS.split(', ').join(', @')})`)
  const getTurn = db.prepare('select * from turns where id = ?')
  const setTurnResults = db.prepare('update turns set results = ? where id = ?')
  const turnsBetween = db.prepare("select * from turns where characterId = ? and kind = 'turn' and id between ? and ? order by id")
  const lastTurnId = db.prepare("select coalesce(max(id), 0) as id from turns where characterId = ? and kind = 'turn'")
  const addMemory = db.prepare('insert into memories (characterId, text, kind, sinceMinutes) values (@characterId, @text, @kind, @sinceMinutes)')
  const memories = db.prepare('select * from memories where characterId = ? order by id')
  const bumpBelief = db.prepare(
    'insert into beliefs (characterId, key, text, evidence) values (?, ?, ?, 1) on conflict (characterId, key) do update set evidence = evidence + 1, text = excluded.text',
  )
  const beliefs = db.prepare('select characterId, key, text, evidence from beliefs where characterId = ? order by evidence desc, key')
  const addMindItem = db.prepare('insert into mind_items (characterId, kind, text, sinceMinutes) values (@characterId, @kind, @text, @sinceMinutes)')
  const openMindItems = db.prepare('select id, characterId, kind, text, sinceMinutes from mind_items where characterId = ? and open = 1 order by id desc')
  const addDiary = db.prepare('insert into diary (characterId, worldMinutes, text, fromTurn, toTurn) values (@characterId, @worldMinutes, @text, @fromTurn, @toTurn)')
  const diary = db.prepare('select * from diary where characterId = ? and id < ? order by id desc limit ?')
  const diaryEntry = db.prepare('select * from diary where id = ?')
  const addSpend = db.prepare('insert into ledger (ts, characterId, amount) values (?, ?, ?)')
  const spentBetween = db.prepare('select coalesce(sum(amount), 0) as total from ledger where ts >= ? and ts < ?')
  const averageSpend = db.prepare('select coalesce(avg(amount), 0) as average from (select amount from ledger order by id desc limit ?)')
  const getFlag = db.prepare('select value from flags where key = ?')
  const setFlag = db.prepare('insert into flags (key, value) values (?, ?) on conflict (key) do update set value = excluded.value')
  const clearFlag = db.prepare('delete from flags where key = ?')

  return {
    saveWorld: (w) => { saveWorld.run(JSON.stringify(w)) },
    loadWorld: () => {
      const row = loadWorld.get() as { json: string } | undefined
      return row ? (JSON.parse(row.json) as World) : null
    },
    addTurn: (t) => Number(addTurn.run(t).lastInsertRowid),
    getTurn: (id) => (getTurn.get(id) as TurnRow | undefined) ?? null,
    setTurnResults: (id, results) => { setTurnResults.run(results, id) },
    turnsBetween: (characterId, fromId, toId) => turnsBetween.all(characterId, fromId, toId) as TurnRow[],
    lastTurnId: (characterId) => (lastTurnId.get(characterId) as { id: number }).id,
    addMemory: (m) => Number(addMemory.run(m).lastInsertRowid),
    memories: (characterId) => memories.all(characterId) as Memory[],
    touchMemories: (ids, minutes) => each(ids, 'update memories set recalled = recalled + 1, lastRecalledMinutes = ? where id = ?', minutes),
    strengthen: (ids) => each(ids, 'update memories set strength = strength + 1 where id = ?'),
    dropMemories: (ids) => each(ids, 'delete from memories where id = ?'),
    bumpBelief: (characterId, key, text) => { bumpBelief.run(characterId, key, text) },
    beliefs: (characterId) => beliefs.all(characterId) as Belief[],
    addMindItem: (i) => Number(addMindItem.run(i).lastInsertRowid),
    openMindItems: (characterId) => openMindItems.all(characterId) as MindItem[],
    closeMindItems: (ids) => each(ids, 'update mind_items set open = 0 where id = ?'),
    addDiary: (e) => Number(addDiary.run(e).lastInsertRowid),
    diary: (characterId, limit, beforeId) => diary.all(characterId, beforeId ?? Number.MAX_SAFE_INTEGER, limit) as DiaryEntry[],
    diaryEntry: (id) => (diaryEntry.get(id) as DiaryEntry | undefined) ?? null,
    addSpend: (ts, characterId, amount) => { addSpend.run(ts, characterId, amount) },
    spentBetween: (fromTs, toTs) => (spentBetween.get(fromTs, toTs) as { total: number }).total,
    averageSpend: (lastN) => (averageSpend.get(lastN) as { average: number }).average,
    getFlag: (key) => (getFlag.get(key) as { value: string } | undefined)?.value ?? null,
    setFlag: (key, value) => { if (value === null) clearFlag.run(key); else setFlag.run(key, value) },
    close: () => { db.close() },
  }
}
