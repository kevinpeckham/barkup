# barkup — Architecture Brief

A file-by-file, function-by-function reference for the codebase, with worked
examples. Written for contributors and for the author six months from now.

## The one-paragraph model

barkup is a **codec** between two representations of the same tree:

```
        build()                    parse()
BarkupNode ────────▶ HTML markup ────────▶ BarkupNode
 (typed JSON —        (authoring            (typed JSON —
  the storage form)    dialect)              validated)
```

A **grammar** — declared once via `defineGrammar(config)` — is the contract
both directions honor: which node types exist, which children each allows,
and which attributes each carries *with declared types*. Everything else in
the library serves four guarantees: (1) ids survive every pass
byte-for-byte, (2) `parse(build(tree))` is identity, (3) attribute values
change type only as declared, never by inference, and (4) invalid markup
yields structured issues, never a silently repaired tree.

**The error-model split** (the most important design rule in the codebase):

| Side | Who wrote it | Failure mode |
|---|---|---|
| Markup side (`parse`, `format`) | humans, LLM agents | **data** — `{ ok: false, issues: GrammarIssue[] }` |
| Tree side (`build`, config) | your program | **throws** `BarkupError` |

Markup is user/agent input, so problems are structured results you can hand
back as correction feedback. Trees are built by your own code, so problems
there are programmer errors and fail fast.

## Module dependency graph

```
types.ts ◀── everything (types + BarkupError only; no logic)
internal.ts ◀── grammar, build, parse, validate  (casing, escaping, ids, paths)
adapter.ts  ◀── parse (via index), tests          (DOM seam; imports only types)
grammar.ts  ◀── build, parse, validate, index     (compiled-grammar lookups)
build.ts ─┐
parse.ts ─┼──▶ index.ts (defineGrammar assembles the public Grammar object)
validate.ts┘
testing.ts ──▶ index.ts + fast-check              (separate entry: barkup/testing)
patch.ts ──▶ index.ts (Grammar type, normalizeNode) (separate entry: barkup/patch)
view.ts ──▶ index.ts (defineGrammar, Grammar) + internal (pathSegment)
                                                  (separate entry: barkup/view)
```

No module imports anything at runtime outside this list — zero runtime
dependencies is enforced by fallow rules (`fallow-rules.json`).

---

## src/types.ts — the public vocabulary

Pure types plus one class; no logic. Everything here is re-exported from
`index.ts`.

- **`JsonValue`** — recursive JSON-serializable value; the value space of
  attributes declared `type: "json"`.
- **`AttributeType`** — `"string" | "number" | "boolean" | "json"`. The
  complete set of declared types; there is deliberately no `"date"`, no
  `"enum"`, no inference.
- **`AttributeValue`** — union of the four value spaces.
- **`AttributeSpec`** — `{ type, required? }`. `required` is enforced by
  both `parse()` and `validate()`.
- **`NodeSpec`** — per-type declaration: `label?` (human-facing only, never
  serialized), `tag?` (HTML tag used when serializing; default `"div"`),
  `children?` (allowed child types; omit/`[]` = leaf; `["*"]` = any declared
  type), `attributes?` (camelCase key → `AttributeSpec`).
- **`GrammarConfig`** — `{ nodes, roots?, unknownAttributes?, generateId? }`.
  `roots` defaults to *every* declared type; `unknownAttributes` is
  `"error"` (default) or `"string"` (keep undeclared `data-*` attrs as
  strings); `generateId` is used **only** by `format()` for missing ids.
- **`BarkupNode`** — the tree node: `{ type, name?, id?, attributes?,
  children? }`. `name` serializes to `data-name`, `id` to native `id`.
- **`IssueCode`** — closed set of ten codes: `parse-failed`, `invalid-root`,
  `unexpected-text`, `unknown-type`, `invalid-child`, `unknown-attribute`,
  `reserved-attribute`, `invalid-attribute-value`, `missing-attribute`,
  `duplicate-id`.
- **`GrammarIssue`** — `{ code, message, path, nodeId?, attribute? }`.
  `path` is human-readable from the root, e.g.
  `block(intro) > text-atom(headline)` — designed to be pasted verbatim
  into an LLM's correction prompt.
