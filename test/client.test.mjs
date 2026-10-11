import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import MeshTool, {
  MeshToolError,
  MeshToolAuthError,
  MeshToolRateLimitError,
  MeshToolNetworkError,
  MeshToolTimeoutError,
} from '../dist/index.js'
import { startMock, json } from './helpers.mjs'

const KEY = 'sk_tz_test'
const FAST = { retryBaseMs: 1 } // keep backoff waits ~1ms in tests

describe('instantiation', () => {
  test('throws a MeshToolError when the key is missing', () => {
    assert.throws(() => new MeshTool(''), (err) => {
      assert.ok(err instanceof MeshToolError)
      assert.match(err.message, /MESHTOOL_API_KEY/)
      return true
    })
  })

  test('accepts a key with default options', () => {
    assert.ok(new MeshTool(KEY) instanceof MeshTool)
  })

  test('v0.2 back-compat: second positional arg as baseUrl string still works', async () => {
    const mock = await startMock((req, res) => json(res, 200, { ok: true }))
    const mt = new MeshTool(KEY, mock.url)
    const out = await mt.os({ message: 'hi' })
    assert.equal(out.ok, true)
    await mock.close()
  })
})

describe('round-trip', () => {
  test('analyze sends auth header + JSON body and parses the response', async () => {
    const reply = { recommendation: 'r', reasoning: 'x', actions: ['a'], confidence: 0.9, latency_ms: 5, tokens: { input: 1, output: 2 } }
    const mock = await startMock((req, res) => json(res, 200, reply))
    const mt = new MeshTool(KEY, { baseUrl: mock.url })
    const out = await mt.analyze({ context: 'ctx', goal: 'g' })
    assert.deepEqual(out, reply)
    assert.equal(mock.requests.length, 1)
    assert.equal(mock.requests[0].url, '/v1/analyze')
    assert.equal(mock.requests[0].headers.authorization, `Bearer ${KEY}`)
    assert.deepEqual(mock.requests[0].body, { context: 'ctx', goal: 'g' })
    await mock.close()
  })

  test('a 200 with a non-JSON body raises a descriptive MeshToolError', async () => {
    const mock = await startMock((req, res) => { res.writeHead(200); res.end('<html>not json</html>') })
    const mt = new MeshTool(KEY, { baseUrl: mock.url })
    await assert.rejects(mt.os({ message: 'hi' }), (err) => {
      assert.ok(err instanceof MeshToolError)
      assert.match(err.message, /not valid JSON/)
      return true
    })
    await mock.close()
  })
})

