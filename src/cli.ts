#!/usr/bin/env node
/**
 * meshtool CLI — call api.meshtool.ai from the terminal
 *
 * Reads MESHTOOL_API_KEY env var, or pass --key <sk_tz_...>
 *
 * Commands:
 *   meshtool analyze  --context "..." [--goal "..."]
 *   meshtool personalize --profile '{}' --content "opt1" "opt2" --goal "..."
 *   meshtool orchestrate --task "..." --tools "tool1" "tool2"
 *   meshtool run      --brief "..."
 *   meshtool run:stream --brief "..."
 *   meshtool migrate  --dir <obs-studio-dir> [--rec-path D:\OBS_recordings]
 *   meshtool tools
 */

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import { join, relative, dirname } from 'path'
import { homedir } from 'os'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'
import MeshTool from './index.js'
import { detectAgents, wireClaudeCode, wireCursor, wireWindsurf, doctor, type WireResult } from './init.js'

// ── Login store — so a dev NEVER pastes a key into an env var. `meshtool login`
// once, and every command reads the key from ~/.meshtool/config.json under the hood.
const API_BASE    = process.env.MESHTOOL_API_BASE ?? 'https://api.meshtool.ai'
const CONFIG_DIR  = join(homedir(), '.meshtool')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
function readConfig(): { apiKey?: string } {
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) } catch { return {} }
}
function writeConfig(cfg: { apiKey?: string }) {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
}
function prompt(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((res) => rl.question(q, (ans) => { rl.close(); res(ans) }))
}
/** Validate a key against the live API (401 ⇒ bad key). */
async function keyWorks(key: string): Promise<boolean> {
  try { return (await fetch(`${API_BASE}/v1/usage`, { headers: { Authorization: `Bearer ${key}` } })).ok } catch { return false }
}

// Pin --version to THIS package's version. Without this, yargs walks up from
// dist/ and can report an enclosing workspace's package.json version instead.
const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'),
) as { version: string }

function getKey(argv: { key?: string }): string {
  // Precedence: explicit --key flag > env var > the stored login (~/.meshtool).
  const k = argv.key ?? process.env.MESHTOOL_API_KEY ?? readConfig().apiKey
  if (!k) {
    console.error('Not logged in.  Run:  meshtool login   (or set MESHTOOL_API_KEY / pass --key)')
    process.exit(1)
  }
  return k
}

function pp(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2))
}

/** Recursively read all files from a directory, returning { relativePath: content } */
function readDir(dir: string, base = dir): Record<string, string> {
  const files: Record<string, string> = {}
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      Object.assign(files, readDir(full, base))
    } else if (entry.endsWith('.ini') || entry.endsWith('.json')) {
      const rel = relative(base, full).replace(/\\/g, '/')
      files[rel] = readFileSync(full, 'utf-8')
    }
  }
  return files
}