- **`ParseResult` / `FormatResult` / `ValidationResult`** — discriminated
  unions on `ok`.
- **`class BarkupError extends Error`** — thrown for tree-side/programmer
  errors only. If you catch one, the bug is in your code, not your input.

## src/internal.ts — shared primitives (not exported from the package)

- **`ATTRIBUTE_KEY_RE`** = `/^[a-z][a-zA-Z0-9]*$/` — the shape a declared
  attribute key must have. This is not style pedantry: it is exactly the
  set of keys for which `camelToKebab` → `kebabToCamel` is a perfect
  inverse, which is what makes attribute names round-trip losslessly.
- **`TAG_RE`** = `/^[a-z][a-z0-9-]*$/` — valid serialized tag names.
- **`RESERVED_KEYS`** = `{"type", "name", "id"}` — element-level concepts
  that may not be declared as attributes (they'd collide with `data-type`
  / `data-name` / `id`).
- **`camelToKebab(key)`** — `maxLength` → `max-length` (uppercase → `-` +
  lowercase).
- **`kebabToCamel(name)`** — the inverse; used for the `"string"` policy's
  best-effort key recovery on undeclared attributes.
- **`escapeAttribute(value)`** — escapes `&`, `<`, `>`, `"` for a
  double-quoted HTML attribute. The DOM parser unescapes on the way back
  in, which is why arbitrary strings round-trip.
- **`defaultGenerateId()`** — 12-char base36 random. Only ever called for
  *missing* ids.
- **`pathSegment(type, name?)`** — `text-atom(headline)` or `text-atom` —
  the building block of every issue path.

## src/adapter.ts — the DOM seam

barkup never imports a DOM library. Parsing HTML requires one, so this file
defines a minimal structural boundary and two ways to satisfy it.

- **`RawElement` / `RawText` / `RawNode`** — the adapter's output: an
  untyped, pre-grammar tree. `RawElement` is `{ kind: "element", tag
  (lowercase), attributes: [name, value][] (document order), children }`.
  Deliberately decoupled from any DOM object model so alternate adapters
  (or a future hand-rolled parser) can slot in.
- **`DomAdapter`** — `{ parse(markup): RawNode[] }`. The only thing
  `parse()` needs.
- **`DomParserLike`** — the *structural* subset of the standard `DOMParser`
  barkup needs: `parseFromString(markup, mimeType)` returning something
  with a `body` that has `childNodes`. Both the browser's `DOMParser` and
  linkedom's satisfy it without casts on their side.
- **`convertDomNode(node)`** *(internal)* — walks a DOM node into
  `RawNode`s. Text nodes (nodeType 3) become `RawText`; elements
  (nodeType 1) collect `getAttributeNames()` in order; everything else
  (comments, doctypes) is dropped — they are not part of the dialect.
- **`domParserAdapter(parser)`** — wraps any `DomParserLike`. It parses
  `<html><body>${markup}</body></html>` as `text/html` and converts
  `body.childNodes`. Wrapping in an explicit body keeps fragment parsing
  predictable across implementations.
- **`defaultAdapter()`** — resolves `globalThis.DOMParser` (browsers). In
  runtimes without one (Node, Bun) it throws a `BarkupError` whose message
  tells you exactly what to do: pass `domParserAdapter(new DOMParser())`
  with linkedom.

```ts
// server-side
import { DOMParser } from "linkedom";
import { domParserAdapter } from "@kevinpeckham/barkup";
const adapter = domParserAdapter(new DOMParser());
```

## src/grammar.ts — compile once, look up forever

- **`CompiledNodeSpec`** — per-type precomputation: resolved `tag`,
  `allowedChildren` as a `Set` (or `null` meaning `"*"`/any), `attributes`
  as an insertion-ordered `Map` (declaration order drives serialization
  order), and `kebabToKey` (a `Map` from `data-*` kebab name back to the
  declared camelCase key — the parse-side inverse index).
- **`CompiledGrammar`** — `{ config, nodes: Map, roots: Set,
  unknownAttributes, generateId }`.
