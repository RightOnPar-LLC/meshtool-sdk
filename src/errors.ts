/**
 * Typed errors for @meshtool/sdk.
 *
 * Every error the SDK throws is a MeshToolError subclass, so callers can
 * `instanceof`-match instead of string-matching messages:
 *
 *   try { await mt.analyze({ context }) }
 *   catch (err) {
 *     if (err instanceof MeshToolAuthError)      // bad/expired key
 *     if (err instanceof MeshToolRateLimitError) // back off err.retryAfter seconds
 *     if (err instanceof MeshToolTimeoutError)   // raise timeoutMs or check network
 *     if (err instanceof MeshToolNetworkError)   // fetch-level failure
 *   }
 */

export interface MeshToolErrorInit {
  statusCode?: number
  requestId?: string
  /** Parsed error body from the API, when one was returned. */
  details?: unknown
  cause?: unknown
}

/** Base class for every error thrown by the SDK. */
export class MeshToolError extends Error {
  readonly statusCode?: number
  /** `x-request-id` from the API response — quote this when reporting an issue. */
  readonly requestId?: string
  readonly details?: unknown

  constructor(message: string, init: MeshToolErrorInit = {}) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined)
    this.name = 'MeshToolError'
    this.statusCode = init.statusCode
    this.requestId = init.requestId
    this.details = init.details
  }
}

/** 401/403 — the API key was missing, malformed, revoked, or lacks scope. Never retried. */
export class MeshToolAuthError extends MeshToolError {
  constructor(message: string, init: MeshToolErrorInit = {}) {
    super(message, init)
    this.name = 'MeshToolAuthError'
  }
}

/** 429 — you are being rate-limited. `retryAfter` is seconds to wait (0 if the API did not say). */
export class MeshToolRateLimitError extends MeshToolError {
  readonly retryAfter: number

  constructor(message: string, retryAfter: number, init: MeshToolErrorInit = {}) {
    super(message, init)
    this.name = 'MeshToolRateLimitError'
    this.retryAfter = retryAfter
  }
}

/** The request never got an HTTP response — DNS, refused connection, reset, etc. */
export class MeshToolNetworkError extends MeshToolError {
  constructor(message: string, init: MeshToolErrorInit = {}) {
    super(message, init)
    this.name = 'MeshToolNetworkError'
  }
}

/** The request exceeded `timeoutMs`. Subclass of MeshToolNetworkError so one catch handles both. */
export class MeshToolTimeoutError extends MeshToolNetworkError {
  readonly timeoutMs: number

  constructor(message: string, timeoutMs: number, init: MeshToolErrorInit = {}) {
    super(message, init)
    this.name = 'MeshToolTimeoutError'
    this.timeoutMs = timeoutMs
  }
}
