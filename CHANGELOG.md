# Changelog

All notable changes to `@kevinpeckham/barkup`. The project follows
semver; the core surface is stable and scope moves only on benchmark
evidence (see the README's maintenance posture).

## 0.3.0 — 2026-07-07

### Added

- **`@kevinpeckham/barkup/view` — focused views.** `renderView(grammar,
  tree, { focus, mode? })` renders only the part of the tree an edit
  concerns as HTML-dialect markup: the root-to-focus spine fully,
  children of focus nodes always in document order (at minimum as
  `data-collapsed` placeholders with honest `data-child-count`), and
  everything else omitted with `data-omitted-children` (`"minimal"`,
  the default) or shown as placeholders (`"focused"`). Every visible
  id is a real, patch-addressable id in the tree; unknown focus ids
  and reserved-attribute collisions return structured issues
  (`code: "invalid-view"`). Semantics ported from the renderer
  barkup-bench Studies I and J validated: accuracy statistically
  unchanged vs full-tree prompts while median input per ~1000-node
  task fell ~98%, scaling with tree depth instead of node count. Zero
  runtime dependencies, like every entry.
- **`VIEW_PROMPT_RULES`** — the exact five-bullet prompt block the
  benchmark scored (zero duplicate-id collisions across 360 view
  runs), exported so consumers don't have to rediscover the wording.
- **View conformance vectors** — the benchmark's 39-vector suite
  vendored at `tests/fixtures/view-vectors.json` and replayed
  byte-for-byte by `tests/view-vectors.test.ts`; alternate
  implementations of the view dialect can prove conformance by
  replaying the file.
- `docs/focused-views.md` — contract, API, issue design, prompt
  block, and verification evidence.

### Reserved

- The view dialect reserves three attribute names on every node type:
  `collapsed`, `childCount`, `omittedChildren` (rendered as
  `data-collapsed`, `data-child-count`, `data-omitted-children`).
  Grammars that declare them cannot render views; `renderView`
  reports each collision as a structured issue. The core codec is
  unaffected.

## 0.2.0 — 2026-07-06

### Added

- **`@kevinpeckham/barkup/patch` — anchored patches.**
  `applyAnchoredPatch(grammar, tree, operations)`: atomic,
  grammar-validated edits addressing nodes by id (`before`/`after`
  sibling anchors or `parentId` append — no positional indexes),
  ported from the benchmark-validated reference (barkup-bench
  condition F). Failures are data (`code: "invalid-patch"` with the
  failing op index), never throws; the input tree is never mutated.
- `docs/anchored-patches.md` design note and the vendored 40-vector
  conformance suite (`tests/fixtures/patch-vectors.json`, added
  post-release with the shipped-artifact verification).

## 0.1.2 — 2026-07-05

- Documented production use (agent-edit validation gate in the
  package's source platform). No code changes.

## 0.1.1 — 2026-07-05

- Release workflow switched to npm trusted publishing (OIDC,
  provenance). No code changes.

## 0.1.0 — 2026-07-05

- Initial release: the core codec. `defineGrammar(config)` →
  `build` / `parse` / `format` / `validate`, the DOM adapter seam,
  declared attribute coercion, structured issues, and the four
  guarantees (id preservation, round-trip identity, declared coercion
  only, loud boundaries) proven by unit + fast-check property suites,
  with `@kevinpeckham/barkup/testing` shipping the same helpers for
  consumer grammars.