- **`compileGrammar(config)`** — validates the config and builds the above.
  Throws `BarkupError` (programmer error) when:
  - the grammar declares zero node types;
  - a `tag` fails `TAG_RE`;
  - an attribute key fails `ATTRIBUTE_KEY_RE` (would break kebab
    round-trip) or is in `RESERVED_KEYS`;
  - a `children` entry names an undeclared type;
  - a `roots` entry names an undeclared type.

  Runs once inside `defineGrammar`; every later `build`/`parse`/`validate`
  call is Map/Set lookups.

## src/build.ts — typed tree → markup

- **`buildMarkup(grammar, tree)`** — entry point. Accumulates lines and
  joins with `\n` (trailing newline included). Output is **deterministic
  and pretty-printed**: 2-space indent per depth, one element per line.
  Determinism is a feature — diffs stay readable and `format()` is
  idempotent.
- **`buildNode(...)`** *(internal, recursive)* — serializes one node:
  1. Resolve the compiled spec; unknown `type` → **throw** (tree side).
  2. Emit attributes in canonical order: `data-type`, then `data-name`
     (if `name` set), then `id` (if set), then **declared attributes in
     grammar declaration order**, then undeclared attributes sorted
     alphabetically.
  3. Undeclared attributes: allowed only under the `"string"` policy, and
     only with string values — anything else **throws**.
  4. Empty children → `<tag ...></tag>` on one line; otherwise open tag,
     recurse at depth+1, closing tag at the parent's indent.
  Every value passes through `escapeAttribute`.
- **`serializeValue(value, type, key, path)`** *(internal)* — declared-type
  serialization with strict runtime checks (all throws, tree side):
  - `string` → must be `typeof "string"`, emitted as-is;
  - `number` → must be a **finite** number (`NaN`/`Infinity` rejected —
    they would not survive the round trip), emitted via `String()`;
  - `boolean` → `"true"` / `"false"`;
  - `json` → `JSON.stringify`; rejects values that stringify to
    `undefined` or throw (cycles).

```ts
grammar.build({
  type: "block", name: "hero", id: "b1",
  attributes: { featured: true },
  children: [{ type: "text-atom", attributes: { maxLength: 60 } }],
});
// <div data-type="block" data-name="hero" id="b1" data-featured="true">
//   <div data-type="text-atom" data-max-length="60"></div>
// </div>
```

## src/parse.ts — markup → typed tree, or issues

- **`parseMarkup(grammar, markup, adapter)`** — entry point.
  1. `adapter.parse(markup)` inside try/catch — an adapter exception
     becomes a single `parse-failed` issue (never an exception to the
     caller: markup side is data).
  2. Top level: non-whitespace text → `unexpected-text`; anything other
     than **exactly one** root element → `invalid-root` and an early
     return.
  3. Recurse via `parseElement`. Issues accumulate across the whole tree
     (the agent gets *all* problems in one round, not one per attempt);
     if any exist the result is `{ ok: false, issues }` — a partial tree
     is never returned.
