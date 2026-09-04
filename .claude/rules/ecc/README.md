# ECC rule packs (vendored)

These are copied verbatim from [affaan-m/ECC](https://github.com/affaan-m/ECC)
(v2.2.1, `rules/`). Claude Code plugins cannot distribute rules, so the `ecc@ecc`
plugin enabled in `.claude/settings.json` does not bring these along — they have
to live in the repo.

## Packs installed

| Pack | Why it's here |
| --- | --- |
| `common/` | Language-agnostic principles. ECC recommends always installing it. |
| `typescript/` | ECC's JS/TS pack — its path globs cover `**/*.js` and `**/*.jsx`. |
| `react/` | React 18 + JSX components. Extends `typescript/`. |
| `web/` | Frontend, CSS/Tailwind, and markup guidance. |

Packs ECC ships that we skipped: `angular`, `arkts`, `cpp`, `csharp`, `dart`,
`fsharp`, `golang`, `java`, `kotlin`, `nuxt`, `perl`, `php`, `python`,
`react-native`, `ruby`, `rust`, `swift`, `vue`. The `python/` pack is the only
near miss — the repo has five Python files, all doc-build scripts under
`tools/guide/`. Add it with `cp -R <ECC>/rules/python .claude/rules/ecc/` if
that changes.

## Scoping

Each rule file carries a `paths:` front-matter block of globs, so a pack only
applies to files it matches. ECC's own docs also describe rules as always-loaded
context, so if these start to feel heavy, drop a whole pack directory rather
than deleting individual files — the packs cross-reference each other with
relative links (`react/` points at `typescript/`, both point at `common/`).

## Updating

Re-copy whole directories, never individual files, so relative links keep
resolving:

```bash
git clone --depth 1 https://github.com/affaan-m/ECC.git /tmp/ECC
cp -R /tmp/ECC/rules/{common,typescript,react,web} .claude/rules/ecc/
```
