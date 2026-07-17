# barkup

**Author typed trees as HTML.** A config-driven grammar codec with byte-for-byte id preservation, declared attribute coercion, and property-tested round-trip guarantees — designed for humans and LLM agents authoring the same markup.

> Bark is how a tree shows you what it is without being cut open.

barkup is the reference implementation of the pattern described in
[HTML as a Native Data Format for LLMs](https://www.lightningjar.com/blog/ast-as-html):
store your tree as typed JSON, but let people — and language models — **author** it
as HTML, where every container carries its labels on the outside.

```html
<div data-type="block" data-name="feature-callout" id="wgt-root">
  <div data-type="text-atom" data-name="heading" id="wgt-heading"
       data-text-style="heading-2" data-max-length="60"></div>
</div>
```

Working with JSON is hunting through closed bins in an attic: the labels are
inside the lid, and the way out is a run of identical unlabeled braces. HTML
labels the outside of every container and closes each one by name — legible
to the humans who maintain it, and the natural carrier for the whole-tree
"rewrite the markup" edit that benchmarks show matches a dozen granular
mutation calls on reliability at a fraction of the token cost.

## The four guarantees

1. **Id preservation.** Ids survive `parse` / `build` / `format` byte-for-byte.
   `format()` fills in *missing* ids and never touches an existing one —
   anything an agent or content system references stays referenceable.
2. **Round-trip identity.** `parse(build(tree))` deep-equals `normalize(tree)`:
   ids, names, types, attributes, order.
3. **Declared coercion only.** An attribute's type comes from its grammar
   declaration, never from the shape of its value. `"1.5"` stays a string
   unless you declared the attribute `number`. No opt-out lists, no surprises
   on the fifth round trip.
4. **Loud boundaries.** Invalid markup returns structured issues naming the
   node, attribute, and path — never a silently "repaired" tree. (Tree-side
   misuse from your own code throws; markup-side problems are data.)

All four are enforced by fast-check property tests over randomly generated
grammars-valid trees, and `@kevinpeckham/barkup/testing` ships the same helpers so you can
prove them over **your** grammar.

## Benchmarked

We benchmarked the pattern instead of asserting it:
[barkup-bench](https://github.com/kevinpeckham/barkup-bench) is a
pre-registered benchmark — HTML vs an equal-strictness JSON twin ×
whole-tree rewrite vs granular mutation tools vs two patch dialects —
run across four models from three vendors (9,600 scored runs, seeds and
prompts committed before the first scored call, with one published
protocol correction). It publishes what it found:

- **Every id-stable interface works.** Under corrected conversation
  history, whole-tree rewrite, granular mutation tools, and
  id-anchored patches land within a few points of one another (A vs
  C: 91.9% vs 93.9%). The gaps originally reported here were traced
  to an SDK defect that hid the model's own tool calls from
  multi-turn history — worth knowing about in its own right: it
  silently collapses small-model tool reliability (as low as 5%)
  while frontier models mask it.
- **Id-anchored patches match rewrite at the lowest cost.** A
  pre-registered follow-up condition — patch operations addressing
  nodes by id, placements anchored to sibling ids, no positional
  indexes — tied whole-tree rewrite on success (92.6% vs 91.9%),
  fully recovered RFC 6902's large-tree collapse (85.1% vs 69.6% at
  ~150 nodes, p < 0.0001), and was the cheapest condition measured
  (13.2k tokens per solved ~150-node task). It depends on exactly one
  thing: stable node ids — guarantee #1 above.
- **And they scale.** A pre-registered follow-up at 300–1000 nodes
  found the size crossover: whole-tree rewrite becomes
  frontier-model-only above a few hundred nodes (and needs a
  streaming transport to complete at all), while anchored patches
  hold 87–100% for both model tiers at every size — at ~$0.26 and
  4 seconds per solved 1000-node edit versus $0.88 and 10 minutes for
  a full rewrite.
- **Views: show the model only what the edit concerns — input stops
  scaling with the tree.** Two pre-registered follow-ups (Studies I
  and J) replaced the full prompt tree with a **focused view** — the
  root-to-target spine rendered fully, everything else collapsed to
  id-bearing placeholders or omitted with an honest count — while
  patches still applied to the full tree. Accuracy was statistically
  unchanged in every paired comparison (McNemar p = 0.5–1.0; sonnet
  went 45/45 on the minimal view; claude-opus-4.8 later swept both
  HTML modes 90/90 at every size, Study AD), and median input per
  ~1000-node task fell from ~86k tokens to ~1.4k (−98%). View size scales with
  tree **depth**, not node count, which effectively removes the
  context-window ceiling for id-addressed edits. HTML is the native
  rendering: identical accuracy to JSON views (p = 1.0 in all four
  paired comparisons), fewer input tokens (−9% to −24% at ~1000
  nodes), and better first-pass patch validity (84–85/90 vs
  80–81/90).
- **Finding the ids is one search call, not a full-tree read.** When
  the edit request is a human description with no ids in it, a
  pre-registered follow-up (Study N) gave models a skeleton view plus
  one deterministic keyword-search tool (`find_nodes`, shipped here
  as `findNodes`/`renderSearch`): id-free requests grounded at 43/45
  on sonnet-4.5 (equal to its id-oracle bound), 43/45 on
  claude-opus-4.8 (Study AD — the same bound), and 39/45 on
  gemini-3.5-flash (vs 23/45 for expand-node navigation, p < 0.001),
  with a median of ONE search call at ~90% less input than reading
  the whole tree. Upgrading the scorer to text embeddings measured no
  better.
- **The HTML dialect is accuracy-neutral.** Against a JSON twin with
  identical validator strictness and error quality, HTML and JSON
  rewrite tied on validity (≥99%), editing success, and reading
  accuracy. Format fluency is no longer a moat — modern models write
  both formats near-perfectly.
- **HTML is the cheaper serialization at scale**: ~30% fewer tokens
  per solved large-tree task than JSON rewrite, and rewrite overall
  used 4–5× fewer tokens than tools on small/medium trees.

Why HTML, then, if accuracy ties? Because the tie is the point: the
format costs nothing on the budgets the benchmark measures, wins the
token budget as trees grow, and keeps the one advantage no benchmark
scores — the same artifact is readable by the designer in a diff, the
reviewer in a PR, and the model in a prompt. barkup's guarantees (id
preservation, round-trip identity, structured issues built for
correction loops) are what make whole-tree rewrite and id-anchored
patches safe to operate in production — and both are single-artifact
interfaces, structurally immune to the history-construction failure
class that tools pipelines must guard against.

