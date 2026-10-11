import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(pkgRoot, 'dist', 'cli.js')

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: pkgRoot,
    encoding: 'utf-8',
    env: { ...process.env, MESHTOOL_API_KEY: '', ...env },
    timeout: 30_000,
  })
}

describe('meshtool CLI', () => {
  test('--help exits 0 and lists the commands', () => {
    const out = runCli(['--help'])
    assert.equal(out.status, 0, out.stderr)
    for (const cmd of ['analyze', 'personalize', 'orchestrate', 'run', 'migrate', 'os', 'tools']) {
      assert.match(out.stdout, new RegExp(cmd), `--help should list "${cmd}"`)
    }
  })

  test('--version exits 0 and prints the package version', () => {
    const out = runCli(['--version'])
    assert.equal(out.status, 0, out.stderr)
    const { version } = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8'))
    assert.match(out.stdout.trim(), /^\d+\.\d+\.\d+/)
    assert.equal(out.stdout.trim(), version)
  })

  test('a command without an API key exits 1 with a pointer to MESHTOOL_API_KEY', () => {
    const out = runCli(['analyze', '--context', 'hello'])
    assert.equal(out.status, 1)
    assert.match(out.stderr, /MESHTOOL_API_KEY/)
  })
})