describe('typed errors', () => {
  test('401 → MeshToolAuthError with statusCode, requestId, hint — and no retry', async () => {
    const mock = await startMock((req, res) =>
      json(res, 401, { error: 'bad key' }, { 'x-request-id': 'req_123' }))
    const mt = new MeshTool(KEY, { baseUrl: mock.url, ...FAST })
    await assert.rejects(mt.analyze({ context: 'x' }), (err) => {
      assert.ok(err instanceof MeshToolAuthError)
      assert.ok(err instanceof MeshToolError)
      assert.equal(err.statusCode, 401)
      assert.equal(err.requestId, 'req_123')
      assert.match(err.message, /app\.meshtool\.ai/)
      return true
    })
    assert.equal(mock.requests.length, 1, '401 must never be retried')
    await mock.close()
  })

  test('other 4xx → MeshToolError with parsed details, no retry', async () => {
    const mock = await startMock((req, res) => json(res, 400, { error: 'context required' }))
    const mt = new MeshTool(KEY, { baseUrl: mock.url, ...FAST })
    await assert.rejects(mt.analyze({ context: '' }), (err) => {
      assert.ok(err instanceof MeshToolError)
      assert.ok(!(err instanceof MeshToolAuthError))
      assert.equal(err.statusCode, 400)
      assert.deepEqual(err.details, { error: 'context required' })
      assert.match(err.message, /context required/)
      return true
    })
    assert.equal(mock.requests.length, 1, '4xx must never be retried')
    await mock.close()
  })

  test('429 exhausted → MeshToolRateLimitError with retryAfter from the header', async () => {
    const mock = await startMock((req, res) =>
      json(res, 429, { error: 'slow down' }, { 'retry-after': '7' }))
    const mt = new MeshTool(KEY, { baseUrl: mock.url, retries: 0 })
    await assert.rejects(mt.analyze({ context: 'x' }), (err) => {
      assert.ok(err instanceof MeshToolRateLimitError)
      assert.equal(err.retryAfter, 7)
      assert.equal(err.statusCode, 429)
      return true
    })
    await mock.close()
  })

  test('Retry-After as an HTTP-date parses to seconds', async () => {
    const soon = new Date(Date.now() - 1000).toUTCString() // past date → clamps to 0
    const mock = await startMock((req, res) =>
      json(res, 429, {}, { 'retry-after': soon }))
    const mt = new MeshTool(KEY, { baseUrl: mock.url, retries: 0 })
    await assert.rejects(mt.analyze({ context: 'x' }), (err) => {
      assert.ok(err instanceof MeshToolRateLimitError)
      assert.equal(err.retryAfter, 0)
      return true
    })
    await mock.close()
  })

  test('connection failure → MeshToolNetworkError', async () => {
    const mock = await startMock(() => {})
    const deadUrl = mock.url
    await mock.close() // port is now closed
    const mt = new MeshTool(KEY, { baseUrl: deadUrl, retries: 0 })
    await assert.rejects(mt.analyze({ context: 'x' }), (err) => {
      assert.ok(err instanceof MeshToolNetworkError)
      assert.ok(!(err instanceof MeshToolTimeoutError))
      return true
    })
  })

  test('timeout → MeshToolTimeoutError (a MeshToolNetworkError subclass) carrying timeoutMs', async () => {
    const mock = await startMock(() => { /* never respond */ })
    const mt = new MeshTool(KEY, { baseUrl: mock.url, timeoutMs: 50, retries: 0 })
    await assert.rejects(mt.analyze({ context: 'x' }), (err) => {
      assert.ok(err instanceof MeshToolTimeoutError)
      assert.ok(err instanceof MeshToolNetworkError)
      assert.equal(err.timeoutMs, 50)
      assert.match(err.message, /timed out after 50ms/)
      return true
    })
    await mock.close()
  })
})

describe('retry behavior', () => {
  test('5xx retries with backoff until success (2 retries → 3 requests)', async () => {
    const mock = await startMock((req, res, record) => {
      if (record.index < 2) return json(res, 500, { error: 'boom' })
      json(res, 200, { ok: true })
    })
    const mt = new MeshTool(KEY, { baseUrl: mock.url, retries: 2, ...FAST })
    const out = await mt.os({ message: 'hi' })
    assert.equal(out.ok, true)
    assert.equal(mock.requests.length, 3)
    await mock.close()
  })

  test('persistent 5xx exhausts retries and throws the last error', async () => {
    const mock = await startMock((req, res) => json(res, 503, { error: 'down' }))
    const mt = new MeshTool(KEY, { baseUrl: mock.url, retries: 1, ...FAST })
    await assert.rejects(mt.os({ message: 'hi' }), (err) => {
      assert.equal(err.statusCode, 503)
      return true
    })
    assert.equal(mock.requests.length, 2)
    await mock.close()
  })

  test('429 then success is retried automatically', async () => {
    const mock = await startMock((req, res, record) => {
      if (record.index === 0) return json(res, 429, {}, { 'retry-after': '0' })
      json(res, 200, { ok: true })
    })
    const mt = new MeshTool(KEY, { baseUrl: mock.url, retries: 1, ...FAST })
    const out = await mt.os({ message: 'hi' })
    assert.equal(out.ok, true)
    assert.equal(mock.requests.length, 2)
    await mock.close()
  })

  test('Retry-After lengthens the backoff wait when it exceeds the exponential delay', async () => {
    let firstAt, secondAt
    const mock = await startMock((req, res, record) => {
      if (record.index === 0) { firstAt = Date.now(); return json(res, 429, {}, { 'retry-after': '1' }) }
      secondAt = Date.now()
      json(res, 200, { ok: true })
    })
    const mt = new MeshTool(KEY, { baseUrl: mock.url, retries: 1, ...FAST })
    await mt.os({ message: 'hi' })
    assert.ok(secondAt - firstAt >= 950, `waited only ${secondAt - firstAt}ms, expected ≥ ~1000ms`)
    await mock.close()
  })

  test('network errors are retried', async () => {
    const dead = await startMock(() => {})
    await dead.close()
    const mt = new MeshTool(KEY, { baseUrl: dead.url, retries: 2, ...FAST })
    const t0 = Date.now()
    await assert.rejects(mt.os({ message: 'hi' }), MeshToolNetworkError)
    assert.ok(Date.now() - t0 >= 2, 'should have slept between attempts')
  })

  test('per-request override: retries', async () => {
    const mock = await startMock((req, res, record) => {
      if (record.index < 2) return json(res, 500, {})
      json(res, 200, { ok: true })
    })
    const mt = new MeshTool(KEY, { baseUrl: mock.url, retries: 0, ...FAST })
    await assert.rejects(mt.os({ message: 'no retries' }))                    // client default: fails
    const out = await mt.analyze({ context: 'x' }, { retries: 2 })            // per-call override: succeeds
    assert.equal(out.ok, true)
    await mock.close()
  })

  test('per-request override: timeoutMs', async () => {
    const mock = await startMock(() => { /* never respond */ })
    const mt = new MeshTool(KEY, { baseUrl: mock.url, timeoutMs: 30_000, retries: 0 })
    await assert.rejects(mt.analyze({ context: 'x' }, { timeoutMs: 50 }), (err) => {
      assert.ok(err instanceof MeshToolTimeoutError)
      assert.equal(err.timeoutMs, 50)
      return true
    })
    await mock.close()
  })
})

