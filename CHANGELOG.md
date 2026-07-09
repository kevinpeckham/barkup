# Changelog

All notable changes to `@kevinpeckham/barkup`. The project follows
semver; the core surface is stable and scope moves only on benchmark
evidence (see the README's maintenance posture).

## 0.5.0 — 2026-07-09

### Added

- **`selectNodes(tree, query)` in `@kevinpeckham/barkup/view` — the
  measured fan-out decomposition loop.** Deterministic, exact node
  selection: `SelectQuery` criteria (`type`, `name`, `attributes`,
  `within`) are ANDed; an empty query matches every id-bearing node;
  `within` scopes to strict descendants of the anchor (an unknown id
  returns `[]` — selection is data, not an error); attribute
  constraints are deep-equal on values (primitives strict, json
  values structural, object key order ignored); results are ids in
  document order (depth-first pre-order), id-less nodes skipped.
  Ported from the enumerator barkup-bench Study R executed
  (`src/corpus/fanout.ts` `fanoutTargets`) and generalized to the
  full object query. The exact complement to `findNodes`: fuzzy
  search grounds human language, `selectNodes` grounds programmatic
  queries. A CSS-selector-string sugar is deliberately deferred.
- In Study R (barkup-bench REPORT.md addendum, 2026-07-09,
  pre-registered in BRIEF-R), this enumeration plus one single-target
  anchored edit per returned id ran **90/90 fan-out tasks on both
  models tested (674/674 subtasks, zero failures)**, including every
  7–32-target task, at about a third of the input cost of a
  whole-tree prompt — while every prompt-side alternative (worked
  example, checklist, whole tree, search) left partial coverage.

### Changed

- The fan-out boundary docs (README and `docs/focused-views.md`, added
  for Study Q) get their resolution: the decomposition loop is now
  measured rather than inferred, shown as a complete `selectNodes`
  example with the Study R numbers and caveats; the three-tier
  grounding table's "your app knows the ids" tier names `selectNodes`
  for programmatic queries; `docs/architecture.md` exports and test
  inventories updated.
- README's maintenance posture now states the two-layer promise
  explicitly: the core codec is scoped and stable, while the
  surrounding toolkit grows research-first — each utility shipping
  only with a pre-registered study's numbers attached, as a minor
  version.

## 0.4.0 — 2026-07-09

### Added

- **Content search in `@kevinpeckham/barkup/view` — the
  search-then-patch recipe.** `findNodes(tree, query, { limit? })` is
  the deterministic scorer barkup-bench Study N handed to models as a
  `find_nodes` tool: distinct-token overlap between the query and each
  node's type, name, and attributes; id-less nodes skipped; zero
  scores excluded; ties by document order; top 5 by default. In the
  benchmark, a skeleton view plus a median of ONE search call grounded
  id-free edit requests at 43/45 on sonnet-4.5 (equal to its id-oracle
  bound) and 39/45 on gemini-3.5-flash (vs 23/45 for expand-node
  navigation, p < 0.001) at ~90% less input than a full-tree read —
  and upgrading the scorer to text embeddings measured no better.
- **`renderSearch(grammar, tree, query, { limit?, mode? })`** — the
  exact tool-result composition the study scored (`renderView` over
  `findNodes`, minimal mode by default). Returns `null` on a miss;
  **`NO_MATCHES_MESSAGE`** exports the exact no-match text the
  benchmark sent back as the tool result.
- **`SEARCH_PROMPT_RULES`** — the three-bullet search prompt block
  pre-registered in barkup-bench BRIEF-N and scored by Study N (with
  the benchmark's "anchored patch" phrasing generalized, as with
  `VIEW_PROMPT_RULES`), pinned verbatim by a unit test.
- Docs graduate `/view` from "your application must supply the focus
  ids" to the benchmarked three-tier recipe (known ids → render
  directly; human description → skeleton view + `find_nodes`; frontier
  patcher under budget pressure → cheap-model grounding, 41/45 at 97%
  less frontier input). README, `docs/focused-views.md`, and
  `docs/architecture.md` updated with the Study N numbers and caveats.

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
