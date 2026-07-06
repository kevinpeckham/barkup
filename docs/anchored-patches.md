# Anchored patches — design note

Status: accepted design, pre-implementation. The semantics below are
ported from the benchmark-validated reference implementation
(barkup-bench `src/conditions/f.ts`, condition F) and are fixed; this
note records the API and issue-type design for review in isolation.

## Why this exists

barkup-bench's condition-F addendum (9,600 scored runs, four models)
measured a patch dialect whose operations address nodes exclusively by
id: it tied whole-tree rewrite on task success (92.6% vs 91.9%,
p = 0.53), was the cheapest condition at every tree size (13.2k tokens
per solved ~150-node task), and fully recovered RFC 6902's large-tree
collapse (85.1% vs 69.6% at ~150 nodes, p < 0.0001). Its one
precondition is stable node ids — barkup's guarantee #1 — which is why
the capability belongs in this package and not beside it.

This is an evidence-driven scope extension, not scope creep: one
validated capability, one new subpath entry, core codec untouched.

## Entry point

New subpath export `@kevinpeckham/barkup/patch` (like `/testing`).
Zero runtime dependencies; no DOM involvement — patches operate on
`BarkupNode` trees, before/after any markup crosses the boundary.

## API surface (complete)

```ts
import { applyAnchoredPatch } from "@kevinpeckham/barkup/patch";

function applyAnchoredPatch(
  grammar: Grammar,
  tree: BarkupNode,
  operations: unknown,
): PatchResult;
```

`operations` is typed `unknown`, not `AnchoredOperation[]`: a patch is
agent/user input, so shape problems are DATA (structured issues), not
type errors. Authors writing patches by hand can still type them —
the operation types are exported:

```ts
type AnchoredPlacement =
  | { before: string }   // insert/move as previous sibling of this id
  | { after: string }    // insert/move as next sibling of this id
  | { parentId: string } // append as last child of this id
// exactly one of the three; before/after derive the parent from the sibling

type AnchoredOperation =
  | { op: "set-attribute"; id: string; key: string; value: AttributeValue }
  | { op: "remove-attribute"; id: string; key: string }  // error if absent
  | { op: "set-name"; id: string; name: string }
  | { op: "remove"; id: string }                          // never the root
  | ({ op: "insert"; node: BarkupNode } & AnchoredPlacement)
  | ({ op: "move"; id: string } & AnchoredPlacement)      // never the root,
                                                          // never into own subtree

type PatchResult =
  | { ok: true; node: BarkupNode }
  | { ok: false; issues: PatchIssue[] };
```

No streaming, no diffing, no inverse patches. That is the whole
surface.

## Application semantics (fixed, ported from the reference)

1. The input tree is cloned; **the input is never mutated**.
2. Operations apply **in order** to the working copy. The first
   failing operation rejects the entire patch — atomicity — and the
   returned issue names the operation index.
3. Nodes are addressed by id only. A node without an id cannot be
   addressed (run `format()` first — it fills missing ids and never
   touches existing ones).
4. For `move`, the placement anchor resolves **after** the node is
   detached (so "after my current neighbor" means what it says).
5. After all operations apply, the result must pass the grammar's
   `validate()`; any grammar issue rejects the patch. A partial or
   invalid tree is never returned.
6. An `ok: true` result carries the patched tree in normalized form
   (same shape `parse()` returns). Untouched nodes keep their ids
   byte-for-byte.

## Issue-type design

Patches are agent/user input → markup-side error model: failures are
data, never throws. Two kinds of failure share one list:

```ts
type PatchIssueCode = IssueCode | "invalid-patch";

interface PatchIssue {
  code: PatchIssueCode;
  message: string;
  path: string;        // "(patch op 2)" for op-level issues
  opIndex?: number;    // present on op-level issues
  nodeId?: string;
  attribute?: string;
}
```

- **Op-level failures** (unknown op, stale id, ambiguous placement,
  root guard, own-subtree move…) get `code: "invalid-patch"`, a
  message prefixed `Operation ${i}: …` (reference wording), `path:
  "(patch op ${i})"`, and `opIndex`.
- **Grammar failures** found by post-apply validation are ordinary
  `GrammarIssue`s — structurally assignable to `PatchIssue` (their
  `opIndex` is simply absent).

Both kinds are written to be handed back to a model verbatim as
correction feedback, consistent with the rest of the library. The core
`IssueCode` union is untouched; `"invalid-patch"` exists only in the
patch entry's vocabulary.

## The agent-loop recipe (goes in the README)

```ts
// 1. Serialize current state; format() guarantees every node has an id.
const current = grammar.format(grammar.build(storedTree));

// 2. Ask the model for an anchored patch (a JSON array of operations
//    addressing nodes by id) instead of a whole-tree rewrite.

// 3. Apply atomically; validation is built in.
const result = applyAnchoredPatch(grammar, storedTree, JSON.parse(reply));
if (!result.ok) return retryWithFeedback(result.issues); // verbatim
persist(result.node);
```

## Test plan (quality bar)

Property tests over `treeArbitrary` (fast-check): (1) atomicity — a
patch with a failing op at any position leaves the input byte-identical
and returns `ok: false`; (2) equivalence — random single edits
expressed as anchored ops produce the same tree as direct programmatic
application; (3) id preservation — untouched nodes keep ids
byte-for-byte; (4) validity — every `ok: true` result passes
`validate()`. Plus example-based unit tests for every op and every
failure mode, ported from the reference suite.