- **`parseElement(...)`** *(internal)* — one element:
  - missing `data-type` or undeclared type → `unknown-type`, subtree
    skipped (children of an unknown type can't be containment-checked);
  - root nodes checked against `grammar.roots` → `invalid-root`;
  - `id` checked against a tree-wide `Set` → `duplicate-id`;
  - assembles the node **normalized**: `name`/`id` present only if in the
    markup, `attributes` only if non-empty, `children` only if non-empty.
    This is why `parse(build(t))` equals `normalize(t)`, not `t` verbatim.
- **`parseAttributes(...)`** *(internal)* — for each attribute other than
  the three reserved ones:
  - non-`data-*` (e.g. `class`, `style`) → `reserved-attribute` — only
    `id` and `data-*` are part of the dialect;
  - undeclared `data-*` → policy: `"string"` keeps it (key =
    `kebabToCamel`), `"error"` (default) → `unknown-attribute`;
  - declared → `coerceValue`; failures → `invalid-attribute-value` with
    the offending value quoted in the message;
  - afterwards, every declared `required` attribute not present →
    `missing-attribute`.
- **`parseChildren(...)`** *(internal)* — non-whitespace text inside an
  element → `unexpected-text` ("put text in a declared attribute" — the
  dialect has no text nodes by design); each child element parsed then
  checked against the parent's `allowedChildren` → `invalid-child`.
- **`coerceValue(raw, type)`** *(internal)* — the declared-coercion core:
  - `string` → pass through **byte-for-byte** (guarantee 3: `"1.5"`,
    `"true"`, `"007"` all stay strings);
  - `number` → `Number(raw)`, rejecting empty and non-finite;
  - `boolean` → exactly `"true"` or `"false"`, nothing else;
  - `json` → `JSON.parse` in try/catch.

```ts
const r = grammar.parse('<div data-type="blok"></div>');
// { ok: false, issues: [{ code: "unknown-type",
//     message: 'Node type "blok" is not declared in the grammar.',
//     path: "blok" }] }
```

## src/validate.ts — the same checks for programmatic trees

`parse()` guards the markup door; `validate()` runs the equivalent checks
on trees your own code builds *before* you `build()` or persist them.

- **`validateTree(grammar, tree)`** — entry; returns
  `{ ok: true } | { ok: false, issues }`. Never throws, never mutates.
- **`visit(...)`** *(internal, recursive)* — mirrors `parseElement`'s
  rules on the typed side: `unknown-type`, `invalid-root`, `duplicate-id`,
  per-attribute checks (undeclared → policy; declared → `checkValue`),
  `missing-attribute`, `invalid-child`.
- **`checkValue(value, spec)`** *(internal)* — typed-side counterpart of
  `coerceValue`: `typeof` checks for string/boolean, finite check for
  number, JSON-serializability probe for json. Returns a message fragment
  or `null`.

Why both exist: `build()` throws on the errors it can *see while
serializing* (wrong value types, undeclared attributes), but it does not
do containment or required-attribute analysis — that's `validate()`'s
job. Typical flow for agent-independent code: `validate` → fix → `build`.

## src/index.ts — assembly and the public surface

- **`defineGrammar(config, options?) → Grammar`** — compiles the config
  once (`compileGrammar` — may throw on bad config) and returns the codec
  object. `options.adapter` sets the default DOM adapter; each `parse`/
  `format` call may also pass one explicitly (call-site override wins,
  then the option, then `defaultAdapter()`).
- **`Grammar`** *(interface)* — `{ config, build, parse, format,
  validate }`. `config` is exposed so helpers like `treeArbitrary` can
  consume the same declaration.
- **`format(markup, adapter?)`** — the pretty-printer with the package's
  origin-story rule baked in: parse strictly (issues → `{ ok: false }`,
  nothing formatted), then **`fillMissingIds`**, then rebuild. Because
  build output is canonical, `format` is idempotent.
- **`fillMissingIds(node, generateId)`** *(internal)* — recursive; assigns
  an id **only** when `node.id === undefined`. Never touches an existing
  id — guarantee 1, and the one-line lesson the article's first scar paid
  for.
- **`normalizeNode(node)`** — returns a structurally-clean copy: drops
  empty `attributes` objects, empty `children` arrays, and undefined
  `name`/`id`. `parse()` output is always in this form; run your own trees
  through it before deep-equality comparisons. (Round-trip identity is
  formally `parse(build(t)).node ≡ normalize(t)`.)
- Re-exports: the adapter functions/types, `BarkupError`, and every public
  type from `types.ts`.

## src/testing.ts — the `@kevinpeckham/barkup/testing` entry

Property-test helpers so consumers can prove the guarantees over *their*
grammar. Imports `fast-check` (optional peer dependency — only needed if
you import this entry).

- **`treeArbitrary(config, options?)`** — a fast-check `Arbitrary` of
  random **grammar-valid** trees: roots drawn from `config.roots`,
  children only from each node's allowed set (`"*"` → any declared type),
  attribute values type-correct per declaration (`required` always
  present, optional ones sometimes omitted), names optional, and a mix of
  present ids (unique, `n0, n1, …`) and missing ids — so `format()`'s
  fill-only-missing behavior gets exercised. `options`:
  `maxDepth` (default 4), `maxChildren` (default 4).
  - *Value generators worth knowing about:* string attribute values
    exclude control characters (U+0000–U+001F, U+007F) because **no**
    spec-compliant HTML parser round-trips them byte-for-byte — an HTML
    limitation, documented in the README; numbers exclude `NaN`/`±Infinity`
    and normalize `-0` → `0`; json values are drawn from
    `fc.jsonValue()`.
- **`nodesEqual(a, b)`** — deep equality over `normalizeNode`'d trees,
  ignoring attribute key order and JSON object key order (via
  `canonical` / `canonicalValue` / `sortJson`, which sort keys
  recursively before comparison). Child **order matters** — it is part of
  the tree's meaning.
- **`assertRoundTrip(grammar, tree, adapter?)`** — builds, parses, and
  throws a readable error on failure: parse issues are listed with their
  codes and paths plus the offending markup; a mismatch prints both
  normalized trees as JSON.

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

## src/patch.ts — the `@kevinpeckham/barkup/patch` entry

Anchored patches: atomic, grammar-validated edits addressing nodes by
id — the benchmark's lowest-cost editing strategy, tying whole-tree
rewrite on success (barkup-bench condition F; see
`docs/anchored-patches.md` for the evidence and the full design
note). No DOM involvement — patches operate on
`BarkupNode` trees. Patches are agent/user input, so the markup-side
error model applies throughout: failures are data, never throws.

- **`applyAnchoredPatch(grammar, tree, operations)`** — clones the
  tree (never mutates the input), applies operations in order via
  `applyOp`, and runs `grammar.validate()` on the result. The first
  failing operation rejects the entire patch; an `ok: true` result is
  the patched tree in normalized form. `operations` is `unknown` by
  design: shape problems come back as issues, not type errors. The
  only throw is `BarkupError` when the *base tree* (the caller's own
  data) is not JSON-serializable — tree side.
- **`AnchoredOperation` / `AnchoredPlacement`** — the six ops
  (`set-attribute`, `remove-attribute`, `set-name`, `remove`,
  `insert`, `move`); placement is exactly one of `before`/`after`
  (sibling id, parent derived) or `parentId` (append). For `move`,
  placement resolves **after** the node is detached.
- **`PatchIssue` / `PatchIssueCode`** — op-level failures get
  `code: "invalid-patch"`, a message prefixed `Operation ${i}: …`,
  `path: "(patch op ${i})"`, and `opIndex`; grammar failures found by
  post-apply validation are ordinary `GrammarIssue`s (structurally
  assignable — their `opIndex` is absent). The core `IssueCode` union
  is untouched.
- *Internals worth knowing:* `OP_HANDLERS` dispatches op names to one
  handler per op; `resolvePlacement`/`resolveSiblingPlacement` turn an
  anchor spec into a concrete (parent, index); `attach`/`detach` do
  the splicing (empty `children` arrays are pruned);
  `mustNonRootNode` guards `remove`/`move` against the root;
  `subtreeContainsId` blocks moving a node into its own subtree;
  `jsonClone` is the clone primitive — trees are typed JSON by
  contract, so a JSON round trip is the honest copy.

```ts
import { applyAnchoredPatch } from "@kevinpeckham/barkup/patch";

const result = applyAnchoredPatch(grammar, storedTree, [
  { op: "set-attribute", id: "t1", key: "content", value: "Hello" },
  { op: "move", id: "b2", after: "b1" },
]);
// { ok: true, node } — or { ok: false, issues } naming the op index
```

## src/view.ts — the `@kevinpeckham/barkup/view` entry

Focused views: render only the part of the tree an edit concerns —
the root-to-focus spine fully, everything else collapsed to
id-bearing placeholders or omitted with an honest count — as
HTML-dialect markup for the prompt, while patches apply to the full
tree. The benchmark's cheapest validated input interface
(barkup-bench Studies I and J; see `docs/focused-views.md` for the
evidence and the full design note). The load-bearing invariant:
**every visible id is a real id in the tree** — visible implies
patchable, which is what makes views compose with
`applyAnchoredPatch`. Views are prompt artifacts, not round-trip
inputs: placeholders omit required attributes, so view output is
deliberately not valid `parse()` input.

- **`renderView(grammar, tree, { focus, mode? })`** — renders the
  view or returns structured issues. The spine renders fully
  (byte-identical to `build()` of those node shells); children of
  focus nodes always appear in document order, at minimum as
  placeholders (`data-collapsed="true"` + `data-child-count="N"`, N =
  the real child count, no grammar attributes); other non-spine
  children are placeholders (`mode: "focused"`) or omitted with
  `data-omitted-children="N"` on the parent (`mode: "minimal"`, the
  default). Unknown focus ids, malformed focus arrays, and
  reserved-attribute collisions are DATA (`{ ok: false, issues }`,
  all problems in one pass); an invalid base tree throws from
  `build()` and an unknown `mode` throws `BarkupError` — tree side,
  as ever. Never mutates the input; deterministic.
- **Reserved view attributes** — `collapsed`, `childCount`,
  `omittedChildren` (→ `data-collapsed`, `data-child-count`,
  `data-omitted-children`). A grammar that declares any of them on
  any node type — or a tree that carries one under the `"string"`
  policy — is rejected with issues rather than rendered ambiguously.
- **`ViewIssue` / `ViewIssueCode`** — view-input failures get
  `code: "invalid-view"` (path `"(view focus)"` for focus problems;
  `nodeId`/`attribute` where applicable); the core `IssueCode` union
  is untouched, mirroring `"invalid-patch"`.
- **`VIEW_PROMPT_RULES`** — the exact five-bullet prompt block
  pre-registered in barkup-bench BRIEF-J and scored by Study J
  (pinned verbatim by a unit test). The fresh-id bullet is what kept
  duplicate-id collisions at zero across 360 scored view runs.
- **`findNodes(tree, query, { limit? })`** — the content-search
  scorer barkup-bench Study N handed to models as a `find_nodes`
  tool, ported from `src/conditions/grounded-n.ts`: distinct-token
  overlap (lowercase alphanumeric runs) between the query and each
  node's type, name, and attributes; id-less nodes skipped; zero
  scores excluded; ties by document order; top `limit` (default 5)
  ids. It closes the "who supplies the focus ids?" gap: skeleton view
  + one search call grounded id-free requests at oracle-level
  accuracy on the frontier model (43/45) and full-tree-level on the
  cheap one (39/45 vs navigation's 23/45) at ~90% less input.
- **`renderSearch(grammar, tree, query, { limit?, mode? })`** — the
  benched tool-result composition, `renderView` over `findNodes`
  (minimal mode by default). Returns `null` on a miss — retrieval
  data, not a failure; the exported **`NO_MATCHES_MESSAGE`** is the
  exact miss text the benchmark scored, for the tool layer to send
  back. A returned `ViewResult` can still be `{ ok: false }` for
  reserved-attribute collisions; found ids are always real, so
  unknown-focus issues cannot occur.
- **`SEARCH_PROMPT_RULES`** — the three-bullet Study N search block
  (pinned verbatim), with the benchmark's "anchored patch" phrasing
  generalized to "your patch" exactly as `VIEW_PROMPT_RULES` was.
- *Internals worth knowing:* `viewGrammarFor` compiles (and caches
  per Grammar, via WeakMap) an augmented grammar with the three view
  attributes declared on every node type, so the shipped `build()`
  does all serialization — that construction is why expanded regions
  are byte-identical to `build()` output; `collectSpine` gathers
  root-to-focus paths and reports unknown ids; `buildViewTree` /
  `placeholderOf` / `viewNodeOf` assemble the view as a `BarkupNode`
  carrying the metadata as declared attributes.

```ts
import { renderView, renderSearch } from "@kevinpeckham/barkup/view";

const view = renderView(grammar, storedTree, { focus: ["n819"] });
// { ok: true, html } — spine expanded, the rest collapsed/omitted —
// or { ok: false, issues } (unknown focus id, reserved attribute)

const found = renderSearch(grammar, storedTree, "hero text-atom");
// the best-matching nodes rendered in place — or null: no matches
```

---

## tests/ — what each suite proves

- **`tests/helpers.ts`** — the shared linkedom adapter and `DOC_CONFIG`, a
  six-type document grammar in the article's shape (document → page →
  block → text/image atoms + a widget-slot with a `json` attribute), with
  `roots: ["document", "block"]`. `docGrammar(overrides)` builds a Grammar
  from it.
- **`tests/codec.test.ts`** *(unit, 21 tests)* — example-based coverage of
  every behavior: build serialization/determinism/escaping and its four
  throw conditions; parse round-trip, declared-coercion, and one test per
  issue code; format's fill-only-missing rule (including the regression
  test for the readable-id `"wgt-wrapper"` case), idempotence, and refusal
  to format invalid markup; validate mirroring; and the four
  `defineGrammar` config rejections.