describe('endpoint surface smoke test (every method hits the right path)', () => {
  test('all JSON methods round-trip through the hardened transport', async () => {
    const mock = await startMock((req, res) => {
      if (req.url === '/v1/extract') return json(res, 200, { data: { x: 1 } })
      if (req.url === '/v1/skills' && req.method === 'GET') return json(res, 200, { skills: ['s'] })
      if (req.url === '/v1/agents/marketplace') return json(res, 200, { agents: ['a'] })
      json(res, 200, { ok: true })
    })
    const mt = new MeshTool(KEY, { baseUrl: mock.url })

    const calls = [
      ['personalize', () => mt.personalize({ profile: {}, content: ['a'], goal: 'g' }), 'POST /v1/personalize'],
      ['orchestrate', () => mt.orchestrate({ task: 't', tools: ['x'] }), 'POST /v1/orchestrate'],
      ['run', () => mt.run({ brief: 'b' }), 'POST /v1/run'],
      ['migrate', () => mt.migrate({ files: {} }), 'POST /v1/migrate'],
      ['createStreamChannel', () => mt.createStreamChannel({ id: 'c' }), 'POST /v1/stream/channels'],
      ['sendStreamEvent', () => mt.sendStreamEvent({ channel: 'c', type: 'tip' }), 'POST /v1/stream/event'],
      ['setStreamRules', () => mt.setStreamRules({ id: 'c', rules: [] }), 'POST /v1/stream/rules'],
      ['createFusionJob', () => mt.createFusionJob({ creatorId: 'c', workflowId: 'w', mintMode: 'platform_native', listing: { enabled: false, pricingModel: 'fixed', basePriceUsd: 0, licenseType: 'personal' }, unlockPolicy: { mode: 'auto', maxActionsToUnlock: 0 }, metadata: { title: 't', description: 'd', tags: [] }, idempotencyKey: 'k' }), 'POST /v1/fusion/jobs'],
      ['getFusionJob', () => mt.getFusionJob('j1'), 'GET /v1/fusion/jobs/j1'],
      ['cancelFusionJob', () => mt.cancelFusionJob('j1'), 'POST /v1/fusion/jobs/j1/cancel'],
      ['getFusionAsset', () => mt.getFusionAsset('f1'), 'GET /v1/fusion/assets/f1'],
      ['publishFusionAssetListing', () => mt.publishFusionAssetListing('f1', { creatorId: 'c', title: 't' }), 'POST /v1/fusion/assets/f1/list'],
      ['extract', () => mt.extract({ text: 't', shape: {} }), 'POST /v1/extract'],
      ['listSkills', () => mt.listSkills(), 'GET /v1/skills'],
      ['acquireSkill', () => mt.acquireSkill('s1', 'buy'), 'POST /v1/skills/s1/acquire'],
      ['invokeSkill', () => mt.invokeSkill('s1', 'in'), 'POST /v1/skills/s1/invoke'],
      ['listAgents', () => mt.listAgents(), 'GET /v1/agents/marketplace'],
      ['acquireAgent', () => mt.acquireAgent('a1', 'rent'), 'POST /v1/agents/a1/acquire'],
      ['runAgent', () => mt.runAgent('a1', 'task'), 'POST /v1/agents/run'],
      ['getJob', () => mt.getJob('j1'), 'GET /v1/agents/jobs/j1'],
      ['generateBrainMissions', () => mt.generateBrainMissions({ creator_id: 'c' }), 'POST /v1/brain/missions/generate'],
      ['listBrainMissions', () => mt.listBrainMissions({ creator_id: 'c', status: 'generated', limit: 5 }), 'GET /v1/brain/missions?creator_id=c&status=generated&limit=5'],
      ['listBrainMissions (no filter)', () => mt.listBrainMissions(), 'GET /v1/brain/missions'],
      ['getBrainMission', () => mt.getBrainMission('m1'), 'GET /v1/brain/missions/m1'],
      ['claimBrainMission', () => mt.claimBrainMission({ mission_id: 'm1', claimer_type: 'agent', claimer_id: 'a' }), 'POST /v1/brain/missions/claim'],
      ['completeBrainMission', () => mt.completeBrainMission({ mission_id: 'm1', completed_by: 'a' }), 'POST /v1/brain/missions/complete'],
      ['os', () => mt.os({ message: 'hi' }), 'POST /v1/os'],
    ]

    for (const [name, fn, expected] of calls) {
      const before = mock.requests.length
      await assert.doesNotReject(fn, `${name} rejected`)
      const req = mock.requests[before]
      assert.equal(`${req.method} ${req.url}`, expected, `${name} hit the wrong endpoint`)
    }

    // Special return shapes
    assert.deepEqual(await mt.extract({ text: 't', shape: {} }), { x: 1 })
    assert.deepEqual(await mt.listSkills(), ['s'])
    assert.deepEqual(await mt.listAgents(), ['a'])
    await mock.close()
  })
})

