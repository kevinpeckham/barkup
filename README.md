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

## When not to use this

- **Numeric-heavy or deeply cross-referenced trees** — HTML's stringly
  attributes will fight you.
- **Huge trees** — whole-artifact authoring assumes the tree fits in context.
- **Real-time multi-writer collaboration** — whole-tree replacement is
  last-write-wins by construction.

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
correction feedback.

## Maintenance posture

barkup is **scoped and stable**: the surface (`defineGrammar` →
`build` / `parse` / `format` / `validate`, plus `@kevinpeckham/barkup/testing` and
`@kevinpeckham/barkup/patch`) is the whole product, and it is intentionally
small. Scope moves only on evidence: anchored patches were added because
[the benchmark](https://github.com/kevinpeckham/barkup-bench) measured
them tying whole-tree rewrite at the lowest cost, with barkup's id
guarantee as their one precondition — that standard, not feature
requests, is what changes the surface. Bug reports and guarantee
violations are always welcome.

## License & credit

MIT © Kevin Peckham. Built at [Lightning Jar](https://www.lightningjar.com).
The design is described in
[HTML as a Native Data Format for LLMs](https://www.lightningjar.com/blog/ast-as-html);
the benchmark behind the numbers is
[barkup-bench](https://github.com/kevinpeckham/barkup-bench), with the
results write-up in
[We Benchmarked It](https://www.lightningjar.com/blog/barkup-bench-results).
