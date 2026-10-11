/**
 * MeshTool SDK — TypeScript client for api.meshtool.ai
 *
 * Usage:
 *   import MeshTool from '@meshtool/sdk'
 *   const mt = new MeshTool('sk_tz_...')
 *   const result = await mt.analyze({ context: 'Venue at capacity', goal: 'Keep energy up' })
 */

import {
  MeshToolError,
  MeshToolAuthError,
  MeshToolRateLimitError,
  MeshToolNetworkError,
  MeshToolTimeoutError,
} from './errors.js'

export * from './errors.js'

const BASE_URL = 'https://api.meshtool.ai'

// ── Options ───────────────────────────────────────────────────────────────────

export interface MeshToolOptions {
  /** Override the API origin (e.g. a local dev server). Default: https://api.meshtool.ai */
  baseUrl?: string
  /** Retry attempts after the first try — only for 429, 5xx, and network errors. Default: 2 */
  retries?: number
  /** Per-request timeout in milliseconds. Default: 30_000 */
  timeoutMs?: number
  /** Advanced: base delay in ms for exponential backoff between retries. Default: 250 */
  retryBaseMs?: number
}

/** Per-call overrides, accepted as the last argument of most methods. */
export interface RequestOptions {
  /** Override the client-level timeout for this one call. */
  timeoutMs?: number
  /** Override the client-level retry count for this one call. */
  retries?: number
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AnalyzeInput {
  context:      string
  goal?:        string
  constraints?: string[]
}
export interface AnalyzeOutput {
  recommendation: string
  reasoning:      string
  actions:        string[]
  confidence:     number
  latency_ms:     number
  tokens:         { input: number; output: number }
}

export interface PersonalizeInput {
  profile:  Record<string, unknown>
  content:  string[]
  goal:     string
}
export interface PersonalizeOutput {
  selected:   string[]
  headline:   string
  hook:       string
  avoid:      string[]
  latency_ms: number
  tokens:     { input: number; output: number }
}

export interface OrchestrateStep {
  step:   number
  action: string
  tool:   string
  output: string
}
export interface OrchestrateInput {
  task:     string
  tools:    string[]
  context?: Record<string, unknown>
}
export interface OrchestrateOutput {
  plan:       OrchestrateStep[]
  summary:    string
  estimated:  number
  latency_ms: number
  tokens:     { input: number; output: number }
}

export interface RunInput {
  brief:    string
  context?: Record<string, unknown>
}
export interface RunOutput {
  deliverable:     string
  job_type:        string
  steps_completed: number
  steps_failed:    number
  plan:            OrchestrateStep[]
  errors?:         Array<{ step: number; error: string }>
  latency_ms?:     number
  tokens:          { input: number; output: number }
}

export type RunEvent =
  | { type: 'start'; job_type: string }
  | { type: 'plan'; steps: number; summary: string; plan: OrchestrateStep[] }
  | { type: 'step'; step: number; total: number; action: string; output: string }
  | { type: 'complete'; deliverable: string; job_type: string; steps_completed: number; steps_failed: number; tokens: { input: number; output: number } }
  | { type: 'error'; message: string }

export interface ExtractInput {
  text:          string
  shape:         Record<string, unknown> | string
  instructions?: string
}

export interface MigrateInput {
  files:       Record<string, string>
  rec_path?:   string
  media_path?: string
}
export interface MigrateOutput {
  files:        Record<string, string>
  changes:      string[]
  manual_steps: string[]
  latency_ms:   number
}

export interface StreamChannelInput {
  id:     string
  rules?: unknown[]
}
export interface StreamChannelOutput {
  id:             string
  overlay_url:    string
  overlay_token:  string
  event_endpoint: string
  rules:          unknown[]
}

export interface StreamEventInput {
  channel:  string
  type:     'tip' | 'follow' | 'sub' | 'raid' | string
  amount?:  number
  from?:    string
  message?: string
}
export interface StreamEventOutput {
  matched:            number
  reactions:          Array<Record<string, unknown>>
  overlays_connected: number
  delivered:          number
  latency_ms:         number
}

export interface FusionJobRequest {
  creatorId: string
  workflowId: string
  workflowVersion?: string
  mintMode: 'platform_native' | 'platform_plus_chain'
  listing: {
    enabled: boolean
    pricingModel: 'fixed' | 'license_tiered' | 'rev_share'
    basePriceUsd: number
    licenseType: 'personal' | 'commercial' | 'exclusive'
    revenueShareBps?: number
  }
  unlockPolicy: {
    mode: 'auto' | 'review_required'
    maxActionsToUnlock: number
  }
  metadata: {
    title: string
    description: string
    tags: string[]
  }
  idempotencyKey: string
}

export interface FusionJobCreateResponse {
  jobId: string
  status: 'queued' | 'running'
  streamUrl: string
  resourceUrl: string
}

export interface FusionJobResponse {
  jobId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  phase: 'validate' | 'graph_build' | 'mint' | 'brain_bind' | 'listing' | 'finalize'
  progress: number
  outputs: {
    capabilityNodeIds: string[]
    fusionAssetId?: string
    listingId?: string
    unlockedActionIds: string[]
  }
  error: { code: string; message: string; retryable: boolean } | null
}

export type FusionStreamEvent =
  | { event: 'phase'; data: { phase: FusionJobResponse['phase']; progress: number; ts: string } }
  | { event: 'artifact'; data: { type: 'capability_node' | 'fusion_asset' | 'listing' | 'action_unlock'; id: string; ts: string } }
  | { event: 'warning'; data: { code: string; message: string; ts: string } }
  | { event: 'completed'; data: { jobId: string; status: 'succeeded'; outputs: FusionJobResponse['outputs'] } }
  | { event: 'failed'; data: { jobId: string; status: 'failed'; error: { code: string; message: string; retryable: boolean } } }

export interface BrainMission {
  id: string
  creator_id: string
  mission_type: string
  title: string
  description: string
  difficulty: number
  priority_score: number
  reward_type: 'unlock' | 'token_credit' | 'nft_mint' | 'marketplace_boost' | 'gpu_credit'
  reward_payload: Record<string, unknown>
  required_capabilities: string[]
  required_assets: string[]
  status: 'generated' | 'claimed' | 'completed' | 'failed' | 'expired'
  generated_at: string
  expires_at: string | null
}

export interface BrainMissionGenerateResponse {
  count: number
  missions: Array<{
    mission: BrainMission
    score: {
      impact_score: number
      feasibility_score: number
      urgency_score: number
      world_alignment_score: number
      priority_score: number
    }
    route: {
      mission_id: string
      route_to: 'creator' | 'agent'
      target_id: string
      reason: string
    }
  }>
}

// ── Transport helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Parse a Retry-After header — integer seconds or HTTP-date — into seconds (0 if absent/unparseable). */
function parseRetryAfter(header: string | null): number {
  if (!header) return 0
  const secs = Number(header)
  if (Number.isFinite(secs)) return Math.max(0, secs)
  const date = Date.parse(header)
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000))
  return 0
}