describe('SSE streaming', () => {
  test('runStream parses data: lines and skips [DONE] + malformed frames', async () => {
    const mock = await startMock((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"type":"start","job_type":"demo"}\n')
      res.write('data: {"type":"step","step":1,"total":1,"action":"a","output":"o"}\n')
      res.write('data: not-json\n')
      res.write('data: [DONE]\n')
      res.end()
    })
    const mt = new MeshTool(KEY, { baseUrl: mock.url })
    const events = []
    await mt.runStream({ brief: 'b' }, (e) => events.push(e))
    assert.equal(events.length, 2)
    assert.equal(events[0].type, 'start')
    assert.equal(events[1].step, 1)
    assert.equal(mock.requests[0].headers.accept, 'text/event-stream')
    await mock.close()
  })

  test('runStream surfaces a typed error on a non-OK response', async () => {
    const mock = await startMock((req, res) => json(res, 401, { error: 'no' }))
    const mt = new MeshTool(KEY, { baseUrl: mock.url })
    await assert.rejects(mt.runStream({ brief: 'b' }, () => {}), MeshToolAuthError)
    await mock.close()
  })

  test('streamFusionJob parses event/data frames', async () => {
    const mock = await startMock((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('event: phase\ndata: {"phase":"mint","progress":50,"ts":"t"}\n\n')
      res.write('event: completed\ndata: {"jobId":"j1","status":"succeeded","outputs":{}}\n\n')
      res.end()
    })
    const mt = new MeshTool(KEY, { baseUrl: mock.url })
    const events = []
    await mt.streamFusionJob('j1', (e) => events.push(e))
    assert.equal(events.length, 2)
    assert.equal(events[0].event, 'phase')
    assert.equal(events[0].data.progress, 50)
    assert.equal(events[1].event, 'completed')
    await mock.close()
  })

  test('streamFusionJob surfaces a typed error on a non-OK response', async () => {
    const mock = await startMock((req, res) => json(res, 500, { error: 'down' }))
    const mt = new MeshTool(KEY, { baseUrl: mock.url })
    await assert.rejects(mt.streamFusionJob('j1', () => {}), (err) => {
      assert.ok(err instanceof MeshToolError)
      assert.equal(err.statusCode, 500)
      return true
    })
    await mock.close()
  })
})
