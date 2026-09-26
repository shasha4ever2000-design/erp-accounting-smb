# Agent Skill Security Scans

Scans of the agent skills in `.agents/skills/` (linked from `.claude/skills/`), run with
[NVIDIA SkillSpector](https://github.com/NVIDIA/SkillSpector) v2.12.0 on 2026-09-26.

Static scan only (`--no-llm`), no LLM semantic analysis.

| Skill | Score | Severity | Issues | Report |
|---|---|---|---|---|
| `supabase` | 47/100 | Medium | 3 | [md](supabase.md) · [json](supabase.json) |
| `supabase-postgres-best-practices` | 0/100 | Low | 0 | [md](supabase-postgres-best-practices.md) · [json](supabase-postgres-best-practices.json) |

## Review of the `supabase` findings

All three were checked by hand and are false positives:

| ID | Where | What it flagged | Verdict |
|---|---|---|---|
| PE3 Credential Access | `SKILL.md:38` | A note that deleting a user doesn't invalidate existing access tokens. | Security advice, no credential files are read. |
| AS2 MCP Config Access | `SKILL.md:106` | A troubleshooting step to check or create `.mcp.json` pointing at `https://mcp.supabase.com/mcp`. | Official Supabase endpoint; our `.mcp.json` already uses it in read-only mode. |
| EA2 Autonomous Decision Making | `SKILL.md:19` | "After implementing any fix, run a test query to confirm the change works." | Normal verification step. |

Other notes:

- Neither skill ships scripts or executable code, only Markdown.
- Both come from the official `supabase/agent-skills` repo (see `skills-lock.json`).
- The feedback flow in `supabase/references/skill-feedback.md` opens a GitHub issue on
  `supabase/agent-skills`, but asks the user for permission first.

## Re-running

```bash
uv tool install --python 3.12 git+https://github.com/NVIDIA/skillspector.git
skillspector scan .agents/skills/supabase --no-llm --format markdown --output docs/skill-scans/supabase.md
skillspector scan .agents/skills/supabase --no-llm --format json --output docs/skill-scans/supabase.json
```

Repeat for each skill. Drop `--no-llm` and set `ANTHROPIC_API_KEY` (with
`SKILLSPECTOR_PROVIDER=anthropic`) for the deeper LLM scan.