- **`tests/guarantees.property.test.ts`** *(property, 200 runs each)* —
  the guarantees at scale: round-trip identity over random trees;
  format-preserves-every-existing-id (position-wise comparison of the id
  lists before/after, plus tree equality with ids erased); string
  attributes never change type for adversarial numeric-looking inputs;
  and a fixed battery of invalid markups that must all fail loudly with
  non-empty messages and paths.
- **`tests/patch.test.ts`** *(unit)* — every anchored-patch op and
  every failure mode, ported from the benchmark's reference suite:
  happy paths per op; op-level failures (stale ids, malformed fields,
  placement ambiguity, root guards, own-subtree moves, unknown ops)
  with `opIndex` and path assertions; post-apply validation
  (containment, value types, required attributes, duplicate ids); and
  input immutability on multi-op failure.
- **`tests/patch.property.test.ts`** *(property, 200 runs each)* —
  anchored patches at scale over random grammar-valid trees:
  atomicity (a failing op at any position leaves the input
  byte-identical); equivalence (each of the five edit kinds, expressed
  as an anchored op, produces the same tree as direct programmatic
  mutation); id preservation (untouched nodes keep ids byte-for-byte);
  validity (every accepted result passes `validate()`).
- **`tests/patch-vectors.test.ts`** *(conformance replay)* — replays
  the 40-vector anchored-patch suite vendored from barkup-bench
  (`tests/fixtures/patch-vectors.json`) against the benchmark grammar;
  the dialect's portable conformance suite.
