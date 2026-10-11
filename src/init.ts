/**
 * meshtool init — the one-command hookup.
 *
 * Sign in → mint/store the key → detect every coding agent on this machine →
 * wire the MeshTool MCP server + the /meshtool skill into each → verify.
 *
 * The Ritual-style "one command and your agent can run everything", but it's
 * YOUR platform (api.meshtool.ai), not a third party's.
 *
 * Dependency-light on purpose: node builtins only (fs / path / os / child_process).
 */
import { execSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export const MCP_URL = process.env.MESHTOOL_MCP_URL ?? 'https://api.meshtool.ai/mcp'
export const API_BASE = process.env.MESHTOOL_API_BASE ?? 'https://api.meshtool.ai'

export interface WireResult { agent: string; action: string; ok: boolean; detail?: string }

// ── safe command runner (works with .cmd shims on Windows, never throws) ────────
function run(cmd: string): string | null {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' }) }
  catch { return null }
}
function has(cmd: string): boolean { return run(`${cmd} --version`) !== null }
function isTracked(cwd: string, file: string): boolean {
  return run(`git -C "${cwd}" ls-files --error-unmatch "${file}"`) !== null
}

// ── agent detection ──────────────────────────────────────────────────────────
export interface DetectedAgent { id: 'claude-code' | 'cursor' | 'windsurf'; label: string; how: string }

export function detectAgents(cwd: string): DetectedAgent[] {
  const found: DetectedAgent[] = []
  if (has('claude') || existsSync(join(cwd, '.claude')) || existsSync(join(cwd, '.mcp.json')) || existsSync(join(homedir(), '.claude.json'))) {
    found.push({ id: 'claude-code', label: 'Claude Code', how: has('claude') ? 'claude CLI' : 'config files' })
  }
  if (existsSync(join(cwd, '.cursor')) || existsSync(join(homedir(), '.cursor')) || has('cursor')) {
    found.push({ id: 'cursor', label: 'Cursor', how: '.cursor/mcp.json' })
  }
  if (existsSync(join(homedir(), '.codeium', 'windsurf'))) {
    found.push({ id: 'windsurf', label: 'Windsurf', how: '~/.codeium/windsurf/mcp_config.json' })
  }
  return found
}

// ── MCP-config writer: key-safe by construction ────────────────────────────────
// If the target file is git-tracked, the key must NOT be inlined (it would get
// committed) — reference ${MESHTOOL_API_KEY} instead. Otherwise inline the key and
// gitignore the file (standard 0600 local-credential posture, like the vault).
function writeMcp(cwd: string, relFile: string, key: string, style: 'http-typed' | 'url-only'): { keyInFile: boolean } {
  const file = join(cwd, relFile)
  const tracked = isTracked(cwd, relFile)
  const auth = tracked ? 'Bearer ${MESHTOOL_API_KEY}' : `Bearer ${key}`
  let cfg: any = {}
  if (existsSync(file)) { try { cfg = JSON.parse(readFileSync(file, 'utf-8')) } catch { cfg = {} } }
  cfg.mcpServers = cfg.mcpServers ?? {}
  cfg.mcpServers.meshtool = style === 'http-typed'
    ? { type: 'http', url: MCP_URL, headers: { Authorization: auth } }
    : { url: MCP_URL, headers: { Authorization: auth } }
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
  if (!tracked) ensureGitignore(cwd, relFile)
  return { keyInFile: !tracked }
}

// ── per-agent wiring ───────────────────────────────────────────────────────────
export function wireClaudeCode(key: string, cwd: string): WireResult[] {
  const out: WireResult[] = []
  const { keyInFile } = writeMcp(cwd, '.mcp.json', key, 'http-typed')
  out.push({
    agent: 'Claude Code',
    action: 'MCP server (.mcp.json)',
    ok: true,
    detail: keyInFile ? 'key inlined + gitignored (0600)' : 'env-ref ${MESHTOOL_API_KEY} — set it in your env',
  })
  const skillDir = join(cwd, '.claude', 'skills', 'meshtool')
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), MESHTOOL_SKILL, 'utf-8')
  out.push({ agent: 'Claude Code', action: '/meshtool skill', ok: true, detail: '.claude/skills/meshtool/SKILL.md' })
  return out
}

export function wireCursor(key: string, cwd: string): WireResult[] {
  const { keyInFile } = writeMcp(cwd, join('.cursor', 'mcp.json'), key, 'url-only')
  const rulesDir = join(cwd, '.cursor', 'rules')
  mkdirSync(rulesDir, { recursive: true })
  writeFileSync(join(rulesDir, 'meshtool.mdc'), `---\ndescription: MeshTool agent platform\nalwaysApply: false\n---\n${MESHTOOL_SKILL}`, 'utf-8')
  return [
    { agent: 'Cursor', action: 'MCP server (.cursor/mcp.json)', ok: true, detail: keyInFile ? 'key inlined + gitignored (0600)' : 'env-ref ${MESHTOOL_API_KEY}' },
    { agent: 'Cursor', action: 'rule (.cursor/rules/meshtool.mdc)', ok: true },
  ]
}

