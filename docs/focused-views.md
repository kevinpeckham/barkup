# Focused views — design note

Status: shipped in 0.3.0; see "Verification" below. The semantics are
ported from the benchmark-validated reference renderer (barkup-bench
`src/conditions/views-html.ts`, the implementation Study J scored) and
are fixed; this note records the contract, API, and issue-type design
for review in isolation.

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
import { renderView, VIEW_PROMPT_RULES } from "@kevinpeckham/barkup/view";

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
```

`VIEW_PROMPT_RULES` is the exact five-bullet prompt block the
benchmark validated (see below). No diffing, no retrieval, no JSON
rendering. That is the whole surface.

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

## The agent-loop recipe (goes in the README)

```ts
import { applyAnchoredPatch } from "@kevinpeckham/barkup/patch";
import { renderView, VIEW_PROMPT_RULES } from "@kevinpeckham/barkup/view";

// 0. Append VIEW_PROMPT_RULES to the agent's system prompt.

// 1. Render only what the edit concerns. (format() first if any node
//    might be missing an id — focus and patches address by id.)
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
one from history.

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

**Scope caveats (pre-registered in the studies).** The benchmark
measured the oracle bound: task instructions named their target ids,
so retrieval was trivially perfect. How a real system finds the
relevant node ids from a vague request is deliberately out of scope —
`renderView` takes the focus set as given.