- **`tests/view.test.ts`** *(unit)* — the focused-view contract by
  example: both modes, default mode, placeholder shape and honest
  counts, ordered children of focus nodes, leaf-focus `build()`
  parity, input immutability, determinism, views-are-not-parse-input;
  every failure mode (unknown focus ids, malformed focus,
  grammar-level and tree-level reserved-attribute collisions, unknown
  mode throws); and the exact `VIEW_PROMPT_RULES` wording, pinned.
- **`tests/view.property.test.ts`** *(property, 200 runs each)* —
  views at scale over random grammar-valid trees: every visible id
  exists in the tree; placeholder and omission counts honest (rendered
  + omitted = real child count, ids in document order); focus nodes
  expanded with complete ordered child lists; visible implies
  patchable (every visible id accepted by `applyAnchoredPatch` on the
  full tree); determinism + immutability; focus-every-leaf output
  equals `build(tree)` byte-for-byte.
- **`tests/view-vectors.test.ts`** *(conformance replay)* — replays
  the 39-vector focused-view suite vendored from barkup-bench
  (`tests/fixtures/view-vectors.json`), generated by the exact
  renderer Study J scored, byte-for-byte against the benchmark
  grammar.
- **`tests/search.test.ts`** *(unit)* — the content-search contract,
  ported from the benchmark's scorer suite: ranking by distinct-token
  overlap (attributes included), zero-score exclusion, document-order
  ties, single-count token repetition, the limit cap and its default,
  id-less skipping; `renderSearch`'s no-match `null`, in-place
  rendering with ancestors, equality with the documented composition,
  option passthrough, and reserved-attribute failures; the exact
  `SEARCH_PROMPT_RULES` and `NO_MATCHES_MESSAGE` wordings, pinned.