/** Only 429, 5xx, and network/timeout failures are worth retrying. 4xx means fix the request. */
function isRetryable(err: MeshToolError): boolean {
  if (err instanceof MeshToolAuthError) return false
  if (err instanceof MeshToolNetworkError || err instanceof MeshToolRateLimitError) return true
  return err.statusCode !== undefined && err.statusCode >= 500
}

// ── Client ────────────────────────────────────────────────────────────────────

export class MeshTool {
  private readonly headers: Record<string, string>
  private readonly baseUrl: string
  private readonly retries: number
  private readonly timeoutMs: number
  private readonly retryBaseMs: number

  constructor(apiKey: string, options: string | MeshToolOptions = {}) {
    if (!apiKey) {
      throw new MeshToolError(
        'MeshTool: apiKey is required. Keys look like "sk_tz_…" — set MESHTOOL_API_KEY and pass process.env.MESHTOOL_API_KEY, or get one at https://app.meshtool.ai',
      )
    }
    // Back-compat: v0.2 accepted `new MeshTool(key, baseUrl)`.
    const opts = typeof options === 'string' ? { baseUrl: options } : options
    this.baseUrl     = (opts.baseUrl ?? BASE_URL).replace(/\/+$/, '')
    this.retries     = opts.retries ?? 2
    this.timeoutMs   = opts.timeoutMs ?? 30_000
    this.retryBaseMs = opts.retryBaseMs ?? 250
    this.headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    }
  }

  private get base(): string {
    return this.baseUrl
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    const retries   = opts.retries ?? this.retries
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs
    let lastError: MeshToolError | undefined

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(this.backoffMs(attempt, lastError))
      try {
        return await this.attempt<T>(method, path, body, timeoutMs)
      } catch (err) {
        if (!(err instanceof MeshToolError)) throw err
        lastError = err
        if (!isRetryable(err) || attempt === retries) throw err
      }
    }
    // Unreachable: the loop always returns or throws on its last attempt.
    throw lastError ?? new MeshToolError('MeshTool: retry loop exited without a result')
  }

  /** Exponential backoff with jitter; a rate-limit's Retry-After wins when it is longer. */
  private backoffMs(attempt: number, lastError?: MeshToolError): number {
    const exp = this.retryBaseMs * 2 ** (attempt - 1) + Math.random() * this.retryBaseMs
    if (lastError instanceof MeshToolRateLimitError && lastError.retryAfter > 0) {
      return Math.max(exp, lastError.retryAfter * 1000)
    }
    return exp
  }

  private async attempt<T>(method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers,
        body:    body === undefined ? undefined : JSON.stringify(body),
        signal:  AbortSignal.timeout(timeoutMs),
      })
    } catch (cause) {
      const name = (cause as Error)?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new MeshToolTimeoutError(
          `MeshTool ${method} ${path} timed out after ${timeoutMs}ms. Long jobs may need a higher timeoutMs — pass { timeoutMs } to the constructor or to this call.`,
          timeoutMs,
          { cause },
        )
      }
      throw new MeshToolNetworkError(
        `MeshTool ${method} ${path} failed before a response arrived (${(cause as Error)?.message ?? String(cause)}). Check connectivity and that ${this.baseUrl} is reachable.`,
        { cause },
      )
    }

    const requestId = res.headers.get('x-request-id') ?? undefined
    if (res.ok) {
      try {
        return await res.json() as T
      } catch (cause) {
        throw new MeshToolError(
          `MeshTool ${method} ${path} returned ${res.status} but the body was not valid JSON.`,
          { statusCode: res.status, requestId, cause },
        )
      }
    }
    throw await this.responseError(method, path, res, requestId)
  }

  private async responseError(method: string, path: string, res: Response, requestId?: string): Promise<MeshToolError> {
    const details = await res.json().catch(() => undefined)
    const apiMessage =
      details && typeof details === 'object'
        ? String((details as Record<string, unknown>).error ?? (details as Record<string, unknown>).message ?? '')
        : ''
    const init = { statusCode: res.status, requestId, details }

    if (res.status === 401 || res.status === 403) {
      return new MeshToolAuthError(
        `MeshTool rejected the API key (${res.status}${apiMessage ? `: ${apiMessage}` : ''}). The key may be revoked, expired, or missing a scope — check MESHTOOL_API_KEY or mint a fresh key at https://app.meshtool.ai`,
        init,
      )
    }
    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
      return new MeshToolRateLimitError(
        `MeshTool rate-limited ${method} ${path} (429). ${retryAfter > 0 ? `Retry after ${retryAfter}s.` : 'Back off and retry.'} The client retries this automatically when retries remain.`,
        retryAfter,
        init,
      )
    }
    return new MeshToolError(
      `MeshTool ${method} ${path} ${res.status}${apiMessage ? `: ${apiMessage}` : ''}`,
      init,
    )
  }

  private post<T>(path: string, body: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, opts)
  }

  private get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, opts)
  }

  analyze(input: AnalyzeInput, opts?: RequestOptions): Promise<AnalyzeOutput> {
    return this.post('/v1/analyze', input, opts)
  }

  personalize(input: PersonalizeInput, opts?: RequestOptions): Promise<PersonalizeOutput> {
    return this.post('/v1/personalize', input, opts)
  }

  orchestrate(input: OrchestrateInput, opts?: RequestOptions): Promise<OrchestrateOutput> {
    return this.post('/v1/orchestrate', input, opts)
  }

  run(input: RunInput, opts?: RequestOptions): Promise<RunOutput> {
    return this.post('/v1/run', input, opts)
  }

  migrate(input: MigrateInput, opts?: RequestOptions): Promise<MigrateOutput> {
    return this.post('/v1/migrate', input, opts)
  }

  /** Create (or update) a live-reaction channel. Returns the overlay URL for OBS. */
  createStreamChannel(input: StreamChannelInput): Promise<StreamChannelOutput> {
    return this.post('/v1/stream/channels', input)
  }

  /** Fire a stream event (tip/follow/sub) → reactions push to connected overlays. */
  sendStreamEvent(input: StreamEventInput): Promise<StreamEventOutput> {
    return this.post('/v1/stream/event', input)
  }

  /** Replace the reaction rules for a channel you own. */
  setStreamRules(input: { id: string; rules: unknown[] }): Promise<{ id: string; rules: unknown[]; updated: boolean }> {
    return this.post('/v1/stream/rules', input)
  }

  /** Stream /v1/run/stream — calls onEvent for each SSE event */
  async runStream(
    input:   RunInput,
    onEvent: (event: RunEvent) => void,
  ): Promise<void> {
    let res: Response
    try {
      res = await fetch(`${this.base}/v1/run/stream`, {
        method:  'POST',
        headers: { ...this.headers, Accept: 'text/event-stream' },
        body:    JSON.stringify(input),
      })
    } catch (cause) {
      throw new MeshToolNetworkError(
        `MeshTool POST /v1/run/stream failed before a response arrived (${(cause as Error)?.message ?? String(cause)}).`,
        { cause },
      )
    }
    if (!res.ok) throw await this.responseError('POST', '/v1/run/stream', res, res.headers.get('x-request-id') ?? undefined)
    const reader = res.body!.getReader()
    const dec    = new TextDecoder()
    let buf      = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (!raw || raw === '[DONE]') continue
        try { onEvent(JSON.parse(raw) as RunEvent) } catch { /* skip malformed */ }
      }
    }
  }

  /** Create and start a fusion job. */
  createFusionJob(input: FusionJobRequest): Promise<FusionJobCreateResponse> {
    return this.post('/v1/fusion/jobs', input)
  }

  /** Get fusion job status, outputs, and error details. */
  getFusionJob(jobId: string): Promise<FusionJobResponse> {
    return this.get(`/v1/fusion/jobs/${jobId}`)
  }

  /** Cancel a running fusion job. */
  cancelFusionJob(jobId: string): Promise<{ jobId: string; status: string }> {
    return this.post(`/v1/fusion/jobs/${jobId}/cancel`, {})
  }

  /** Get fusion asset details and latest listing. */
  getFusionAsset(fusionAssetId: string): Promise<Record<string, unknown>> {
    return this.get(`/v1/fusion/assets/${fusionAssetId}`)
  }

  /** Publish a listing for an existing fusion asset. */
  publishFusionAssetListing(
    fusionAssetId: string,
    input: {
      creatorId: string
      title: string
      description?: string
      licenseType?: 'personal' | 'commercial' | 'exclusive'
      pricingModel?: 'fixed' | 'license_tiered' | 'rev_share'
      basePriceUsd?: number
      revenueShareBps?: number
      metadata?: Record<string, unknown>
    },
  ): Promise<{ ok: boolean; listingId: string }> {
    return this.post(`/v1/fusion/assets/${fusionAssetId}/list`, input)
  }

  /** Stream fusion job events from /v1/fusion/jobs/:jobId/stream. */
  async streamFusionJob(jobId: string, onEvent: (event: FusionStreamEvent) => void): Promise<void> {
    let res: Response
    try {
      res = await fetch(`${this.base}/v1/fusion/jobs/${jobId}/stream`, {
        method: 'GET',
        headers: { ...this.headers, Accept: 'text/event-stream' },
      })
    } catch (cause) {
      throw new MeshToolNetworkError(
        `MeshTool GET /v1/fusion/jobs/${jobId}/stream failed before a response arrived (${(cause as Error)?.message ?? String(cause)}).`,
        { cause },
      )
    }
    if (!res.ok) throw await this.responseError('GET', `/v1/fusion/jobs/${jobId}/stream`, res, res.headers.get('x-request-id') ?? undefined)

    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })

      const frames = buf.split('\n\n')
      buf = frames.pop() ?? ''

      for (const frame of frames) {
        const lines = frame.split('\n')
        let eventName = 'message'
        let rawData = ''
        for (const line of lines) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          if (line.startsWith('data:')) rawData += line.slice(5).trim()
        }
        if (!rawData) continue
        try {
          onEvent({ event: eventName as FusionStreamEvent['event'], data: JSON.parse(rawData) } as FusionStreamEvent)
        } catch {
          // ignore malformed frames
        }
      }
    }
  }

  /** Extract structured data from freeform text */
  async extract<T = Record<string, unknown>>(input: ExtractInput, opts?: RequestOptions): Promise<T> {
    const out = await this.post<{ data: T }>('/v1/extract', input, opts)
    return out.data
  }

  // ── Skills marketplace ───────────────────────────────────────────────────────

  /** List all available skills with pricing */
  async listSkills(opts?: RequestOptions): Promise<unknown[]> {
    const out = await this.get<{ skills: unknown[] }>('/v1/skills', opts)
    return out.skills
  }

  /** Start checkout to buy or rent a skill. Returns a Stripe checkoutUrl. */
  acquireSkill(skillId: string, type: 'buy' | 'rent'): Promise<{ ok: boolean; checkoutUrl?: string; price: number; reason?: string }> {
    return this.post(`/v1/skills/${skillId}/acquire`, { type })
  }

  /** Invoke a skill you own (must have active entitlement) */
  invokeSkill(skillId: string, input: string): Promise<{ skillId: string; output: unknown; model: string; tokens: { input: number; output: number } }> {
    return this.post(`/v1/skills/${skillId}/invoke`, { input })
  }

  // ── Agents marketplace ───────────────────────────────────────────────────────

  /** List all rentable agents with pricing */
  async listAgents(opts?: RequestOptions): Promise<unknown[]> {
    const out = await this.get<{ agents: unknown[] }>('/v1/agents/marketplace', opts)
    return out.agents
  }

  /** Start checkout to rent an agent or pay per job. Returns a Stripe checkoutUrl. */
  acquireAgent(agentId: string, type: 'rent' | 'perjob'): Promise<{ ok: boolean; checkoutUrl?: string; price: number; reason?: string }> {
    return this.post(`/v1/agents/${agentId}/acquire`, { type })
  }

  /** Run a job through an agent (must have active entitlement) */
  runAgent(agentId: string, task: string, metadata?: Record<string, unknown>): Promise<{ jobId: string; status: string; agent: string; result: unknown; tokens: { input: number; output: number }; duration_ms: number }> {
    return this.post('/v1/agents/run', { agent: agentId, task, metadata })
  }

  /** Get the status/result of a previous agent job */
  getJob(jobId: string, opts?: RequestOptions): Promise<unknown> {
    return this.get(`/v1/agents/jobs/${jobId}`, opts)
  }

  /**
   * Spawn a marketplace agent and get the finished result in ONE call.
   * Runs the agent, and if the job is async, transparently polls it to completion.
   *   const { result } = await mt.spawn('researcher', 'Summarize the AI-memory market')
   */
  async spawn(
    agentId: string,
    task: string,
    opts: { metadata?: Record<string, unknown>; pollMs?: number; timeoutMs?: number } = {},
  ): Promise<{ jobId: string; agent: string; status: string; result: unknown; tokens?: { input: number; output: number }; duration_ms?: number }> {
    const terminal = (s?: string) => /done|complete|success|finished|failed|error|cancell?ed/i.test(s ?? '')
    const first = await this.runAgent(agentId, task, opts.metadata)
    if (first.result != null && terminal(first.status)) return first
    const pollMs = opts.pollMs ?? 1500
    const deadline = Date.now() + (opts.timeoutMs ?? 120_000)
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs))
      const job = (await this.getJob(first.jobId)) as {
        status?: string; result?: unknown; tokens?: { input: number; output: number }; duration_ms?: number
      }
      if (job && terminal(job.status)) {
        return { jobId: first.jobId, agent: agentId, status: job.status ?? 'done', result: job.result, tokens: job.tokens, duration_ms: job.duration_ms }
      }
    }
    throw new Error(`spawn: agent "${agentId}" timed out after ${opts.timeoutMs ?? 120_000}ms (jobId ${first.jobId})`)
  }

  // ── Brain missions ─────────────────────────────────────────────────────────

  generateBrainMissions(input: {
    creator_id: string
    count?: number
    fan_signal?: number
    marketplace_demand?: number
    trend_velocity?: number
    capability_readiness?: number
  }): Promise<BrainMissionGenerateResponse> {
    return this.post('/v1/brain/missions/generate', input)
  }

  listBrainMissions(input?: {
    creator_id?: string
    status?: 'generated' | 'claimed' | 'completed' | 'failed' | 'expired'
    limit?: number
  }): Promise<{ missions: BrainMission[]; count: number }> {
    const params = new URLSearchParams()
    if (input?.creator_id) params.set('creator_id', input.creator_id)
    if (input?.status) params.set('status', input.status)
    if (typeof input?.limit === 'number') params.set('limit', String(input.limit))
    const suffix = params.toString() ? `?${params.toString()}` : ''
    return this.get(`/v1/brain/missions${suffix}`)
  }

  getBrainMission(missionId: string): Promise<Record<string, unknown>> {
    return this.get(`/v1/brain/missions/${missionId}`)
  }

  claimBrainMission(input: {
    mission_id: string
    claimer_type: 'agent' | 'creator'
    claimer_id: string
    lock_minutes?: number
  }): Promise<{ claim: Record<string, unknown> }> {
    return this.post('/v1/brain/missions/claim', input)
  }

  completeBrainMission(input: {
    mission_id: string
    completed_by: string
    completion_payload?: Record<string, unknown>
    verification_status?: 'verified' | 'needs_review' | 'rejected'
  }): Promise<Record<string, unknown>> {
    return this.post('/v1/brain/missions/complete', input)
  }

  // ── DW OS Brain ──────────────────────────────────────────────────────────────

  /** Talk to the DW OS Brain — the agent that knows every service, can check live health, and takes action */
  os(input: OsInput): Promise<OsOutput> {
    return this.post('/v1/os', input)
  }
}

export interface OsInput {
  message: string
  context?: string
  history?: { role: 'user' | 'assistant'; content: string }[]
}

export interface OsOutput {
  reply: string
  intent: 'status' | 'deploy' | 'action' | 'question' | 'other'
  actions?: { label: string; url?: string; command?: string }[]
  tokens: { input: number; output: number }
  latency_ms: number
}

export default MeshTool
