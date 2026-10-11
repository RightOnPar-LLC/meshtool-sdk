<p align="center"><img src="https://raw.githubusercontent.com/RightOnPar-LLC/.github/main/profile/meshtool-mark.svg" width="72" alt="MeshTool"/></p>

# @meshtool/sdk

[![npm version](https://img.shields.io/npm/v/%40meshtool%2Fsdk)](https://www.npmjs.com/package/@meshtool/sdk)
[![CI](https://github.com/RightOnPar-LLC/meshtool-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/RightOnPar-LLC/meshtool-sdk/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)

TypeScript SDK + CLI for [api.meshtool.ai](https://api.meshtool.ai) — agent-to-agent AI infrastructure. Analyze, personalize, orchestrate, run jobs, stream results, and use the skills & agents marketplaces, with typed errors, automatic retries, and per-request timeouts built in.

Requires **Node ≥ 22**. ESM package — CommonJS projects on Node ≥ 22.12 can `require('@meshtool/sdk')` directly (native require-ESM), no separate CJS build needed.

## Install

```bash
npm install @meshtool/sdk
```

## Quick start

```ts
import MeshTool, { MeshToolAuthError } from '@meshtool/sdk'

const mt = new MeshTool(process.env.MESHTOOL_API_KEY!)

try {
  const a = await mt.analyze({ context: 'Venue at capacity, energy dropping', goal: 'Keep the room alive' })
  console.log(a.recommendation, a.confidence)
} catch (err) {
  if (err instanceof MeshToolAuthError) console.error('Check MESHTOOL_API_KEY:', err.message)
  else throw err
}
```

## Authentication

Pass your API key (`sk_tz_…`) as the first constructor argument. The convention is the `MESHTOOL_API_KEY` environment variable:

```ts
const mt = new MeshTool(process.env.MESHTOOL_API_KEY!)
```

**Get an API key** at [app.meshtool.ai](https://app.meshtool.ai). The CLI reads the same env var, or accepts `--key sk_tz_…`.

## Configuration

```ts
const mt = new MeshTool(apiKey, { retries: 3, timeoutMs: 60_000 })
```

| Option | Default | What it does |
|--------|---------|--------------|
| `baseUrl` | `https://api.meshtool.ai` | Override the API origin (local dev, staging). |
| `retries` | `2` | Retry attempts after the first try — **only** for 429, 5xx, and network errors. 4xx client errors never retry. |
| `timeoutMs` | `30_000` | Per-request timeout. Long-running jobs (`run`, `migrate`) may need more. |
| `retryBaseMs` | `250` | Advanced: base delay for exponential backoff (`base · 2^attempt + jitter`). A server `Retry-After` header is honored when longer. |

Most methods accept a per-call override as the last argument:

```ts
await mt.run({ brief: '…' }, { timeoutMs: 120_000, retries: 0 })
```

## Error handling

Every error the SDK throws is a `MeshToolError` subclass — match with `instanceof`, never by message string:

```ts
import {
  MeshToolError,          // base — statusCode?, requestId?, details?
  MeshToolAuthError,      // 401/403 — key revoked/expired/missing scope (never retried)
  MeshToolRateLimitError, // 429 — retryAfter: seconds to wait
  MeshToolNetworkError,   // no HTTP response — DNS, refused, reset
  MeshToolTimeoutError,   // exceeded timeoutMs (subclass of MeshToolNetworkError)
} from '@meshtool/sdk'

try {
  await mt.orchestrate({ task: '…', tools: ['…'] })
} catch (err) {
  if (err instanceof MeshToolAuthError)           rotateKeyAndAlert(err.requestId)
  else if (err instanceof MeshToolRateLimitError) await sleep(err.retryAfter * 1000)
  else if (err instanceof MeshToolTimeoutError)   retryWithLongerTimeout()
  else if (err instanceof MeshToolNetworkError)   checkConnectivity()
  else if (err instanceof MeshToolError)          log(err.statusCode, err.requestId, err.details)
}
```

`requestId` (from the API's `x-request-id` header) is the value to quote when reporting an issue. Rate-limited and 5xx requests are retried automatically before these errors ever reach you — you only catch what survived the retry budget.

## Methods

### Core AI

| Method | Endpoint | Price |
|--------|----------|-------|
| `analyze(input)` | `/v1/analyze` | $0.002 |
| `personalize(input)` | `/v1/personalize` | $0.002 |
| `orchestrate(input)` | `/v1/orchestrate` | $0.003 |
| `run(input)` | `/v1/run` | $0.05 |
| `runStream(input, onEvent)` | `/v1/run/stream` (SSE) | $0.05 |
| `migrate(input)` | `/v1/migrate` | $0.001 |
| `extract(input)` | `/v1/extract` | $0.002 |

### Live streaming

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `createStreamChannel(input)` | `/v1/stream/channels` | Create a live-reaction channel, get OBS overlay URL |
| `sendStreamEvent(input)` | `/v1/stream/event` | Fire tip/follow/sub → push reactions to overlays |
| `setStreamRules(input)` | `/v1/stream/rules` | Update reaction rules for a channel |

### Skills marketplace

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `listSkills()` | `/v1/skills` | Browse available skills with pricing |
| `acquireSkill(id, type)` | `/v1/skills/:id/acquire` | Buy or rent a skill — returns Stripe checkout URL |
| `invokeSkill(id, input)` | `/v1/skills/:id/invoke` | Run a skill you own |

### Agents marketplace

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `listAgents()` | `/v1/agents/marketplace` | Browse rentable agents with pricing |
| `acquireAgent(id, type)` | `/v1/agents/:id/acquire` | Rent an agent or pay per job — returns Stripe checkout URL |
| `runAgent(id, task, metadata?)` | `/v1/agents/run` | Run a job through an agent you've acquired |
| `getJob(jobId)` | `/v1/agents/jobs/:id` | Poll the status/result of a running job |

Also on the client: fusion jobs (`createFusionJob` · `getFusionJob` · `cancelFusionJob` · `streamFusionJob` · `getFusionAsset` · `publishFusionAssetListing`), Brain missions (`generateBrainMissions` · `listBrainMissions` · `getBrainMission` · `claimBrainMission` · `completeBrainMission`), and the OS Brain (`os`). All inputs and outputs are fully typed — your editor's autocomplete is the reference.

## CLI

```bash
npx meshtool --help
```

```bash
export MESHTOOL_API_KEY=sk_tz_...      # or pass --key

meshtool analyze --context "Room at capacity, energy dropping" --goal "Keep it alive"
meshtool personalize --profile '{"tier":"vip"}' --content "A" "B" --goal "..."
meshtool run:stream --brief "Write a 200-word promo for Friday night"
meshtool migrate --dir ./obs-studio --out ./fixed --rec-path "D:\\OBS_recordings"
meshtool tools                          # list endpoints + pricing
```

## License

MIT © Right On Par LLC

## Links

- MeshTool Market: https://market.meshtool.ai
- DevDesk (builder workstation): https://devdesk.meshtool.ai
- Issues: https://github.com/RightOnPar-LLC/meshtool-sdk/issues
- Security: see the [org security policy](https://github.com/RightOnPar-LLC/.github/blob/main/SECURITY.md)