- **`tests/search.property.test.ts`** *(property, 200 runs each)* —
  search checked against an independently re-implemented scoring over
  random grammar-valid trees: results real, relevant, distinct,
  capped, and rank-ordered (score descending, document-order ties);
  nothing relevant left out of an unfilled result; determinism and
  input immutability; `renderSearch` null exactly on a miss and
  otherwise equal to `renderView` over `findNodes` with every match
  visible.

## Everything together — an agent's edit loop

```ts
import { DOMParser } from "linkedom";
import { defineGrammar, domParserAdapter } from "@kevinpeckham/barkup";

const adapter = domParserAdapter(new DOMParser());
const grammar = defineGrammar(
  {
    nodes: {
      block: { children: ["block", "text-atom"], attributes: {
        containerClasses: { type: "string" } } },
      "text-atom": { attributes: {
        maxLength: { type: "number", required: true },
        content: { type: "string" } } },
    },
    roots: ["block"],
  },
  { adapter },
);

// 1. Show the model the current state as markup it already speaks.
const current = grammar.build(storedTree);

// 2. The model returns a whole-tree rewrite. Validate at the boundary.
const result = grammar.parse(modelOutput);

if (!result.ok) {
  // 3a. Structured issues go back verbatim — path + message are written
  //     to be actionable ("block(intro) > text-atom: Required attribute
  //     "maxLength" is missing on node type "text-atom".")
  return retryWithFeedback(result.issues);
}

// 3b. Accepted: normalize ids (only fills missing ones), persist the
//     typed tree, render from JSON. Markup never leaves the boundary.
const formatted = grammar.format(grammar.build(result.node));
persist(result.node);
```

