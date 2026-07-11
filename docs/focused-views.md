# Focused views — design note

Status: rendering shipped in 0.3.0; content search (`findNodes` /
`renderSearch`, the Study N companion) shipped in 0.4.0;
deterministic selection (`selectNodes`, the Study R fan-out
enumeration step) shipped in 0.5.0; see "Verification" below. The
semantics are ported from the benchmark-validated reference
implementations (barkup-bench `src/conditions/views-html.ts`, the
renderer Study J scored; `src/conditions/grounded-n.ts`, the search
scorer Study N scored; and `src/corpus/fanout.ts`, the enumerator
Study R's decomposition pipeline ran) and are fixed; this note
records the contract, API, and issue-type design for review in
isolation.

## Why this exists

Anchored patches (`barkup/patch`) made the model's *output* cost
independent of tree size, but every prior benchmark condition still
put the full tree in the prompt — so *input* cost kept scaling with
node count. barkup-bench's Study I (pre-registered) replaced the
prompt tree with a **focused view**: the root-to-target spine rendered
fully, everything else collapsed to id-bearing placeholders or omitted
with an honest count, while the patch still applied to the full tree.
Accuracy was statistically unchanged in every paired comparison
against full input (McNemar p = 0.5–1.0; sonnet went a perfect 45/45
on the minimal view), and median input per ~1000-node task fell from
85,642 tokens to 1,531 (−98%). The minimal view's input barely grows
with tree size (1,331 → 1,531 median tokens from ~300 to ~1000
nodes): it scales with tree **depth**, not node count, which
effectively removes the context-window ceiling for id-addressed
edits.

Study J (also pre-registered) re-ran both view modes with the
identical view content rendered in barkup's native HTML dialect
instead of JSON. HTML views matched JSON views exactly (McNemar
p = 1.0 in all four paired comparisons; three of four had zero
discordant pairs), were terser at every size (at ~1000 nodes: −24%
input tokens for the focused mode, −9% for minimal — the minimal HTML
view's input is ~1.6% of full-input F's), and had *better* first-pass
patch validity (84–85/90 vs 80–81/90). HTML is therefore the native —
and only — rendering this entry ships.

The one precondition is stable node ids (guarantee #1), and the one
invariant that makes views compose with `applyAnchoredPatch` is:
**every visible id is a real id in the tree** — visible implies
patchable. This is an evidence-driven scope extension on the same
standard as anchored patches: one validated capability, one new
subpath entry, core codec untouched.

## Entry point

New subpath export `@kevinpeckham/barkup/view` (like `/patch`). Zero
runtime dependencies; no DOM involvement — views are built from
`BarkupNode` trees and serialized by the shipped `build()`.

## API surface (complete)

```ts
import {
  renderView,
  findNodes,
  selectNodes,
  renderSearch,
  VIEW_PROMPT_RULES,
  SEARCH_PROMPT_RULES,
  NO_MATCHES_MESSAGE,
} from "@kevinpeckham/barkup/view";

function renderView(
  grammar: Grammar,
  tree: BarkupNode,
  options: ViewOptions,
): ViewResult;

interface ViewOptions {
  focus: readonly string[]; // ids the edit concerns
  mode?: "focused" | "minimal"; // default "minimal"
}

type ViewResult =
  | { ok: true; html: string }
  | { ok: false; issues: ViewIssue[] };

function findNodes(
  tree: BarkupNode,
  query: string,
  options?: { limit?: number }, // default 5, the benched top-k
): string[];

function selectNodes(
  tree: BarkupNode,
  query: SelectQuery, // exact, ANDed; {} matches every id-bearing node
): string[]; // ids in document order; unknown `within` → []

interface SelectQuery {
  type?: string; // exact
  name?: string; // exact
  attributes?: Record<string, AttributeValue>; // deep-equal on values
  within?: string; // strict descendants of this id only
}

function renderSearch(
  grammar: Grammar,
  tree: BarkupNode,
  query: string,
  options?: { limit?: number; mode?: "focused" | "minimal" },
): ViewResult | null; // null = no matches (see below)
```

`VIEW_PROMPT_RULES` and `SEARCH_PROMPT_RULES` are the exact prompt
blocks the benchmark validated (see below); `NO_MATCHES_MESSAGE` is
the exact no-match tool result it scored. `findNodes` and
`selectNodes` are the two grounding utilities — fuzzy search grounds
human language, exact selection grounds programmatic queries. No
diffing, no embeddings, no JSON rendering, no selector-string parsing
(a CSS-selector sugar over `SelectQuery` is deliberately deferred —
the object form has zero parsing risk and covers everything Study R
measured). That is the whole surface.

## The view contract (fixed, ported from the reference)

Given a grammar, a tree, and a set of focus node ids:

1. The **spine** — every node on a root-to-focus path — renders
   fully: type, name, id, attributes, byte-identical to `build()` of
   that node shell.
2. **Children of focus nodes always appear, in document order**, at
   minimum as placeholders. This is what keeps ordinal placements
   ("insert as the 3rd child of …") resolvable, and it is
   benchmark-load-bearing.
3. A **placeholder** is a childless element carrying only type, name,
   id, `data-collapsed="true"`, and `data-child-count="N"` — where N
   is the node's *real* child count — and no grammar attributes.
4. Two modes. **"focused"** renders every non-spine child of a spine
   node as a placeholder. **"minimal"** (the default) omits them
   entirely and puts `data-omitted-children="N"` on the parent. Both
   modes passed the pre-registered gate; minimal is the mode the data
   favors (sonnet 45/45; cheapest input at every size).
5. **Every visible id is a real id in the tree.** Unknown focus ids
   are a structured error, never silently ignored.
6. Rendering is deterministic and never mutates the input tree.

A view is a **prompt artifact, not a round-trip input**: placeholders
omit required attributes and carry view-only `data-*` attributes, so
view output is deliberately not valid input to `parse()`. The model
reads the view; its patch applies to the full tree.

## Reserved attributes

The view dialect reserves three attribute names — `collapsed`,
`childCount`, `omittedChildren` (rendered as `data-collapsed`,
`data-child-count`, `data-omitted-children`). If the consumer's
grammar declares any of them on any node type, or a tree node carries
one (possible under the `unknownAttributes: "string"` policy),
`renderView` returns a structured issue rather than emitting markup
in which real data is indistinguishable from view metadata.

## Issue-type design

Focus ids are agent-loop data (a stale id is correction feedback, not
a crash), so the markup-side error model applies: failures are data,
never throws.

```ts
type ViewIssueCode = IssueCode | "invalid-view";

interface ViewIssue {
  code: ViewIssueCode;
  message: string;
  path: string; // "(view focus)" for focus problems
  nodeId?: string;
  attribute?: string;
}
```

Unknown focus ids, malformed focus arrays, and reserved-attribute
collisions all get `code: "invalid-view"`; every problem is reported
in one pass (all unknown ids, all collisions), consistent with
`parse()`. `GrammarIssue` is assignable to `ViewIssue`; the core
`IssueCode` union is untouched — `"invalid-view"` exists only in the
view entry's vocabulary, exactly as `"invalid-patch"` does in the
patch entry's.

Tree-side misuse keeps its side of the split: an invalid base tree
(unknown types, wrong attribute value types) throws `BarkupError`
from `build()`, and an unknown `mode` — the caller's program config,
not model input — throws too.

## The prompt block

`VIEW_PROMPT_RULES` is the exact five-bullet "View rules" text
pre-registered in barkup-bench `docs/BRIEF-J.md` and scored by Study
J. Append it verbatim to the system prompt of any agent shown a view.
The zero duplicate-id-collision result across 360 scored view runs is
attributable to that wording (specifically the fresh-id bullet);
consumers should not have to rediscover it.

`SEARCH_PROMPT_RULES` is the same deal for agents given a `find_nodes`
search tool: the three-bullet "Search rules" block pre-registered in
barkup-bench `docs/BRIEF-N.md` and scored by Study N, with one
generalization — the benchmark's "reply with the anchored patch" became
"reply with your patch", the same benchmark-dialect strip
`VIEW_PROMPT_RULES` received. Under this wording the median run needed
exactly ONE `find_nodes` call to ground an id-free edit request.

## The agent-loop recipe (goes in the README)

```ts
import { applyAnchoredPatch } from "@kevinpeckham/barkup/patch";
import { renderView, VIEW_PROMPT_RULES } from "@kevinpeckham/barkup/view";

// 0. Append VIEW_PROMPT_RULES to the agent's system prompt.

// 1. Render only what the edit concerns. (format() first if any node
//    might be missing an id — focus and patches address by id. No ids
//    to hand? See "Finding the focus ids" below.)
const view = renderView(grammar, storedTree, { focus: editTargetIds });
if (!view.ok) return retryWithFeedback(view.issues); // e.g. stale ids

// 2. Show view.html; ask for an anchored patch.

// 3. Apply against the FULL tree — every hidden node still exists.
const result = applyAnchoredPatch(grammar, storedTree, JSON.parse(reply));
if (!result.ok) return retryWithFeedback(result.issues); // verbatim
persist(result.node);
```

In multi-turn sessions, views from earlier turns go stale as patches
land — generate a fresh view for each editing turn rather than reusing
one from history. Two validated ways to run the session around those
views (barkup-bench REPORT.md, Study P addendum, 2026-07-09): keep
the full conversation history alongside the per-turn views (Studies
K, M, and O; annotating views with child positions is optional and
harmless), or go fully stateless with two worked examples — an
ordinal insert and an ordinal move, from a fixed tree unrelated to
any real document — in the system prompt (Study P: matches
full-history accuracy on both models tested; Study S: still true at
36-edit lengths with no late-session decay, at flat ~2.1k input per
step — 5–6× less than keep-history, whose per-step input grows
linearly with session length). Both options cover self-contained
requests; requests that reference earlier conversation fail
stateless by construction (Study T: 0/160 callbacks) and are fixed
by an app-maintained session-notes memo appended per step (80/80
recovered, history-parity at 1.02× stateless cost — the README's
Sessions section shows the registered block). The examples must use
the consumer's grammar, so
barkup ships no canned block; the README's Sessions section
documents the pattern, with barkup-bench `src/harness/examples.ts`
as the reference implementation.

## Finding the focus ids — content search (Study N)

The recipe above takes the focus ids as given. Study N (pre-registered
in barkup-bench `docs/BRIEF-N.md`; REPORT.md addendum, 2026-07-09)
measured how a system should *find* them when all it has is a human
description, and the answer graduated into this entry as `findNodes` /
`renderSearch`. Pick the tier that matches what your application
knows:

1. **The app knows the ids** (they came from a UI selection, a
   database row, a previous turn — or a programmatic query:
   `selectNodes(tree, { type, name, attributes, within })` enumerates
   the matching ids exactly, in document order): render the view
   directly. This is the Studies I/J oracle case — retrieval is free,
   accuracy is the ceiling (sonnet 45/45 on the minimal view).
   `selectNodes` is what makes fan-out requests belong to this tier —
   see "The fan-out boundary" below. In every tier, the focus must
   cover **every node the request mentions**, not just the edit
   target: Study U measured dependent edits ("set A's content to
   match B's") against target-only views and both models silently
   invented plausible values on all 90 cells — no refusals, no
   invalid artifacts. With the mentioned source node added to the
   focus ids, 90/90 succeeded at ~1.7k tokens median. View scope is
   a correctness contract. One measured refinement (Study V,
   judge-graded): the view contract covers **values** an edit must
   read, not **goals** it must satisfy — a model shown the node where
   a qualitative goal lives reads it but writes measurably less
   focused prose than one told the goal in the instruction or the
   session memo. Views carry values; memos carry goals.
2. **The app has only a human description** ("make the hero shorter"):
   give the model a skeleton view — the root with its children
   collapsed, `renderView(grammar, tree, { focus: [rootId] })` — plus
   a `find_nodes` tool backed by `renderSearch`, and append
   `SEARCH_PROMPT_RULES` to the system prompt. One tool call is the
   median. In Study N this grounded id-free requests at 43/45 on
   sonnet-4.5 (equal to its id-oracle bound) and 39/45 on
   gemini-3.5-flash — versus 23/45 for the expand-node navigation
   agent it replaces (p < 0.001) — at ~4–7k input tokens per task,
   ~90% below a full-tree read. Deterministic keyword
   overlap is enough: upgrading the scorer to
   `openai/text-embedding-3-small` measured *no better* (target
   coverage 23/45 vs lexical's 24/45; task success statistically
   identical), because node-level embeddings resolve structural
   references ("the 3rd block inside the section named atlas") no
   better than keywords do.
3. **A frontier patcher under budget pressure**: ground with a cheap
   model first — show it the full tree, ask only for the target ids —
   then have the frontier model patch against the minimal view of
   those ids. Study N's cross cell (gemini grounds, sonnet patches)
   held accuracy at 41/45 while the frontier model's median input
   dropped to 1,484 tokens, 97% less. Grounding is cheap-model work:
   gemini's stage-1 id lists were exactly as good as sonnet's.

The tool wiring for tier 2:

```ts
import {
  findNodes,
  renderSearch,
  NO_MATCHES_MESSAGE,
  SEARCH_PROMPT_RULES,
} from "@kevinpeckham/barkup/view";

// The find_nodes tool the model calls (any tool-use framework):
function findNodesTool(query: string): string {
  const result = renderSearch(grammar, storedTree, query);
  if (result === null) return NO_MATCHES_MESSAGE; // the benched miss text
  if (!result.ok) throw new Error("unrenderable grammar"); // app bug, not model error
  return result.html; // matches shown in place, ancestors visible
}
```

`renderSearch` is exactly the composition
`renderView(grammar, tree, { focus: findNodes(tree, query), mode: "minimal" })`
— it exists so the tool result you ship is the rendering the
benchmark scored. A miss returns `null` rather than an issue:
"nothing matched" is retrieval data the model should react to (the
issues union stays reserved for real failures like reserved-attribute
collisions), and `NO_MATCHES_MESSAGE` is exported so the miss text
matches the benched wording too.

`findNodes` itself is the scorer the benchmark handed to models:
distinct-token overlap between the query and each node's type, name,
and attributes (lowercase alphanumeric runs), nodes without ids
skipped, zero scores excluded, ties by document order, top 5 by
default. It is deliberately simple — see the tier-2 numbers above for
why simple is enough.

### The fan-out boundary (Studies Q and R)

The three tiers above are single-target validated: every Study N
task edited one node. Study Q (pre-registered in barkup-bench
`docs/BRIEF-Q.md`; REPORT.md addendum, 2026-07-09) stress-tested the
tier-2 recipe on fan-out instructions — "set textStyle to serif on
every text-atom inside the block named X", 2–32 targets — and both
the recipe's economics and its accuracy fail there: median 6
`find_nodes` calls instead of 1, 34 of 90 runs above 100k input
tokens (max 2.4M), and on gemini −24.4 pp vs a whole-tree prompt
(11–0 discordant, p = 0.001). The deeper result: retrieval is not
the bottleneck. With every target visible in an oracle view, success
is 62–69% overall and 44–50% at 7+ targets, versus 87–100%
single-target — failures are 100% partial coverage; models emit
legal patches that stop short of the full target set. The models
also invert (sonnet does better on the focused view, p = 0.022;
gemini on the full tree, p = 0.008 — the first inversion in the
series), so no prompt-shape choice rescues fan-out
model-independently.

The guidance is **decomposition, in the application** — and as of
Study R (pre-registered in barkup-bench `docs/BRIEF-R.md`; REPORT.md
addendum, 2026-07-09) that loop is measured, not inferred, and its
enumeration step ships here as `selectNodes`:

```ts
const targets = selectNodes(tree, { type: "text-atom", within: sectionId });
for (const id of targets) {
  // one single-target anchored edit per node, focused view of that node
}
```

Study R executed exactly this pipeline against the same 45 fan-out
tasks per model that broke every prompt-side approach: **90/90 tasks
on both models, 674/674 subtasks, zero failures** — including every
7–32-target task, where the one-prompt arms ran ~45% — at about a
third of the input cost of showing the whole tree once (median ~8k
input tokens per task vs ~40–48k for any full-tree arm, and mean
~10k per solved task vs 51–102k for the search-driven recipe). The
prompt-side alternatives it was audited against all left partial
coverage: a worked example did not transfer to exhaustiveness
(essentially refuted; best arm 4–1 vs base, p = 0.375), a checklist
instruction helped only one model on one context shape (sonnet
full-tree, 9–1, p = 0.021 — still below its view baseline), and the
Study Q model inversion persisted through every prompt arm. More
model calls, but each call is back in the 87–100% single-target
regime the tiers above were measured in — and per-edit reliability
in the pipeline itself was 100% at n = 674, so compounding never bit
at these lengths.

`selectNodes` semantics (fixed; the `{type, within}` case is a
faithful port of the enumerator the study ran, barkup-bench
`src/corpus/fanout.ts` `fanoutTargets`): all present criteria are
ANDed; an empty query matches every id-bearing node; `within` scopes
to strict descendants (the anchor itself never matches), and an
unknown `within` id returns `[]` — selection is data, not an error,
the same null-on-a-miss philosophy as `renderSearch` (a `within` id
can go stale between turns exactly like a search that stops
matching; the module's throws stay reserved for program config and
invalid trees). Results are ids in document order (depth-first
pre-order, the same order `findNodes` breaks ties in); nodes without
ids are skipped; attribute constraints are deep-equal on values
(primitives strict, json values structural with object key order
ignored). Purely structural and synchronous — no scoring, no
fuzziness. A CSS-selector-string sugar is a possible future
addition, deliberately deferred: the object form has zero parsing
risk and covers everything Study R measured.

Honest caveats, pre-registered with the study: two models
(claude-sonnet-4.5 and gemini-3.5-flash), a generated corpus, and
fan-out subtasks of two kinds (set-attribute and remove on a named
id against a focused view). Whether per-edit reliability holds at
100% for harder subtask kinds or much longer target lists is
untested.

## Test plan (quality bar)

Property tests over `treeArbitrary` (fast-check): (1) every id
visible in the output exists in the tree; (2) focus nodes render
expanded with their complete child list in document order; (3)
placeholder child counts and omission counts are honest — rendered
children plus omitted equals the real child count; (4) visible
implies patchable — every visible id is a valid `applyAnchoredPatch`
target on the full tree; (5) determinism and input immutability; (6)
untouched-serialization parity — focusing every leaf reproduces
`build(tree)` byte-for-byte. Plus example-based unit tests for the
contract and every failure mode, and the exact prompt-block wording
pinned by test.

Search gets the same bar: unit tests port the benchmark's scorer suite
(ranking, zero-score exclusion, document-order ties, the limit cap,
id-less skipping, the no-match null, the pinned prompt block and miss
message), and property tests check `findNodes` against an independent
re-scoring over random trees (results real, relevant, distinct,
capped, rank-ordered; nothing relevant omitted from an unfilled
result; determinism and immutability; `renderSearch` equal to the
documented composition with every match visible).

Selection too: unit tests port the benchmark's enumeration cases and
cover AND semantics, strict-descendant scoping, the unknown-`within`
empty result, attribute deep-equality (primitives strict; json
arrays order-significant, object key order not), the empty query,
pre-order results, id-less skipping, determinism, and immutability;
a property test checks `selectNodes` against an independently
re-implemented filter over a full pre-order walk — equal output, in
walk order — with queries drawn from the trees themselves so json
attribute matching is exercised with real values.

## Verification

The shipped implementation replays the 39-vector conformance suite
generated by the exact renderer Study J scored (barkup-bench
`corpus/view-vectors.json`, vendored here at
`tests/fixtures/view-vectors.json`, replayed by
`tests/view-vectors.test.ts` against the benchmark grammar) with
byte-for-byte agreement on every rendering. Divergence from a vector
is a bug in the implementation, not the vector. The same epistemic
caveat as anchored patches applies: the shipped code is a port of the
reference renderer, so this is divergence detection, not independent
oracle verification — but alternate implementations of the view
dialect can prove conformance by replaying the vendored file.

`findNodes` is a port of the Study N scorer (barkup-bench
`src/conditions/grounded-n.ts` `searchNodes`, with `tokenize` /
`searchableText` from `src/conditions/grounded.ts`), verified by the
ported unit suite plus independent re-scoring property tests. One
deliberate divergence: the benchmark harness's tree walk was
breadth-first, so its ties between equal-scored nodes at different
depths followed BFS order; the pre-registered spec (and this port)
break ties by document order — depth-first pre-order — as BRIEF-N
states. Rankings differ only on those cross-depth ties.

`selectNodes` is a port of the Study R enumerator (barkup-bench
`src/corpus/fanout.ts` `fanoutTargets`, the `{type, within}` case
the study executed), generalized to the full ANDed query (`name`,
`attributes`, the empty query) and with two documented differences
from the benchmark function's shape: unknown `within` ids return
`[]` instead of throwing (the benchmark threw because a missing
container there meant a corpus bug; here the query is caller data,
and selection-is-data matches `renderSearch`'s miss philosophy), and
result order is document order (depth-first pre-order) where the
benchmark's `descendants()` walk was breadth-first — the same
cross-depth-order divergence documented for `findNodes` above, and
order-irrelevant to Study R's result since every target received an
independent edit. Verified by the ported enumeration cases from the
benchmark's fan-out suite plus a property test checking `selectNodes`
against an independently re-implemented filter over a full pre-order
walk, in walk order.

Headline numbers (barkup-bench REPORT.md, Study I and Study J
addenda, both pre-registered; 360 scored view runs across two models):

- **Accuracy statistically unchanged** vs full input: paired McNemar
  p = 0.5–1.0 in every comparison; discordant pairs 1–4 per
  comparison, trading in both directions. Sonnet on the minimal view:
  45/45, numerically better than its full-input 43/45.
- **Input tokens at ~1000 nodes** (sonnet, median per task): full
  tree 85,642 → minimal view ~1.4k (−98%; 1,531 as JSON in Study I,
  1,391 as HTML in Study J — ~1.6% of full input).
- **View size scales with tree depth, not node count**: minimal-view
  median input grew only 1,331 → 1,531 tokens from ~300 to ~1000
  nodes.
- **HTML is the cheaper, equally accurate rendering**: p = 1.0 in all
  four paired HTML-vs-JSON comparisons; −24% (focused) and −9%
  (minimal) input tokens at ~1000 nodes; first-pass validity 84–85/90
  vs 80–81/90.
- **Zero duplicate-id collisions in 360 runs** — every correction
  round in both studies was `invalid-patch`, never `duplicate-id`;
  the pre-registered fresh-id worry never materialized under
  `VIEW_PROMPT_RULES`' wording.

Combined Study I + J guidance: at any size where you know which nodes
an edit concerns, a focused HTML view plus an id-anchored patch is
simultaneously the most reliable, cheapest, and fastest editing
interface measured, with input that scales with tree depth rather
than node count.

Search headline numbers (barkup-bench REPORT.md, Study N addendum,
2026-07-09, pre-registered in `docs/BRIEF-N.md`; 315 scored cells,
zero errors, every record independently re-graded):

- **Skeleton view + one `find_nodes` tool call** grounds id-free edit
  requests at 43/45 on sonnet-4.5 (equal to its id-oracle bound;
  beats its own full-tree read 4–0) and 39/45 on gemini-3.5-flash
  (vs 23/45 for expand-node navigation, 16–0 discordant, p < 0.001;
  equal to its full-tree read) — median ONE search call, ~4–7k input
  tokens per task, ~90% below full-tree.
- **Embeddings measured no better than this keyword scorer**: top-5
  target coverage 23/45 vs lexical's 24/45; task success
  statistically identical (p = 0.688 / 1.000).
- **Cheap-model grounding + frontier patching** (tier 3) held 41/45
  while the frontier model's median input fell to 1,484 tokens
  (−97.4%); the cheap model's id lists were exactly as good as the
  frontier model's (valid 45/45, covers targets 41/45 for both).

**Scope caveats (pre-registered in the studies).** Studies I and J
measured the oracle bound — task instructions named their target ids,
so retrieval was trivially perfect — and `renderView` still takes the
focus set as given. Study N closed the retrieval question for the
id-free **single-target** case; Study Q bounded the recipe on the
fan-out side and Study R measured the decomposition that resolves it
(see "The fan-out boundary" above). The benchmark's standing limits
apply throughout: two models (claude-sonnet-4.5 and
gemini-3.5-flash), a generated corpus, trees of roughly 300–1000
nodes. Whether the same tiers hold for other model families,
human-authored trees, or much larger documents is untested.
