# OmniRoute plugin

Claude Code plugin wrapping [OmniRoute](https://github.com/diegosouzapw/OmniRoute), a
self-hosted AI gateway that puts many AI providers behind one OpenAI-compatible endpoint.

## What's in it

- `skills/` — the 45 agent skills from OmniRoute's `skills/` folder (API skills `omni-*`,
  CLI skills `cli-*`). Copied from upstream commit `8e3b486`. MIT licensed, see `LICENSE`.
  The third-party `ponytail` skill was left out on purpose: it isn't about OmniRoute and
  would change how Claude writes all code.
- `.mcp.json` — connects Claude Code to OmniRoute's MCP server over HTTP.

## Before you use it

The skills and MCP tools talk to a running OmniRoute server. Start one first:

```bash
npm i -g omniroute
omniroute            # serves on http://localhost:20128
```

If your server is somewhere else, set `OMNIROUTE_URL` (for example
`OMNIROUTE_URL=https://omniroute.example.com`) before starting Claude Code.

## Installing

The repo's `.claude/settings.json` registers this folder as a local marketplace and
turns the plugin on, so Claude Code offers to install it when you trust the project.
To add it by hand:

```bash
claude plugin marketplace add .
claude plugin install omniroute@erp-accounting-smb
```

## Updating the skills

```bash
git clone --depth 1 https://github.com/diegosouzapw/OmniRoute /tmp/omniroute
rsync -a --delete --exclude ponytail --exclude README.md /tmp/omniroute/skills/ plugins/omniroute/skills/
```
