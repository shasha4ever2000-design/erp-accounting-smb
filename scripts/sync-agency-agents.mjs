#!/usr/bin/env node
/**
 * Vendor the "Agency" agent roster into .claude/agents/ so every Claude Code
 * session on this repo (CLI, desktop or web) picks the agents up automatically.
 *
 * Upstream ships one Markdown file per agent, grouped into division folders,
 * with a human-readable `name:` ("Frontend Developer"). Claude Code wants a
 * kebab-case identifier, so this script rewrites the front matter:
 *
 *   name        -> slug taken from the file name
 *   description -> "<Display Name> - <upstream description>" (keeps the
 *                  human name matchable when you ask for an agent by title)
 *   color       -> narrowed to a colour Claude Code understands
 *   tools       -> passed through untouched when present
 *
 * The body of each agent file is copied verbatim.
 *
 * Usage:
 *   node scripts/sync-agency-agents.mjs                 # clone upstream, refresh
 *   node scripts/sync-agency-agents.mjs --source <dir>  # use a local checkout
 *   node scripts/sync-agency-agents.mjs --ref <git-ref> # pin a branch/tag/sha
 *   node scripts/sync-agency-agents.mjs --check         # fail if anything drifts
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM = 'https://github.com/itallstartedwithaidea/agency-agents.git'
const DEST = path.join(REPO_ROOT, '.claude', 'agents')
const DOC = path.join(REPO_ROOT, 'docs', 'agency-agents.md')

/** Division folders that hold agent definitions (everything else is prose). */
const DIVISIONS = [
  'design',
  'engineering',
  'marketing',
  'product',
  'project-management',
  'testing',
  'support',
  'spatial-computing',
  'specialized',
]

/** Colours Claude Code accepts in agent front matter. */
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']

const COLOR_ALIASES = {
  teal: 'cyan',
  indigo: 'purple',
  violet: 'purple',
  magenta: 'pink',
  gold: 'yellow',
  amber: 'yellow',
  'neon-green': 'green',
  'neon-cyan': 'cyan',
  'metallic-blue': 'blue',
  black: 'blue',
  white: 'blue',
  gray: 'blue',
  grey: 'blue',
}