## Quick start

```ts
import { defineGrammar } from "@kevinpeckham/barkup";

const grammar = defineGrammar({
  nodes: {
    block: {
      children: ["block", "text-atom"],
      attributes: {
        containerClasses: { type: "string" },
        featured: { type: "boolean" },
      },
    },
    "text-atom": {
      attributes: {
        textStyle: { type: "string" },
        maxLength: { type: "number", required: true },
      },
    },
  },
  roots: ["block"],
});

// typed tree → markup
const markup = grammar.build({
  type: "block",
  name: "feature-callout",
  id: "wgt-root",
  children: [
    {
      type: "text-atom",
      name: "heading",
      attributes: { textStyle: "heading-2", maxLength: 60 },
    },
  ],
});

// markup → typed tree (or structured issues — never a repaired tree)
const result = grammar.parse(markup);
if (result.ok) {
  result.node; // { type: "block", name: "feature-callout", id: "wgt-root", ... }
} else {
  result.issues; // [{ code, message, path, nodeId?, attribute? }]
}

// pretty-print + fill ONLY missing ids
const formatted = grammar.format(markup);

// grammar checks for trees your code builds
grammar.validate(tree);
```

### The dialect

- Every node is an element; `data-type` names the node kind.
- `data-name` is a stable human label; `id` is a stable identifier.
- Declared attributes are camelCase in the tree and `data-kebab-case` in
  markup (`maxLength` ↔ `data-max-length`).
- Only `id` and `data-*` attributes are part of the dialect; anything else
  is reported as an issue.
- Text content is not part of the dialect — text lives in declared
  attributes, where its type is known.

## Server-side usage (Node, Bun)

