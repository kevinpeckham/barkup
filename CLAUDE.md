# CLAUDE.md

Guidance for agent sessions in this repository.

## What this is

barkup — an open-source TypeScript package for authoring typed trees as
HTML. Reference implementation of the pattern in
https://www.lightningjar.com/blog/ast-as-html. Author: Kevin Peckham (MIT).

## Hard constraints

- **Zero runtime dependencies in `src/`.** DOM access goes through the
  adapter seam (`src/adapter.ts`); linkedom is a devDependency for tests
  only. Enforced by `fallow-rules.json`.
- **The four guarantees are the product** (see README). Any change must
  keep the property suites green: `bun test`.
- **Scope moves only on benchmark evidence** (surface: `defineGrammar` →
  build / parse / format / validate + `barkup/testing` +
  `barkup/patch`). Anchored patches cleared that bar (barkup-bench
  condition F); nothing enters without it. Decline feature creep; bug
  fixes and guarantee hardening only.
- **format() must never regenerate an existing id** — only fill missing
  ones. This is guarantee 1 and the origin story of the package.
- Markup-side problems return structured issues; tree-side misuse throws
  `BarkupError`. Keep that split.

## Commands

```bash
bun test           # unit + property tests
bun run check      # tsc --noEmit
bun run build      # emit dist/ (ESM + d.ts)
bun run lint       # biome (auto-fix)
bun run audit      # fallow house rules
```

## Conventions

- Conventional commits (`type: description`). Never mention AI assistance
  in commits.
- TypeScript strict; tab indentation (Biome).
- Env vars: none at runtime by design; repo tooling uses varlock
  (`.env.schema`). Publish credentials via `npm login` / 1Password only.
- Publishing is manual by the author — never run `npm publish` (dry-run is
  fine).
