# Seedlings

A small town that lives on its own. Pip, a seedling driven by a language model, arrives on an empty
plot, decides its own day, builds buildings from a kit, remembers, and keeps a diary. You watch on a
private isometric web page; nobody tells Pip what to do.

This is stage 1 (Pip alone). The design is in `docs/superpowers/specs/`, the build plan in
`docs/superpowers/plans/`.

## Run it

Needs Node 24 or newer.

```bash
npm install
npm run build:web
cp .env.example .env    # then fill in SEEDLINGS_PASSWORD and SEEDLINGS_API_KEY
npm start
```

Open `http://localhost:8787` and enter the password.

### Try it without a model

A stand-in model costs nothing and lets you watch the town work. The clock is sped up here so a day
passes in three minutes:

```bash
SEEDLINGS_PASSWORD=secret SEEDLINGS_FAKE_MODEL=1 SEEDLINGS_DAYS_PER_REAL_DAY=480 SEEDLINGS_DB=./data/fake.db npm start
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
| `SEEDLINGS_JSON_MODE` | `1` | Set to `0` if the provider rejects JSON mode |
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

If thinking stopped because a reply was charged to your balance, fix the cause, then clear the halt
with the town stopped:

```bash
sqlite3 data/seedlings.db "delete from flags where key='halt'"
```

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