yargs(hideBin(process.argv))
  .option('key', {
    alias: 'k',
    type:  'string',
    desc:  'MeshTool API key (or set MESHTOOL_API_KEY env var)',
  })

  // ── login — store the key once so no env var / --key is ever needed again ─────
  .command(
    'login',
    'Log in once — stores your key in ~/.meshtool so you never paste it again',
    (y) => y.option('key', { type: 'string', desc: 'Your MeshTool key (omit to be prompted / get one at app.meshtool.ai)' }),
    async (argv) => {
      let key = (argv.key as string | undefined)?.trim()
      if (!key) {
        process.stderr.write('Get your key at https://app.meshtool.ai (Dashboard → API key).\n')
        key = (await prompt('Paste your MeshTool key (sk_tz_…): ')).trim()
      }
      if (!key.startsWith('sk_tz_')) { console.error('That doesn’t look like a MeshTool key (expected sk_tz_…). Nothing saved.'); process.exit(1) }
      process.stderr.write('Verifying…\n')
      if (!(await keyWorks(key))) { console.error('✗ That key was rejected by the API. Nothing saved.'); process.exit(1) }
      writeConfig({ ...readConfig(), apiKey: key })
      console.log(`\n✓ Logged in — key stored in ${CONFIG_FILE}.\n  Every meshtool command now just works. No env var needed.`)
    },
  )

  // ── logout — forget the stored key ────────────────────────────────────────────
  .command('logout', 'Remove the stored login', {}, () => {
    if (existsSync(CONFIG_FILE)) { rmSync(CONFIG_FILE); console.log('✓ Logged out (removed the stored key).') }
    else console.log('Not logged in — nothing to remove.')
  })

  // ── whoami — show the active identity + where the key came from ───────────────
  .command('whoami', 'Show which key is active and whether it’s valid', {}, async (argv) => {
    const key = (argv.key as string | undefined) ?? process.env.MESHTOOL_API_KEY ?? readConfig().apiKey
    if (!key) { console.log('Not logged in.  Run:  meshtool login'); return }
    const src = argv.key ? '--key flag' : process.env.MESHTOOL_API_KEY ? 'MESHTOOL_API_KEY env' : `${CONFIG_FILE}`
    process.stderr.write('Checking…\n')
    const ok = await keyWorks(key)
    console.log(`Key:   ${String(key).slice(0, 12)}…  (from ${src})\nState: ${ok ? 'valid ✓' : 'INVALID / rejected ✗'}`)
  })

  // ── init — THE one-command hookup: sign in → detect agents → wire MCP + skill ──
  .command(
    'init',
    'Hook this machine up to MeshTool — sign in + wire the MCP server & /meshtool skill into every detected coding agent',
    (y) => y.option('key', { type: 'string', desc: 'Your MeshTool key (omit to use the stored login / be prompted)' }),
    async (argv) => {
      const cwd = process.cwd()
      // 1 — sign in (reuse the stored key; else prompt + verify like `login`)
      let key = (argv.key as string | undefined)?.trim() ?? process.env.MESHTOOL_API_KEY ?? readConfig().apiKey
      if (!key) {
        process.stderr.write('Get your key at https://app.meshtool.ai (Dashboard → API key).\n')
        key = (await prompt('Paste your MeshTool key (sk_tz_…): ')).trim()
      }
      if (!key.startsWith('sk_tz_')) { console.error('✗ Not a MeshTool key (expected sk_tz_…). Nothing wired.'); process.exit(1) }
      process.stderr.write('Verifying key…\n')
      if (!(await keyWorks(key))) { console.error('✗ Key rejected by the API. Nothing wired.'); process.exit(1) }
      writeConfig({ ...readConfig(), apiKey: key })

      // 2 — detect agents
      const agents = detectAgents(cwd)
      if (!agents.length) {
        console.log('✓ Signed in (key stored).')
        console.log('⚠ No coding agent detected here. Install Claude Code or Cursor, then re-run `meshtool init`.')
        return
      }
      console.log(`\n✓ Signed in. Detected: ${agents.map((a) => a.label).join(', ')}\n`)

      // 3 — wire each
      const results: WireResult[] = []
      for (const a of agents) {
        if (a.id === 'claude-code') results.push(...wireClaudeCode(key, cwd))
        else if (a.id === 'cursor') results.push(...wireCursor(key, cwd))
        else if (a.id === 'windsurf') results.push(...wireWindsurf(key))
      }
      for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.agent}: ${r.action}${r.detail ? '  — ' + r.detail : ''}`)

      console.log(`\n🎉 Hooked up. Restart your coding agent once, then just type  /meshtool  (or run  meshtool doctor  to verify).`)
    },
  )

  // ── doctor — diagnose credentials, endpoints, and agent wiring ────────────────
  .command('doctor', 'Check credentials, endpoints, and agent wiring', {}, async (argv) => {
    const key = (argv.key as string | undefined) ?? process.env.MESHTOOL_API_KEY ?? readConfig().apiKey
    const checks = await doctor(key, process.cwd())
    console.log('')
    for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(20)} ${c.detail}`)
    const fails = checks.filter((c) => !c.ok).length
    console.log(fails === 0 ? '\n✓ All good — MeshTool is wired and reachable.' : `\n✗ ${fails} issue(s). Fix: meshtool login / meshtool init.`)
    if (fails > 0) process.exit(1)
  })

  // ── spawn — run a marketplace agent in one shot ──────────────────────────────
  .command(
    'spawn <agent> [task]',
    'Spawn a marketplace agent and wait for the finished result (one shot)',
    (y) => y
      .positional('agent', { type: 'string', describe: 'Agent id (researcher / strategist / copywriter / analyst)' })
      .positional('task',  { type: 'string', describe: 'The task / brief for the agent' })
      .option('metadata',  { type: 'string', alias: 'm', desc: 'JSON metadata passed to the agent' })
      .option('json',      { type: 'boolean', desc: 'Print the raw JSON job result' }),
    async (argv) => {
      const task = (argv.task as string | undefined) ?? ''
      if (!task) { console.error('Error: a task is required — meshtool spawn <agent> "<task>"'); process.exit(1) }
      const mt   = new MeshTool(getKey(argv))
      const meta = argv.metadata ? JSON.parse(argv.metadata as string) : undefined
      process.stderr.write(`⏳ spawning ${argv.agent}…\n`)
      try {
        const out = await mt.spawn(argv.agent as string, task, { metadata: meta })
        if (argv.json) { pp(out); return }
        console.log(typeof out.result === 'string' ? out.result : JSON.stringify(out.result, null, 2))
        if (out.tokens) process.stderr.write(`\n(${out.status} · ${out.tokens.input}+${out.tokens.output} tok · ${out.duration_ms ?? '?'}ms)\n`)
      } catch (e) {
        const err = e as { statusCode?: number; details?: { pricing?: { rent?: number; perJob?: number } }; message?: string }
        if (err.statusCode === 402) {
          const p = err.details?.pricing
          console.error(`\n🔒 You don't have "${argv.agent}" yet.`)
          if (p) console.error(`   Rent $${p.rent}/mo or pay $${p.perJob}/job.`)
          console.error(`   Acquire it: meshtool acquire ${argv.agent}   (or at app.meshtool.ai)`)
          process.exit(1)
        }
        console.error('Error:', err.message ?? String(e))
        process.exit(1)
      }
    },
  )

  // ── acquire — rent / buy a marketplace agent ─────────────────────────────────
  .command(
    'acquire <agent>',
    'Acquire a marketplace agent (rent monthly or pay-per-job)',
    (y) => y
      .positional('agent', { type: 'string', describe: 'Agent id to acquire' })
      .option('type', { choices: ['rent', 'perjob'] as const, default: 'rent', desc: 'rent = monthly · perjob = pay per job' }),
    async (argv) => {
      const mt  = new MeshTool(getKey(argv))
      const out = await mt.acquireAgent(argv.agent as string, argv.type as 'rent' | 'perjob')
      if (out.checkoutUrl) console.log(`\nComplete your ${argv.type} of "${argv.agent}" ($${out.price}):\n  ${out.checkoutUrl}`)
      else if (out.ok) console.log(`\n✓ "${argv.agent}" acquired — run it: meshtool spawn ${argv.agent} "<task>"`)
      else console.log(out.reason ?? JSON.stringify(out))
    },
  )

  // ── analyze ─────────────────────────────────────────────────────────────────
  .command(
    'analyze',
    'Analyze a situation and get a recommendation',
    (y) => y
      .option('context',     { type: 'string', demandOption: true, alias: 'c', desc: 'Situation to analyze' })
      .option('goal',        { type: 'string', alias: 'g', desc: 'Desired outcome' })
      .option('constraints', { type: 'array',  alias: 'n', desc: 'Constraints (repeatable)' }),
    async (argv) => {
      const mt  = new MeshTool(getKey(argv))
      const out = await mt.analyze({
        context:     argv.context,
        goal:        argv.goal,
        constraints: argv.constraints as string[] | undefined,
      })
      console.log('\nRecommendation:', out.recommendation)
      console.log('Confidence:    ', `${Math.round(out.confidence * 100)}%`)
      console.log('\nReasoning:', out.reasoning)
      console.log('\nActions:')
      out.actions.forEach((a, i) => console.log(`  ${i + 1}. ${a}`))
      console.log(`\n(${out.latency_ms}ms)`)
    },
  )

  // ── personalize ─────────────────────────────────────────────────────────────
  .command(
    'personalize',
    'Personalize content for a user profile',
    (y) => y
      .option('profile', { type: 'string', demandOption: true, alias: 'p', desc: 'JSON user profile' })
      .option('content', { type: 'array',  demandOption: true, alias: 'c', desc: 'Content options' })
      .option('goal',    { type: 'string', demandOption: true, alias: 'g', desc: 'Goal' }),
    async (argv) => {
      const mt      = new MeshTool(getKey(argv))
      const profile = JSON.parse(argv.profile)
      const out     = await mt.personalize({ profile, content: argv.content as string[], goal: argv.goal })
      console.log('\nHeadline:', out.headline)
      console.log('Hook:    ', out.hook)
      console.log('Selected:', out.selected)
      console.log('Avoid:   ', out.avoid)
      console.log(`\n(${out.latency_ms}ms)`)
    },
  )

  // ── orchestrate ─────────────────────────────────────────────────────────────
  .command(
    'orchestrate',
    'Break a task into an execution plan',
    (y) => y
      .option('task',    { type: 'string', demandOption: true, alias: 't', desc: 'Task description' })
      .option('tools',   { type: 'array',  demandOption: true, alias: 'l', desc: 'Available tools' })
      .option('context', { type: 'string', alias: 'x', desc: 'JSON context object' }),
    async (argv) => {
      const mt  = new MeshTool(getKey(argv))
      const ctx = argv.context ? JSON.parse(argv.context) : undefined
      const out = await mt.orchestrate({ task: argv.task, tools: argv.tools as string[], context: ctx })
      console.log('\nSummary:', out.summary)
      console.log(`Plan (${out.plan.length} steps):`)
      out.plan.forEach((s) => console.log(`  ${s.step}. [${s.tool}] ${s.action}`))
      console.log(`\n(${out.latency_ms}ms)`)
    },
  )

  // ── run ─────────────────────────────────────────────────────────────────────
  .command(
    'run',
    'Give it a brief, get back a finished deliverable',
    (y) => y
      .option('brief',   { type: 'string', demandOption: true, alias: 'b', desc: 'Job brief' })
      .option('context', { type: 'string', alias: 'x', desc: 'JSON context' }),
    async (argv) => {
      const mt  = new MeshTool(getKey(argv))
      const ctx = argv.context ? JSON.parse(argv.context) : undefined
      console.log('Running job...')
      const out = await mt.run({ brief: argv.brief, context: ctx })
      console.log(`\n[${out.job_type}] ${out.steps_completed} steps\n`)
      console.log(out.deliverable)
      console.log(`\n(${out.latency_ms}ms)`)
    },
  )

  // ── run:stream ──────────────────────────────────────────────────────────────
  .command(
    'run:stream',
    'Stream a job run — see each step as it completes',
    (y) => y
      .option('brief',   { type: 'string', demandOption: true, alias: 'b', desc: 'Job brief' })
      .option('context', { type: 'string', alias: 'x', desc: 'JSON context' }),
    async (argv) => {
      const mt  = new MeshTool(getKey(argv))
      const ctx = argv.context ? JSON.parse(argv.context) : undefined
      console.log('Streaming job...\n')
      await mt.runStream({ brief: argv.brief, context: ctx }, (event) => {
        const e = event as Record<string, unknown>
        if (e.type === 'start')    console.log(`  [start] job_type: ${e.job_type}`)
        if (e.type === 'plan')     console.log(`  [plan] ${e.steps} steps: ${e.summary}`)
        if (e.type === 'step')     console.log(`  [step ${e.step}/${e.total}] ${e.action}`)
        if (e.type === 'complete') console.log(`\n${e.deliverable}`)
        if (e.type === 'error')    console.error(`  [error] ${e.message}`)
      })
    },
  )

  // ── migrate ─────────────────────────────────────────────────────────────────
  .command(
    'migrate',
    'Convert a Mac OBS config directory to Windows-compatible files',
    (y) => y
      .option('dir',        { type: 'string', demandOption: true, alias: 'd', desc: 'Path to obs-studio/ from Mac' })
      .option('rec-path',   { type: 'string', default: 'D:\\OBS_recordings', desc: 'Windows recording output path' })
      .option('media-path', { type: 'string', default: 'D:\\OBS_assets',     desc: 'Windows media assets folder' })
      .option('out',        { type: 'string', alias: 'o', desc: 'Output directory (default: stdout summary)' }),
    async (argv) => {
      const mt    = new MeshTool(getKey(argv))
      console.log(`Reading files from: ${argv.dir}`)
      const files = readDir(argv.dir)
      console.log(`Found ${Object.keys(files).length} file(s). Sending to API...`)

      const out = await mt.migrate({
        files,
        rec_path:   argv['rec-path'],
        media_path: argv['media-path'],
      })

      console.log(`\nChanges (${out.changes.length}):`)
      out.changes.forEach((c) => console.log('  ' + c))

      if (argv.out) {
        const { mkdirSync, writeFileSync } = await import('fs')
        const { dirname } = await import('path')
        for (const [filename, content] of Object.entries(out.files)) {
          const dest = join(argv.out, filename)
          mkdirSync(dirname(dest), { recursive: true })
          writeFileSync(dest, content, 'utf-8')
        }
        console.log(`\nFixed files written to: ${argv.out}`)
      }

      console.log('\nManual steps:')
      out.manual_steps.forEach((s) => console.log('  -', s.split('\n')[0]))
      console.log(`\n(${out.latency_ms}ms)`)
    },
  )

  // ── stream:channel ────────────────────────────────────────────────────────
  .command(
    'stream:channel',
    'Create/update a live-reaction channel and print its OBS overlay URL',
    (y) => y
      .option('id',    { type: 'string', demandOption: true, alias: 'i', desc: 'Channel slug, e.g. my-channel' })
      .option('rules', { type: 'string', alias: 'r', desc: 'JSON array of rules (optional; defaults applied)' }),
    async (argv) => {
      const mt    = new MeshTool(getKey(argv))
      const rules = argv.rules ? JSON.parse(argv.rules) : undefined
      const out   = await mt.createStreamChannel({ id: argv.id, rules })
      console.log('\nChannel:', out.id)
      console.log('\nAdd this as a Browser Source in OBS:')
      console.log('  ' + out.overlay_url)
      console.log('\nPOST events to:', out.event_endpoint)
    },
  )

  // ── stream:event ──────────────────────────────────────────────────────────
  .command(
    'stream:event',
    'Fire a stream event (tip/follow/sub) at a channel',
    (y) => y
      .option('channel', { type: 'string', demandOption: true, alias: 'c', desc: 'Channel slug' })
      .option('type',    { type: 'string', demandOption: true, alias: 't', desc: 'tip | follow | sub | raid' })
      .option('amount',  { type: 'number', alias: 'a', desc: 'Dollars (for tips/subs)' })
      .option('from',    { type: 'string', alias: 'f', desc: 'Who triggered it' })
      .option('message', { type: 'string', alias: 'm', desc: 'Optional note' }),
    async (argv) => {
      const mt  = new MeshTool(getKey(argv))
      const out = await mt.sendStreamEvent({
        channel: argv.channel, type: argv.type,
        amount: argv.amount, from: argv.from, message: argv.message,
      })
      console.log(`matched ${out.matched} rule(s) · ${out.overlays_connected} overlay(s) connected · delivered ${out.delivered}`)
      if (out.reactions[0]) console.log('reaction:', (out.reactions[0] as any).text)
    },
  )

  // ── os ──────────────────────────────────────────────────────────────────────
  .command(
    'os',
    'Talk to the DW OS Brain — check system health, list services, get status',
    (y) => y
      .option('message', { type: 'string', demandOption: true, alias: 'm', desc: 'What to ask the OS Brain' })
      .option('context', { type: 'string', alias: 'x', desc: 'Optional context (e.g. caller name)' }),
    async (argv) => {
      const mt  = new MeshTool(getKey(argv))
      console.log('Asking OS Brain...\n')
      const out = await mt.os({ message: argv.message, context: argv.context })
      console.log(out.reply)
      if (out.actions?.length) {
        console.log('\nActions:')
        out.actions.forEach(a => console.log(`  • ${a.label}${a.url ? ' → ' + a.url : ''}${a.command ? ' $ ' + a.command : ''}`))
      }
      console.log(`\n[intent: ${out.intent}] (${out.latency_ms}ms)`)
    },
  )

  // ── tools ───────────────────────────────────────────────────────────────────
  .command(
    'tools',
    'List available MeshTool API endpoints',
    () => {},
    async () => {
      const res  = await fetch('https://api.meshtool.ai/v1/tools')
      const data = await res.json() as { tools: Array<{ name: string; description: string; pricing: string }> }
      data.tools.forEach((t) => {
        console.log(`\n  ${t.name}  (${t.pricing})`)
        console.log(`  ${t.description}`)
      })
    },
  )

  .demandCommand(1, 'Specify a command. Start with:  meshtool init   (one-command hookup) · then login, spawn, acquire, run, os, doctor, tools')
  .version(pkg.version)
  .help()
  .argv
