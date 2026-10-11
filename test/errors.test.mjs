import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  MeshToolError,
  MeshToolAuthError,
  MeshToolRateLimitError,
  MeshToolNetworkError,
  MeshToolTimeoutError,
} from '../dist/errors.js'

describe('error class contract', () => {
  test('every class extends MeshToolError and Error, with a stable name', () => {
    const cases = [
      [new MeshToolError('m'), 'MeshToolError'],
      [new MeshToolAuthError('m'), 'MeshToolAuthError'],
      [new MeshToolRateLimitError('m', 3), 'MeshToolRateLimitError'],
      [new MeshToolNetworkError('m'), 'MeshToolNetworkError'],
      [new MeshToolTimeoutError('m', 100), 'MeshToolTimeoutError'],
    ]
    for (const [err, name] of cases) {
      assert.ok(err instanceof Error, `${name} instanceof Error`)
      assert.ok(err instanceof MeshToolError, `${name} instanceof MeshToolError`)
      assert.equal(err.name, name)
      assert.equal(err.message, 'm')
    }
  })

  test('base init fields: statusCode, requestId, details, cause', () => {
    const cause = new Error('root')
    const err = new MeshToolError('m', { statusCode: 502, requestId: 'req_9', details: { a: 1 }, cause })
    assert.equal(err.statusCode, 502)
    assert.equal(err.requestId, 'req_9')
    assert.deepEqual(err.details, { a: 1 })
    assert.equal(err.cause, cause)
  })

  test('fields default to undefined when not provided', () => {
    const err = new MeshToolAuthError('m')
    assert.equal(err.statusCode, undefined)
    assert.equal(err.requestId, undefined)
    assert.equal(err.details, undefined)
    assert.equal(err.cause, undefined)
  })

  test('rate-limit carries retryAfter; timeout carries timeoutMs and is a network error', () => {
    const rl = new MeshToolRateLimitError('m', 12, { statusCode: 429 })
    assert.equal(rl.retryAfter, 12)
    assert.equal(rl.statusCode, 429)

    const to = new MeshToolTimeoutError('m', 5000)
    assert.equal(to.timeoutMs, 5000)
    assert.ok(to instanceof MeshToolNetworkError)
  })
})
