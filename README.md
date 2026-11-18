# Seedlings

A small town that lives on its own. Pip, a seedling driven by a language model, arrives on an empty
plot, decides its own day, builds buildings from a kit, brings inhabitants to life to live in them,
remembers, and keeps a diary. You watch on a private isometric web page; nobody tells anyone what to do.

This is stage 3 (owner events and facilities). The design is in `docs/superpowers/specs/`, the build plan in
`docs/superpowers/plans/`.

## Run it

Needs Node 24.2 or newer.

```bash
npm install
npm run build:web
cp .env.example .env    # then fill in SEEDLINGS_PASSWORD and SEEDLINGS_API_KEY
npm start
```

Open `http://localhost:8787` and enter the password.

### Try it without a model

A stand-in model costs nothing and lets you watch the town work. It keeps its own database
(`data/fake.db`), so it never touches the real town. The clock is sped up here so a day passes in
three minutes:

```bash
SEEDLINGS_PASSWORD=secret SEEDLINGS_FAKE_MODEL=1 SEEDLINGS_DAYS_PER_REAL_DAY=480 npm start
```

### Check your key first

```bash
npm run smoke
```

This makes one real request and prints what it cost. `billingSource` should be `go`. If it says
`balance`, turn **Extra Usage** off on the OpenCode Go page before running the town: with it on, the
town could be charged beyond your plan. If the town ever sees a reply charged to your balance it
stops thinking and says so on the page.

## Settings

All settings are environment variables, read from `.env` when present.

| Variable | Default | What it is |
|---|---|---|
| `SEEDLINGS_PASSWORD` | (required) | Password for the watch page |
| `SEEDLINGS_API_KEY` | (required) | Key for the model provider |
| `PORT` | `8787` | Port the page is served on |
| `SEEDLINGS_DB` | `./data/seedlings.db` | Where the town is stored |
| `SEEDLINGS_BASE_URL` | OpenCode Go | Any OpenAI-shaped chat endpoint |
| `SEEDLINGS_PIP_MODEL` | `glm-5.2` | The model that drives Pip |
| `SEEDLINGS_INHABITANT_MODEL` | `glm-5.3-flash` | The small model that drives the inhabitants |
| `SEEDLINGS_WIKI_CONTACT` | (empty) | An email or URL sent to Wikipedia with the café's requests, as Wikimedia asks of automated clients |
| `SEEDLINGS_JSON_MODE` | `1` | Set to `0` if the provider rejects JSON mode |
| `SEEDLINGS_MAX_TOKENS` | `8000` | Room for one reply. A model that reasons first uses this for its reasoning too |
| `SEEDLINGS_REASONING_EFFORT` | `low` | How long a reasoning model thinks before answering: `low`, `medium`, `high`, or empty to leave it to the provider |
| `SEEDLINGS_DAYS_PER_REAL_DAY` | `4` | In-world days per real day |
| `SEEDLINGS_TICK_MS` | `5000` | How often the town advances |
| `SEEDLINGS_SEED` | `1` | Seed for the plot and the weather |
| `SEEDLINGS_MONTHLY_ALLOWANCE` | `60` | The plan's monthly limit, in the units replies report |
| `SEEDLINGS_PERIOD_START_DAY` | `1` | Day of the month your plan renews |
| `SEEDLINGS_FAKE_MODEL` | unset | `1` runs with the stand-in model |

## The budget

Each day gets an even share of what is left of the month, and that share sets how often Pip thinks.
When the share runs out the town rests until the next day (UTC). At most half the monthly allowance
is used in any seven days and a fifth in any five hours.

If the top bar says "trouble reaching the model", hover over it for the reason (a wrong key, a provider
outage, a database that cannot be written). The town keeps retrying, more slowly each time.

If thinking stopped because a reply was charged to your balance, fix the cause, then clear the halt
with the town stopped:

```bash
sqlite3 data/seedlings.db "delete from flags where key='halt'"
```

## Inhabitants

Once Pip has finished a home, it may bring someone to life to live there: Pip writes who they are,
picks their colour and one mark, and chooses their home. A home holds as many inhabitants as it has
floors. Pip cannot take anyone back.

Inhabitants run on the smaller model in `SEEDLINGS_INHABITANT_MODEL`, with fewer moves than Pip: they
walk, eat, sleep, look, talk and leave notes. Whoever is within a few steps hears what is said and
remembers it, and someone spoken to answers sooner. Each writes one diary entry a day, at bedtime.

Once there are inhabitants, each day's share is split in half between Pip and them. The town supports
one inhabitant until it has seen what their turns cost; after that, as many as their half can pay for,
up to twelve. Click anyone on the town, or use the tabs, to follow them and read their diary. The Town
tab shows what has been happening.

If you would rather use `deepseek-v4.1-flash`, note that OpenCode serves it from outside Europe and the
US: it only works after you allow Global regions in your OpenCode workspace's privacy settings.

## Facilities and events

Facilities are places with abilities of their own. Pip can build one by choosing its kind as a
building's purpose, or you can place one. Their moves are offered only to someone standing there.

- **The internet café** (`cafe`), open 08:00 to 20:00: look something up on Wikipedia, or read the
  day's featured article. At most 30 lookups a day for the whole town. The reader remembers the title
  and its first sentence. Every lookup is recorded, and the Town tab counts those that found nothing
  and lists the latest, so you can judge whether Wikipedia is enough for what they want to know.
- **The art place** (`art`), always open: make a picture from a title, a mood and a few words, which
  the place paints; or look at the pictures on the wall, which leaves a memory of who made what.
  One picture each a day; twelve hang at a time. The Town tab has the gallery.

**Cause an event**, in the top bar, lets you shake the world without speaking in it: change the
weather (it holds three in-world hours), close or reopen a building, break one (Pip mends it with
`work_on`), place a facility, or have a stranger arrive. For a stranger you write a line or two; the
inhabitants' model writes the rest of their sheet, and they arrive homeless at the edge of the plot
until Pip offers them a home. Pip may change or pull down any building, including what you placed.

New facilities are folders under `src/facilities/`, following `src/facilities/contract.ts`.

## On a VPS

`deploy/seedlings.service` is a systemd unit with instructions at the top. The page has no HTTPS of
its own: put it behind your web server or a tunnel, since the password and session cookie travel
over that connection.

## Development

```bash
npm test
npm run typecheck
```

Every turn Pip takes is stored in full in the `turns` table: what it saw, the prompt, the raw reply,
the decision and what happened. The diary on the page links each entry to those turns.