barkup's core has **zero runtime dependencies** and uses the platform
`DOMParser` in browsers. Runtimes without one pass an adapter — any
standards-shaped DOMParser works; [linkedom](https://github.com/WebReflection/linkedom)
is the lightest:

```ts
import { DOMParser } from "linkedom";
import { defineGrammar, domParserAdapter } from "@kevinpeckham/barkup";

const adapter = domParserAdapter(new DOMParser());
const grammar = defineGrammar(config, { adapter });
```

## Testing your grammar

With [fast-check](https://fast-check.dev) installed (optional peer
dependency):

```ts
import fc from "fast-check";
import { treeArbitrary, assertRoundTrip } from "@kevinpeckham/barkup/testing";

test("my grammar round-trips", () => {
  fc.assert(
    fc.property(treeArbitrary(grammar.config), (tree) => {
      assertRoundTrip(grammar, tree, adapter);
    }),
  );
});
```

`treeArbitrary` generates random grammar-valid trees (allowed roots and
children, type-correct attribute values, a mix of present and missing ids);
`assertRoundTrip` throws with a readable diff if identity ever breaks.

## Using it with an agent

The pattern from the article, in short: give the model **one blunt tool** —
"replace the entire markup" — plus one surgical escape hatch for attribute
tweaks. Validate at the boundary with `parse()`; if it returns issues, hand
them back to the model verbatim (they name the node and path). Route the
accepted tree through the same pipeline as human edits. The model already
speaks HTML; your prompt budget goes to your *semantics*, not your syntax.

## Anchored patches

Whole-tree rewrite is the simplest robust interface, but its output cost
grows with the tree. `@kevinpeckham/barkup/patch` ships the other
strategy [barkup-bench](https://github.com/kevinpeckham/barkup-bench)
validated: a patch dialect whose operations address nodes **by id** —
`before`/`after` sibling anchors or `parentId` append, never a
positional index — applied atomically and validated by your grammar.
In the benchmark it tied whole-tree rewrite on task success (92.6% vs
91.9%), was the cheapest condition at every tree size measured, and
fully recovered RFC 6902's large-tree collapse (85.1% vs 69.6% at ~150
nodes). Its one precondition is stable node ids — guarantee #1.

```ts
import { applyAnchoredPatch } from "@kevinpeckham/barkup/patch";

// 1. Serialize current state — format() fills any missing ids first,
//    so every node the model sees is addressable.
const current = grammar.build(storedTree);

// 2. The model replies with a JSON array of operations addressing
//    nodes by id: set-attribute, remove-attribute, set-name, remove,
//    insert (with a fresh id), move.

// 3. Apply atomically; grammar validation is built in.
const result = applyAnchoredPatch(grammar, storedTree, JSON.parse(reply));
if (!result.ok) return retryWithFeedback(result.issues); // verbatim
persist(result.node);
```

The input tree is never mutated. The first failing operation rejects
the whole patch, and the issue names the operation index; the patched
tree must pass `validate()` before it is returned — a partial or
invalid tree never escapes. Reach for patches when token cost or
latency matters; keep whole-tree rewrite when simplicity does.

The shipped implementation was verified behaviorally identical to the
benchmark-validated reference (see "Verification" in
[docs/anchored-patches.md](docs/anchored-patches.md)), and porters can
prove conformance by replaying the vendored 40-vector suite at
`tests/fixtures/patch-vectors.json`.

## Focused views

Anchored patches make the model's *output* cost independent of tree
size; `@kevinpeckham/barkup/view` does the same for the *input*. A
focused view renders only the part of the tree an edit concerns: the
root-to-focus spine fully, children of focus nodes always in document
order (so "as the 3rd child" stays resolvable — at minimum as
placeholders carrying `data-collapsed="true"` and an honest
`data-child-count`), and everything else omitted with
`data-omitted-children="N"` (the default "minimal" mode) or shown as
placeholders ("focused" mode). Every visible id is a real id in the
tree — **visible implies patchable** — and unknown focus ids come
back as structured issues, never silently ignored.

In the benchmark ([Studies I and J](https://github.com/kevinpeckham/barkup-bench)),
views left accuracy statistically unchanged while cutting median
input per ~1000-node task from ~86k tokens to ~1.4k (−98%); the
minimal view's input scales with tree depth, not node count.

```ts
import { applyAnchoredPatch } from "@kevinpeckham/barkup/patch";
import { renderView, VIEW_PROMPT_RULES } from "@kevinpeckham/barkup/view";

// 0. Append VIEW_PROMPT_RULES (the benchmark-validated five-bullet
//    prompt block) to the agent's system prompt.

// 1. Render only what the edit concerns.
const view = renderView(grammar, storedTree, { focus: ["n819"] });
if (!view.ok) return retryWithFeedback(view.issues); // e.g. stale ids

// 2. Show view.html; ask for an anchored patch.

// 3. Apply against the FULL tree — every hidden node still exists.
const result = applyAnchoredPatch(grammar, storedTree, JSON.parse(reply));
if (!result.ok) return retryWithFeedback(result.issues);
persist(result.node);
```

A view is a prompt artifact, not a round-trip input (placeholders
omit required attributes, so views are deliberately not `parse()`
input). The dialect reserves three attribute names — `collapsed`,
`childCount`, `omittedChildren` — and `renderView` returns a
structured issue if your grammar declares any of them. Expanded
regions are byte-identical to `build()` output, and the shipped
renderer replays the benchmark's 39-vector conformance suite
(`tests/fixtures/view-vectors.json`) byte-for-byte; see
[docs/focused-views.md](docs/focused-views.md) for the full contract
and evidence.

### Finding the focus ids

Where do the focus ids come from? Three tiers, each benchmark-measured
([Study N addendum, barkup-bench REPORT.md](https://github.com/kevinpeckham/barkup-bench)):

1. **Your application knows the ids** (a UI selection, a database row,
   a previous turn — or a programmatic query: `selectNodes(tree,
   { type, name, attributes, within })` enumerates the matching ids
   exactly, in document order) — render the view directly. That is the
   oracle case Studies I/J measured: retrieval is free.
2. **You have only a human description** ("make the hero shorter") —
   show the model a skeleton view (the root with children collapsed:
   `renderView(grammar, tree, { focus: [rootId] })`), give it a
   `find_nodes` tool backed by `renderSearch`, and append
   `SEARCH_PROMPT_RULES` to the system prompt. One call is the median.
   In Study N this grounded id-free requests at 43/45 (sonnet-4.5,
   equal to its id-oracle bound) and 39/45 (gemini-3.5-flash, vs 23/45
   for expand-node navigation, p < 0.001) at ~90% less input than a
   full-tree read. Deterministic keyword overlap is enough — swapping
   the scorer for `text-embedding-3-small` measured no better (target
   coverage 23/45 vs 24/45).
3. **A frontier patcher under budget pressure** — ground with a cheap
   model on the full tree first (ask it only for the target ids), then
   patch against the minimal view of those ids. Study N's cross cell
   (gemini grounds, sonnet patches) held 41/45 with 97% less
   frontier-model input (median 1,484 tokens).

One rule binds all three tiers, and it is a correctness contract, not
an optimization (Study U): **focus ids must cover every node the
request mentions, not just the edit target.** A dependent edit ("set
A's content to the same value as B's") against a view showing only A
does not error — both models tested produced a valid patch with a
**silently invented value** on all 90 such cells (zero refusals, zero
invalid artifacts). Adding the mentioned source node to the focus ids
fixed all 90 at ~1.7k tokens median, which also *beat* the whole-tree
prompt (45/45 vs 42/45 on sonnet at ~1000 nodes) at 25× less input.
The `find_nodes` tool can self-serve such reads at 82–84% — a real
capability, but short of parity, so let the model search for *where*
to edit and let your application put *what it must read* in the view.

The silence itself turned out to be a protocol defect, not a model
property (Study AC): offered an explicit escape hatch — one
registered sentence ("if the request requires a value or a node that
is not visible in the view and not stated in the request, do NOT
guess: reply NEED-INFO: …"), or equivalently an `ask_user` tool —
every model asked on every provably-unsolvable cell (270/270 vs
0/270 without the hatch) and never once asked on a solvable twin,
naming the exact missing node each time. The models always saw the
gap; nothing had told them asking was allowed. Ship the hatch as the
seatbelt alongside the focus-ids contract: the contract makes the
question unnecessary, the hatch makes the remaining failures visible
instead of silent. Calibration is now measured across a five-level
ambiguity ladder (Study AE): the hatch costs NOTHING on clear
requests (zero false asks in 90 cells, including indirect references
the model resolves itself, and no interviews about discretionary
wording), and the full ask → answer → patch loop closes at ceiling —
135/135 resumed solves from a plain-text answer, zero re-asks, zero
wrong integrations. The measured boundary that remains: **referent
ambiguity is tier-dependent.** When a singular request matches two
visible nodes, claude-opus-4.8 asks 15/15 (naming both candidate
ids); sonnet-4.5 silently edits BOTH matches and gemini-3.5-flash
silently picks one, each asking just 1/15 — the registered sentence
is scoped to information that is "not visible," and an ambiguous
referent is entirely visible. Below the frontier tier, app-side
disambiguation (unique references, `selectNodes` enumeration,
selection grounding) remains the only defense. The obvious
amendment — one added sentence covering requests that match more
than one node — has now been measured (Study AI): it rescues
sonnet completely (3/15 → 15/15, every ask naming both ids), moves
gemini from 0 to 11/15 but leaves a silent edit-both residue, taxes
clear requests nothing anywhere, and on the frontier tier adds
nothing (already 15/15) while directionally increasing
interrogation of discretionary "make it punchier" requests. So the
clause is a real improvement for sub-frontier deployments and NOT
worth shipping on frontier ones — and either way it is a mitigation,
not a guarantee: app-side disambiguation stays the contract.

The hatch's last border is measured too (Study AG): pointed at the
discourse construction ("undo that" with no carrier, previously
0/144 silent guesses), the shipped sentence fires on EVERY tier —
138/144 asks that genuinely name the dangling antecedent — because
a missing referent is squarely inside the sentence's letter. But
the same study found the sentence's visibility clause biting where
it should not: under skeleton views, models receiving a complete
last-edit echo (id, key, both values) still asked ~70% of the time,
citing only that the target node "is not visible in the view" —
despite anchored patches needing only the id. So the hatch's
zero-tax guarantee is CONDITIONAL on the focus-ids contract: views
that cover every node a request mentions produce zero false asks
(measured three times now); skeleton or outline protocols need
either target-carrying views, a self-serve view tool, or a
re-scoped hatch variant measured before shipping.

```ts
import {
  findNodes,
  renderSearch,
  NO_MATCHES_MESSAGE,
  SEARCH_PROMPT_RULES,
} from "@kevinpeckham/barkup/view";

// Tier 2's find_nodes tool, in any tool-use framework:
function findNodesTool(query: string): string {
  const result = renderSearch(grammar, storedTree, query); // top 5, minimal view
  if (result === null) return NO_MATCHES_MESSAGE; // the exact benched miss text
  if (!result.ok) throw new Error("unrenderable grammar"); // app bug, not model error
  return result.html; // matches shown in place, ancestors visible
}
```

`renderSearch(grammar, tree, query)` is exactly
`renderView(grammar, tree, { focus: findNodes(tree, query), mode: "minimal" })`
— `findNodes` is the deliberately simple scorer the benchmark handed
to models (distinct-token overlap over type, name, and attributes;
zero scores excluded; ties in document order; top 5 by default), and a
miss returns `null` so your tool layer can send back the structured
no-match text the study scored. Usual caveats: two models, a generated
corpus, trees of ~300–1000 nodes.

**Boundary: this recipe is single-target — fan-out requests get
decomposed instead.** A pre-registered stress test
([Study Q addendum, barkup-bench REPORT.md](https://github.com/kevinpeckham/barkup-bench))
pointed the recipe at fan-out instructions — "set X on every
text-atom inside the block named Y", 2–32 targets — and it fails
there: median 6 `find_nodes` calls instead of 1, a third of runs
above 100k input tokens (max 2.4M), and −24 pp accuracy vs a
whole-tree prompt on gemini. Retrieval is not the bottleneck: even
with every target handed to the model in the view, every model
tested left fan-out patches partially complete (62–69% success
overall, ~45% at 7+ targets; failures are partial coverage) — and
the models invert on mitigation (sonnet does better on views, gemini
on the full tree), so there is no model-independent fan-out prompt
strategy either. The frontier tier raises the floor without ending
the story: claude-opus-4.8 (Study AD) reached 80% on views and 89%
on the full tree — a third distinct mitigation profile — and still
left one in three 7+-target view tasks incomplete, the same
partial-coverage anatomy.

The fix is measured, not inferred
([Study R addendum](https://github.com/kevinpeckham/barkup-bench)):
**decompose in the application.** Enumerate the target set
deterministically with `selectNodes` — exact, ANDed object queries,
ids back in document order — and issue one single-target anchored
edit per node against a focused view of that node:

```ts
import { selectNodes } from "@kevinpeckham/barkup/view";

const targets = selectNodes(tree, { type: "text-atom", within: sectionId });
for (const id of targets) {
  // one single-target anchored edit per node, focused view of that node
}
```

Study R ran exactly this pipeline on the fan-out tasks that broke
every prompt-side approach: **90/90 tasks on both models tested,
674/674 subtasks, zero failures** — every 7–32-target task included —
at about a third of the input cost of showing the whole tree once
(median ~8k input tokens per task vs ~40–48k for any full-tree arm).
Per-edit reliability was 100% at n = 674, so compounding never bit;
the prompt-side alternatives (a worked example, a checklist, the full
tree, the search recipe) all left partial coverage. One prompt asked
for N edits still delivers roughly half of N on current models — so
ask N times, cheaply. Caveats as ever: two models, a generated
corpus, set-attribute/remove subtasks.

## Sessions: a fresh view every turn

Focused views change how you serialize a single edit; **sessions** are how
you serialize a *conversation* of edits over one tree. The rule is short:
for multi-edit conversations, attach a fresh minimal focused view
(`renderView` with `mode: "minimal"`, targeted at the current edit) to
**every** patch turn. Do not serialize the tree once at session start, and
do not re-send the whole tree each turn.

```ts
import { applyAnchoredPatch } from "@kevinpeckham/barkup/patch";
import { renderView } from "@kevinpeckham/barkup/view";

for (const edit of session) {
  // Render a fresh view of the CURRENT tree for THIS turn's target.
  const view = renderView(grammar, tree, { focus: edit.focusIds });
  if (!view.ok) return retryWithFeedback(view.issues);

  // Show view.html; ask for an anchored patch; apply to the full tree.
  const result = applyAnchoredPatch(grammar, tree, JSON.parse(reply));
  if (!result.ok) return retryWithFeedback(result.issues);
  tree = result.node;
}
```

The counter-intuitive part is that showing the tree once saves nothing: a
once-shown tree rides along in the conversation history every subsequent
turn, so "serialize-once" pays the full tree's tokens on every step
anyway — while going stale. In benchmark sessions of 12 sequential edits
([barkup-bench](https://github.com/kevinpeckham/barkup-bench), Study K),
per-turn fresh minimal views were the most accurate policy at every model
tier tested **and** the cheapest by 4–15×: ~55k input tokens per session,
versus ~215k for serialize-once, ~366k for periodic full refresh, and
~836–971k for whole-tree rewrite.

Serialize-once also drifts. On claude-sonnet-4.5, per-step success fell
from 98.8% to 83.8% by steps 9–12, and only 8/20 sessions ended with an
intact tree — versus 19/20 for per-turn views (19/20 on both models
tested). The failure mechanism is **stale ordinal placement**: insert and
move ops get anchored against an outdated picture of sibling order (they
fall 95% → 85% → 80% across the session under serialize-once, while
per-turn views hold ~98%). A fresh view keeps that picture current.

What about the conversation history? Two options, both
benchmark-validated — and both since measured through 36-edit
sessions (Study S), three times the original horizon, where the
choice turns out to be purely about cost:

- **Keep the full history** alongside the per-turn views (Studies K,
  M, and O). Two pre-registered follow-ups tried simply dropping it —
  a stateless fresh view each turn, then the same with every child
  annotated with its true position — and both fell short of
  history-plus-fresh-view on session integrity, failing on late
  ordinal placements. (Position annotations are optional and
  harmless — they cost ~9% extra view tokens and rescue nothing.)
  Keep-history stays essentially perfect through 36 edits (Study S:
  719/720 steps across both models) with no context ceiling in
  sight — but its per-step input grows linearly with session length,
  reaching ~24k tokens by step 36.
- **Or go fully stateless**: per-turn views plus a small
  worked-examples block in the system prompt, no history at all
  (Study P; pre-registered gate passed on both models tested, in
  both delivery framings — the system-prompt framing suffices). What
  history was contributing turns out to be **teaching, not memory**:
  two canned worked examples — an ordinal insert and an ordinal move
  on a fixed tree the model never edits, ~900 tokens total — restore
  stateless sessions to full-history accuracy, flat in session
  length, and structurally immune to history-construction bugs. The
  horizon is measured, not assumed: at 36 edits the recipe shows no
  late-session decay (Study S: last-third accuracy 98–99%, gate
  passed on both models — step 36 is taught as well as step 1), and
  the cost gap widens with length: flat ~2.1k input tokens per step
  versus keep-history's linear growth, 5–6× less input per 36-edit
  session (~81k vs ~449k). For long sessions, this is the measured
  default. At the frontier tier the examples turn out to be
  insurance rather than a requirement: on claude-opus-4.8 (Study
  AD) keep-history, stateless-plus-examples, AND bare stateless all
  scored 240/240 steps with 20/20 intact end-states — opus needs no
  precedent for ordinal ops at this horizon, so the block's ~900
  tokens are load-bearing only below the frontier (sonnet without
  them: 13/20 end-states). Keep shipping the block; it costs almost
  nothing and covers every tier.

One boundary, now measured (Study T): the recipes above cover
**self-contained** requests — instruction plus current tree carry
everything needed. Requests that reference earlier conversation
("rename it to the codename we settled on", "apply the standing rule
from before") fail a stateless editor **by construction**: Study T
built sessions with exactly such callback steps and the stateless
recipe failed all 160 of them across both models while scoring
160/160 on the ordinary steps of the same sessions. The fix is **a
memo, not a transcript**: have your application record each declared
fact or standing rule as it arrives and append the running list to
every step:

```
Session notes (maintained by the application):
- The campaign codename is "vesper-7".
- Standing rule: every new text atom gets textStyle "small-caps".
```

That block restored 80/80 callback steps on both models, tied full
history on every paired comparison, beat it on end-state integrity
(19–20/20 vs 17–19/20), and cost 1.02× the stateless baseline —
keep-history costs 2.1× either. Capturing the notes can be the
AGENT'S job: Study W tested delegated extraction (an
update_session_notes tool with full-replace semantics plus a prompt
rule, the configuration Replicator ships) and it tied the oracle on
all three models tested — recall 36/36 per model, retractions
handled 12/12, zero noise notes, and no recording laziness even when
a history window made the memo redundant. The format above is the
exact registered block the benchmark scored.

The extraction rule also survives contact with human speech (Study
Y): declarations phrased the way people actually talk — buried
mid-sentence, "scratch that" retractions, house-style asides —
extract at exact parity with formulaic announcements on all three
models tested (zero discordant callback cells), and 432
conversational chatter baits produced not one false memo note. No
announcement syntax is required of your users.

The memo is also measured at scale (Study AH): against a FULL
20-note memo — the shipped cap — recall of any note is perfect at
every position (no burial: first, middle, and last notes all 15/15
per model), unprompted rule application from a 12-rule memo is
perfect with zero cross-note contamination, and the agent's
full-replace update is lossless wherever the update fits (60/60
clean at 10 and 19 notes). The one hazard is the CAP EDGE itself:
when a 21st declaration arrives at a full memo, a note dies every
time — and in 30 of 30 measured cells, on all three models, the
victim was a GOAL note, because the block renders facts → rules →
goals and both the silent clamp and the models' own pruning eat
the tail. Goals are the one thing only the memo carries (Study V),
so the fix is app-side and specific: never silently clamp an
over-cap update — evict the oldest FACT deterministically (never
the goals tail), or surface memo-full to the user. That fix is now
MEASURED, not just designed (Study AK, 2026-07-17): with the
v3.213.0 eviction pipeline in the update path, every over-cap send
became a designed eviction (19/19 — oldest fact out, every goal
kept, zero contract violations), K=20 goal survival went 0/10 →
10/10 on opus (p=.002) and 0 → 6/10 on sonnet (p=.031), and the
pipeline is a verified no-op wherever the update fits (60/60). The
honest boundary: eviction cannot restore a note the model pruned
client-side before sending — sonnet pruned 4/10 and gemini 6/10 at
the cap edge, victims still goals — so below the frontier tier the
guarantee covers the clamp pathway, not the model's own editing.
One frontier grace note: told the memo was full via the eviction
notice, opus once consolidated 21 notes' content into 11 notes,
losing nothing. Below the edge, note-count is a safe, monitorable
budget.

Discourse gets the same treatment (Study X): follow-ups that point at
the previous edit — "also set that same node's...", "apply the same
change to X", "actually, undo that" — fail a carrier-less editor
0/144 across three models, every failure a valid silently-guessed
patch. The measured carrier is a one-line **last-edit echo** the
application appends automatically (`Previous edit (applied by the
app): set "{key}" from {old} to {new} on {nodeRef}.`): it ties full
history per model at about half the cost and beat history outright
on opus-4.8 (48/48 vs 46/48), with the from/to form carrying "undo"
completely. Fine print: "apply the same change to X" strains
compressed carriers on some models (sonnet 7/12 with the note) —
carrier advice is not model-independent; re-test on your tier. The
full stateless session stack, each clause measured: fresh view per
turn + two worked examples + the session-notes memo + the last-edit
echo.

The memo also carries **qualitative goals**, and it is the right
place for them (Study V, the benchmark's judge-graded track): asked
to "rewrite this paragraph to focus on our central thesis," a model
with the thesis in its memo ties one told the thesis outright — while
a model that merely has the thesis-bearing node *in its view* reads
it but writes measurably less focused prose (it lost 117/120 judged
comparisons). The division of labor that fell out of Studies U and V:
**views carry values, memos carry goals.** Put the nodes an edit must
read in the focus ids; put the intent it must satisfy in the
instruction or the memo, restated outright. And that division is now
a measured mechanism, not a heuristic (Study AF, judge-graded):
forcing the model to restate a view-read goal in its own words
before rewriting does NOT rescue it — compliance was perfect in
every cell and the restate arm still lost every decisive comparison,
90 for 0. The models repeat the goal and then orbit it anyway. Where
a goal comes from matters more than whether the model says it aloud,
so no prompt ceremony substitutes for putting the goal where it
belongs. (The same study measured the memo-plus-restate clause at
parity under the primary judge with a sensitivity-judge dissent
toward mild harm — a restate instruction adds nothing measurable
even where the memo already carries the goal.)

Standing context — a brand pack (company, clients, styleguide)
shipped in the system prompt with every request — simply works at
production sizes (Study Z): with ~3.3k-token packs, exact client
facts were copied correctly past three same-schema distractor
clients and styleguide rules were applied unprompted in 216/216
fact-and-rule cells per arm across three models, with **zero
cross-client contamination in 324 cells** and no burial effect (head,
middle, and tail styleguide positions all perfect). Slicing the pack
down to the relevant client bought nothing on accuracy and forfeited
prompt caching — a static block only caches if it is actually static
across requests, and the full pack under Anthropic's cached-system
layout cut effective input cost by 25–43%. The one hazard measured is
**spec conflict**: when a styleguide rule ("contact lines always
follow the form X") collided with an instruction clause, every model
resolved it cleanly one way or the other — never violating either.
Study AA then measured the conflict on purpose (three conflict kinds,
four interventions, 432 cells), and corrected our own first reading
of Z: which reading a model picks is NOT a capability gradient (the
confirmation study inverted the Z ordering — opus took zero literal
readings where sonnet took ten) and is composition-sensitive, so test
the tier you ship on the pack you ship. What the interventions
measured: a priority meta-rule ("the user's request takes
precedence") moved nothing significantly; softening rule wording from
"always" to "we generally prefer" collapsed literal readings (sonnet
10/24 → 2/24, gemini 7/24 → 0/24) — the cheapest fix that works; and
restating rules in the session-notes memo steers interpretation
powerfully in BOTH directions: it resolves rule-vs-instruction
tension (sonnet 2/12 → 11/12 satisfying both, replicated exactly),
but on requests that explicitly countermand a rule ("written plain,
with no trademark symbol") the memo caused the rule to be enforced
against the user's explicit ask (opus 12/12, sonnet 9/12; without the
memo, all 36/36 base cells honored the countermand). Guidance: audit
standing rules for "always"/"exactly" and phrase them as preferences;
don't trust styleguide meta-rules to arbitrate. The memo footgun is
closed, measured (Study AB): one precedence sentence INSIDE the memo
block itself ("a direct, explicit instruction in the current request
overrides any note here for that request") restored every trampled
countermand (opus 0/12 → 12/12, sonnet 3/12 → 11/12) at zero cost to
the memo's steering benefit — where the same sentence class buried in
a styleguide had moved nothing. If your memo block restates rules,
carry that clause in the block header; placement at the point of
injury is what makes it work.

To write the examples block for **your** grammar: one example per
tricky operation class — insert by ordinal, move by ordinal — each a
focused view plus an edit request plus the correct anchored patch,
drawn from a small fixed tree unrelated to any real document, with
the patches verified against your own `applyAnchoredPatch` in a unit
test. The benchmark's committed block is the pattern to copy:
`EXAMPLE_TREE`, `WORKED_EXAMPLES`, and `WORKED_EXAMPLES_BLOCK` in
barkup-bench `src/harness/examples.ts`, unit-tested in its
`tests/sessions-p.test.ts`. barkup deliberately ships no canned
block — the examples must speak your grammar, so this is a
documented pattern, not an API.

Whole-tree rewrite is not a session protocol. Its conversation grows
toward a hard context ceiling (200k exhausted deterministically at step 11
on sonnet), and below the frontier tier it silently corrupts trees that
still pass validation (gemini end-state intact 2/10; all 44 graded
failures were valid-but-wrong).

## When not to use this

- **Numeric-heavy or deeply cross-referenced trees** — HTML's stringly
  attributes will fight you.
- **Real-time multi-writer collaboration** — there are no merge
  semantics; concurrent edits are last-write-wins on every channel
  (rewrite and patch alike).

## Limitations

- Attribute values containing control characters (U+0000–U+001F, U+007F)
  cannot round-trip byte-for-byte through *any* spec-compliant HTML parser —
  this is an HTML limitation. Declare such payloads as `json` (escaped) if
  you need them.
- The dialect has no text nodes by design; text belongs in declared
  attributes.

## Used in production

barkup came out of a working system, and that system now runs on it: the
document platform described in the article compiles its template grammar
(the same config that drives its visual editor) into a barkup grammar, and
**every template edit its LLM agents author must pass barkup validation
before it is applied**. The structured issues — unknown types, invalid
containment, stray text, duplicate ids — go back to the model verbatim as
correction feedback. A note on why, now measured (Study AJ): with the
feedback message as the only variable across 405 seeded-failure cells,
models recovered at 93–100% whether they received the full structured
issues, bare codes, or just "the patch was invalid" — the same cells
failed regardless. So the verbatim habit is developer UX (humane logs,
debuggable corrections), not a model-accuracy requirement: keep it
because it costs nothing, not because the loop depends on it.

## Maintenance posture

barkup develops **research-first**, in two layers with different
promises.

The **core codec** — `defineGrammar` → `build` / `parse` / `format` /
`validate`, stable ids, the four guarantees — is scoped and stable.
It is intentionally small, it does not churn, and nothing gets added
to it.

Around that core, a **toolkit grows as
[the companion benchmark](https://github.com/kevinpeckham/barkup-bench)
identifies what agents editing typed trees actually need.** Every
utility exists because a pre-registered study measured both the
problem it solves and the solution it ships: anchored patches
(Studies F/H — tying whole-tree rewrite at the lowest cost, holding
87–100% where rewrite collapses at scale), focused views (Studies
I/J/K — accuracy unchanged while input stops scaling with the tree,
and the per-turn session protocol), content search (Studies L/N — a
skeleton view plus one deterministic search call grounding id-free
requests at oracle-level accuracy), and exact selection (Studies
Q/R — the fan-out boundary and the measured decomposition loop,
90/90 with zero subtask failures). Nothing is added speculatively;
nothing ships without benchmark numbers attached — and that
standard, not feature requests, is what changes the surface.

Semver keeps the two layers honest: toolkit additions arrive as
minor versions; the core surface does not churn. Bug reports and
guarantee violations are always welcome.

## License & credit

MIT © Kevin Peckham. Built at [Lightning Jar](https://www.lightningjar.com).
The design is described in
[HTML as a Native Data Format for LLMs](https://www.lightningjar.com/blog/ast-as-html);
the benchmark behind the numbers is
[barkup-bench](https://github.com/kevinpeckham/barkup-bench), with the
results write-up in
[We Benchmarked It](https://www.lightningjar.com/blog/barkup-bench-results).