export function wireWindsurf(key: string): WireResult[] {
  const dir = join(homedir(), '.codeium', 'windsurf')
  const file = join(dir, 'mcp_config.json')
  let cfg: any = {}
  if (existsSync(file)) { try { cfg = JSON.parse(readFileSync(file, 'utf-8')) } catch { cfg = {} } }
  cfg.mcpServers = cfg.mcpServers ?? {}
  cfg.mcpServers.meshtool = { url: MCP_URL, headers: { Authorization: `Bearer ${key}` } }
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
  return [{ agent: 'Windsurf', action: 'MCP server (~/.codeium/windsurf, 0600)', ok: true, detail: 'meshtool → ' + MCP_URL }]
}

function ensureGitignore(cwd: string, entry: string): void {
  const gi = join(cwd, '.gitignore')
  const norm = entry.replace(/\\/g, '/')
  try {
    const cur = existsSync(gi) ? readFileSync(gi, 'utf-8') : ''
    if (!cur.split(/\r?\n/).some((l) => l.trim() === norm)) {
      writeFileSync(gi, cur + (cur === '' || cur.endsWith('\n') ? '' : '\n') + norm + '\n')
    }
  } catch { /* best effort */ }
}

// ── doctor ─────────────────────────────────────────────────────────────────────
export interface DoctorCheck { name: string; ok: boolean; detail: string }

export async function doctor(key: string | undefined, cwd: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []
  if (!key) {
    checks.push({ name: 'credentials', ok: false, detail: 'not logged in — run: meshtool login' })
  } else {
    let ok = false
    try { ok = (await fetch(`${API_BASE}/v1/usage`, { headers: { Authorization: `Bearer ${key}` } })).ok } catch { /* */ }
    checks.push({ name: 'credentials', ok, detail: ok ? `key ${key.slice(0, 12)}… valid` : 'key rejected by API' })
  }
  let apiOk = false
  try { apiOk = (await fetch(`${API_BASE}/health`)).ok } catch { /* */ }
  checks.push({ name: 'API endpoint', ok: apiOk, detail: apiOk ? `${API_BASE} up` : `${API_BASE} unreachable` })
  let mcpReach = false
  try { const r = await fetch(MCP_URL, { method: 'GET' }); mcpReach = r.status > 0 } catch { /* */ }
  checks.push({ name: 'MCP endpoint', ok: mcpReach, detail: mcpReach ? `${MCP_URL} reachable` : `${MCP_URL} unreachable` })
  const agents = detectAgents(cwd)
  checks.push({ name: 'agents detected', ok: agents.length > 0, detail: agents.length ? agents.map((a) => a.label).join(', ') : 'none — install Claude Code or Cursor' })
  const wired = (existsSync(join(cwd, '.mcp.json')) && /meshtool/.test(readFileSync(join(cwd, '.mcp.json'), 'utf-8')))
    || (existsSync(join(cwd, '.cursor', 'mcp.json')) && /meshtool/.test(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf-8')))
    || /meshtool/i.test(run('claude mcp list') ?? '')
  checks.push({ name: 'MeshTool MCP wired', ok: wired, detail: wired ? 'meshtool server present' : 'not wired — run: meshtool init' })
  const skill = existsSync(join(cwd, '.claude', 'skills', 'meshtool', 'SKILL.md'))
  checks.push({ name: '/meshtool skill', ok: skill, detail: skill ? 'installed' : 'missing — run: meshtool init' })
  return checks
}

// ── the /meshtool skill content ─────────────────────────────────────────────────
export const MESHTOOL_SKILL = `---
name: meshtool
description: Use MeshTool — the agent-to-agent platform (api.meshtool.ai) — to hire specialist agents, run jobs, control devices, and talk to the OS Brain. Trigger on "meshtool", "spawn an agent", "hire a researcher/strategist/copywriter/analyst", "run a job", "studio director", "obsbot camera", "ask the OS brain".
---

# MeshTool

You are hooked up to **MeshTool** — a hosted platform where agents call agents. It is
reachable two ways, both already wired on this machine:

- **MCP tools** (server \`meshtool\`, from ${MCP_URL}) — call them directly.
- **The \`meshtool\` CLI** — shell out when you want the terminal path.

## What you can do

**Hire a specialist agent** (does a whole job, returns a result):
\`\`\`
meshtool spawn researcher   "Research the top 3 competitors to X and how they price"
meshtool spawn strategist   "Given <situation>, what's the single highest-leverage move?"
meshtool spawn copywriter   "3 launch-post variations for <product>"
meshtool spawn analyst      "Read this feedback: give me the signal, the risk, the action"
meshtool spawn studio-director '{"event":"whale_detected","whale":{"tier":"leviathan"}}'
\`\`\`
A 402 means the agent isn't acquired yet: \`meshtool acquire <agent>\`.

**Run a one-shot job** (plan + execute + deliverable): \`meshtool run --brief "..."\`
**Ask the OS Brain** (system health, services, status): \`meshtool os --message "..."\`
**Drive the OBSBOT Tiny 3 camera** (if you own the obsbot-tiny3 skill): invoke it with
\`{ "action": "zoom_set", "params": { "level": 70 } }\` — a local drain agent actuates it.

## Rules
- The key is stored (\`meshtool login\` / \`meshtool init\`); never paste it into code or a
  committed file. Config files that hold it are gitignored + 0600.
- Prefer the MCP tools when composing; use the CLI for quick one-shots.
- \`meshtool doctor\` diagnoses credentials / endpoints / wiring if anything is off.
`