## Guarantee → code → test map

| Guarantee | Enforced in | Proven by |
|---|---|---|
| 1. Id preservation | `fillMissingIds` (index.ts) fills only `undefined`; build/parse copy ids verbatim | format property test (position-wise id list); `wgt-wrapper` unit test |
| 2. Round-trip identity | canonical build order + normalized parse output + perfect key casing (`ATTRIBUTE_KEY_RE`) + `escapeAttribute` | round-trip property test (200 random trees); example round-trip unit |
| 3. Declared coercion only | `coerceValue` (parse.ts) switches on the *spec*, never the value shape; `serializeValue` (build.ts) enforces the same on the way out | coercion property test with adversarial strings; unit tests |
| 4. Loud boundaries | every markup problem → `GrammarIssue` with code/path; partial trees never returned; adapter exceptions → `parse-failed` | invalid-markup battery; one unit test per issue code |
| Patch atomicity + validity (extends 1 and 4 to `barkup/patch`) | `applyAnchoredPatch` works on a clone; first failing op rejects with `opIndex`; post-apply `validate()` gate | atomicity/id-preservation/validity property tests; unit failure suite |
| View honesty + visible-implies-patchable (extends 1 and 4 to `barkup/view`) | `collectSpine` reports unknown focus ids; placeholders carry real child counts; reserved-attribute gate; shipped `build()` does all serialization | view property tests (honest counts, patchability, leaf-focus `build()` parity); 39-vector byte-for-byte replay |

## Deliberate omissions (scope moves on evidence, not requests)

No text nodes (text lives in declared attributes, where its type is
known). No rendering, diffing, schema migration, streaming, or framework
bindings. No `class`/`style` passthrough — presentation is a declared
attribute your renderer interprets. No attribute-level defaults or enums —
that's your grammar config's concern upstream. No inverse patches.

Extensions clear the bar only on evidence: anchored patches
(`barkup/patch`), added because barkup-bench measured the dialect
tying whole-tree rewrite on success at the lowest token cost; focused
views (`barkup/view`), added because Studies I and J measured
partial-context prompts holding accuracy while input stopped scaling
with the tree; and content search (`findNodes`/`renderSearch` in
`barkup/view`), added because Study N measured a skeleton view plus
one deterministic search call grounding id-free requests at
oracle-level accuracy (and text embeddings measuring no better) — all
with stable ids (guarantee 1) as their only precondition. That is the
standard for scope changes: a benchmark-validated capability whose
precondition barkup already guarantees. See CLAUDE.md and the README's
maintenance posture.