function parseArgs(argv) {
  const opts = { source: null, ref: null, check: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--source') opts.source = argv[++i]
    else if (arg === '--ref') opts.ref = argv[++i]
    else if (arg === '--check') opts.check = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return opts
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}

function cloneUpstream(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agency-agents-'))
  git(['clone', '--quiet', ...(ref ? [] : ['--depth', '1']), UPSTREAM, dir])
  if (ref) git(['checkout', '--quiet', ref], dir)
  return dir
}

/** Map an upstream colour (named or hex) onto Claude Code's palette. */
function normalizeColor(raw) {
  if (!raw) return null
  const value = raw.trim().replace(/^["']|["']$/g, '').toLowerCase()
  if (COLORS.includes(value)) return value
  if (COLOR_ALIASES[value]) return COLOR_ALIASES[value]

  const hex = /^#?([0-9a-f]{6})$/.exec(value)
  if (!hex) return null
  const int = parseInt(hex[1], 16)
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta < 0.08) return 'blue' // near-greyscale, including #000000

  let hue
  if (max === r) hue = 60 * (((g - b) / delta) % 6)
  else if (max === g) hue = 60 * ((b - r) / delta + 2)
  else hue = 60 * ((r - g) / delta + 4)
  if (hue < 0) hue += 360

  if (hue < 15) return 'red'
  if (hue < 45) return 'orange'
  if (hue < 70) return 'yellow'
  if (hue < 160) return 'green'
  if (hue < 200) return 'cyan'
  if (hue < 260) return 'blue'
  if (hue < 320) return 'purple'
  return 'pink'
}

function splitFrontMatter(text) {
  const lines = text.split('\n')
  if (lines[0].trim() !== '---') return null
  const end = lines.indexOf('---', 1)
  if (end === -1) return null
  const fields = {}
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (match) fields[match[1]] = match[2].trim()
  }
  return { fields, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') }
}

/** Quote a value so it survives as a single-line YAML scalar. */
function yamlString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function unquote(value) {
  return value.replace(/^["']|["']$/g, '').trim()
}

function convert(sourceFile) {
  const slug = path.basename(sourceFile, '.md')
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`file name is not a usable agent id: ${sourceFile}`)
  }
  const parsed = splitFrontMatter(fs.readFileSync(sourceFile, 'utf8'))
  if (!parsed) return null

  const title = unquote(parsed.fields.name ?? '')
  const upstreamDescription = unquote(parsed.fields.description ?? '')
  if (!title || !upstreamDescription) {
    throw new Error(`missing name/description in front matter: ${sourceFile}`)
  }

  const color = normalizeColor(parsed.fields.color)
  const front = [
    '---',
    `name: ${slug}`,
    `description: ${yamlString(`${title} - ${upstreamDescription}`)}`,
  ]
  if (parsed.fields.tools) front.push(`tools: ${unquote(parsed.fields.tools)}`)
  if (color) front.push(`color: ${color}`)
  front.push('---', '')

  return { slug, title, description: upstreamDescription, content: `${front.join('\n')}\n${parsed.body}` }
}

function collect(sourceRoot) {
  const agents = []
  for (const division of DIVISIONS) {
    const dir = path.join(sourceRoot, division)
    if (!fs.existsSync(dir)) continue
    for (const entry of fs.readdirSync(dir).sort()) {
      if (!entry.endsWith('.md')) continue
      const agent = convert(path.join(dir, entry))
      if (agent) agents.push({ ...agent, division })
    }
  }
  const seen = new Map()
  for (const agent of agents) {
    if (seen.has(agent.slug)) throw new Error(`duplicate agent id "${agent.slug}"`)
    seen.set(agent.slug, agent)
  }
  return agents
}

function renderDoc(agents, commit) {
  const divisions = [...new Set(agents.map((a) => a.division))]
  const lines = [
    '# Agency agents',
    '',
    `${agents.length} specialist subagents vendored into \`.claude/agents/\` from`,
    `[itallstartedwithaidea/agency-agents](${UPSTREAM.replace(/\.git$/, '')}) at commit \`${commit}\`.`,
    '',
    'They load automatically in any Claude Code session opened on this repository —',
    'CLI, desktop or web — with no per-machine install step. Ask for one by title',
    '("use the Frontend Developer agent") or by id.',
    '',
    '## Refreshing',
    '',
    '```bash',
    'node scripts/sync-agency-agents.mjs          # pull the latest upstream roster',
    'node scripts/sync-agency-agents.mjs --check  # verify the vendored copy is current',
    '```',
    '',
    'Edits made directly in `.claude/agents/` are overwritten by a sync; change the',
    'upstream agent (or the conversion in `scripts/sync-agency-agents.mjs`) instead.',
    '',
    '## Roster',
    '',
  ]
  for (const division of divisions) {
    lines.push(`### ${division}`, '', '| Agent | Id | Focus |', '| --- | --- | --- |')
    for (const agent of agents.filter((a) => a.division === division)) {
      const focus = agent.description.replace(/\|/g, '\\|')
      lines.push(`| ${agent.title} | \`${agent.slug}\` | ${focus} |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function writeAll(agents, doc, { check }) {
  const planned = new Map(agents.map((a) => [`${a.slug}.md`, a.content]))
  planned.set('__doc__', doc)

  const existing = fs.existsSync(DEST)
    ? fs.readdirSync(DEST).filter((f) => f.endsWith('.md'))
    : []
  const drift = []

  for (const stale of existing) {
    if (!planned.has(stale)) drift.push(`removed: .claude/agents/${stale}`)
  }
  for (const agent of agents) {
    const target = path.join(DEST, `${agent.slug}.md`)
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
    if (current !== agent.content) drift.push(`${current === null ? 'added' : 'updated'}: .claude/agents/${agent.slug}.md`)
  }
  const currentDoc = fs.existsSync(DOC) ? fs.readFileSync(DOC, 'utf8') : null
  if (currentDoc !== doc) drift.push(`${currentDoc === null ? 'added' : 'updated'}: docs/agency-agents.md`)

  if (check) return drift

  fs.mkdirSync(DEST, { recursive: true })
  for (const stale of existing) {
    if (!planned.has(stale)) fs.rmSync(path.join(DEST, stale))
  }
  for (const agent of agents) {
    fs.writeFileSync(path.join(DEST, `${agent.slug}.md`), agent.content)
  }
  fs.mkdirSync(path.dirname(DOC), { recursive: true })
  fs.writeFileSync(DOC, doc)
  return drift
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 24).join('\n'))
    return
  }

  let sourceRoot = opts.source ? path.resolve(opts.source) : null
  let temp = null
  if (!sourceRoot) {
    temp = cloneUpstream(opts.ref)
    sourceRoot = temp
  }

  try {
    const commit = git(['rev-parse', 'HEAD'], sourceRoot).slice(0, 7)
    const agents = collect(sourceRoot)
    if (agents.length === 0) throw new Error(`no agent definitions found under ${sourceRoot}`)

    const drift = writeAll(agents, renderDoc(agents, commit), opts)
    if (opts.check) {
      if (drift.length > 0) {
        console.error(`Vendored agents are out of date with ${commit}:`)
        for (const line of drift) console.error(`  ${line}`)
        process.exitCode = 1
      } else {
        console.log(`Vendored agents match upstream ${commit} (${agents.length} agents).`)
      }
      return
    }
    console.log(`Synced ${agents.length} agents from upstream ${commit} into .claude/agents/.`)
    for (const line of drift) console.log(`  ${line}`)
    if (drift.length === 0) console.log('  (already up to date)')
  } finally {
    if (temp) fs.rmSync(temp, { recursive: true, force: true })
  }
}

main()
