/**
 * Focused views — the `@kevinpeckham/barkup/view` entry.
 *
 * A view renders only the part of the tree an edit concerns: the spine
 * (every node on a root-to-focus path) fully, children of focus nodes
 * always at least as placeholders (so ordinal placements like "as the
 * 3rd child" stay resolvable), and everything else either as
 * placeholders ("focused" mode) or omitted with an honest count
 * ("minimal" mode, the default). The output is the HTML dialect —
 * expanded regions are byte-identical to build() of the same nodes —
 * with three reserved view attributes carrying the collapse metadata:
 * data-collapsed, data-child-count, data-omitted-children.
 *
 * The invariant that makes views compose with anchored patches:
 * EVERY VISIBLE ID IS A REAL ID IN THE TREE — visible implies
 * patchable. Unknown focus ids are a structured error, never silently
 * ignored. Views are prompt artifacts, not round-trip inputs:
 * placeholders omit required attributes, so view output is not valid
 * input to parse().
 *
 * Focus ids and the grammar/tree interplay are agent-loop data, so the
 * markup-side error model applies: failures are data
 * ({ ok: false, issues }), never throws. Tree-side misuse (an invalid
 * tree, an unknown mode) throws BarkupError as everywhere else.
 *
 * Semantics are ported from the benchmark-validated reference renderer
 * (barkup-bench Studies I and J — see docs/focused-views.md for the
 * evidence and design).
 *
 * The entry also ships the benchmark-validated retrieval companion:
 * findNodes (the deterministic content-search scorer barkup-bench
 * Study N handed to models as a find_nodes tool) and renderSearch
 * (search composed with the minimal view — the exact tool-result
 * rendering the study scored), plus SEARCH_PROMPT_RULES and
 * NO_MATCHES_MESSAGE. Together they close the "who supplies the focus
 * ids?" gap: a skeleton view plus one find_nodes call grounded id-free
 * edit requests at oracle-level accuracy on the frontier model tested
 * (43/45) and full-tree-level on the cheap one (39/45 vs 23/45 for
 * expand-node navigation) at ~90% less input than a full-tree read.
 *
 * findNodes' exact complement is selectNodes (barkup-bench Study R's
 * fan-out enumeration step, ported faithfully): fuzzy search grounds
 * human language, selectNodes grounds programmatic queries. It is the
 * "enumerate the targets yourself" half of the measured fan-out
 * decomposition loop — one object query, then one single-target
 * anchored edit per returned id — which ran 90/90 fan-out tasks on
 * both models tested (674/674 subtasks, zero failures) at about a
 * third of the input cost of showing the whole tree.
 */
import type { Grammar } from "./index.js";
import { defineGrammar } from "./index.js";
import { pathSegment } from "./internal.js";
import type {
	AttributeSpec,
	AttributeValue,
	BarkupNode,
	IssueCode,
	NodeSpec,
} from "./types.js";
import { BarkupError } from "./types.js";

/** "focused" renders every non-spine child of a spine node as a
 * placeholder; "minimal" (the default) omits them and puts
 * data-omitted-children="N" on the parent. */
export type ViewMode = "focused" | "minimal";

export interface ViewOptions {
	/** Ids of the nodes the edit concerns. Every root-to-focus path
	 * renders fully; children of focus nodes always appear in document
	 * order, at minimum as placeholders. */
	focus: readonly string[];
	/** Defaults to "minimal" — the cheapest mode the benchmark
	 * validated (Study I: sonnet 45/45 on it). */
	mode?: ViewMode;
}

/** `"invalid-view"` marks view-input failures (unknown focus ids,
 * reserved-attribute collisions); the core IssueCode union is
 * untouched. */
export type ViewIssueCode = IssueCode | "invalid-view";

/** A structured problem with a view request. GrammarIssue is
 * assignable to this shape. */
export interface ViewIssue {
	code: ViewIssueCode;
	message: string;
	path: string;
	nodeId?: string;
	attribute?: string;
}

export type ViewResult =
	| { ok: true; html: string }
	| { ok: false; issues: ViewIssue[] };

/**
 * The benchmark-validated prompt block for consuming views (the exact
 * wording pre-registered in barkup-bench BRIEF-J and scored by Study
 * J). Append it to the system prompt of any agent shown a view; the
 * fresh-id bullet is what kept duplicate-id collisions at zero across
 * 360 scored view runs.
 */
export const VIEW_PROMPT_RULES = `View rules:
- You are shown a focused view of the tree, not the whole tree. The view is centered on the nodes the edit request references. Your patch is applied to the full tree, where every hidden node still exists.
- An element with data-collapsed="true" is a real node shown without its contents; data-child-count is how many children it actually has.
- An element with data-omitted-children="N" has N additional children that are not shown at all.
- Every visible id is a valid patch target. Never use an id that is not visible in the view.
- Give every node you create a fresh id unlikely to exist anywhere in the full tree (e.g. with a random-looking suffix); if it collides with a hidden node's id, the patch is rejected with a duplicate-id issue and you can correct it.`;

/** The view dialect's reserved attribute keys and their declared
 * types. Reserved: a grammar (or tree) that uses any of them cannot
 * be rendered unambiguously, and renderView returns an issue. */
const VIEW_ATTRIBUTES: Record<string, AttributeSpec> = {
	collapsed: { type: "boolean" },
	childCount: { type: "number" },
	omittedChildren: { type: "number" },
};

const RESERVED_VIEW_KEYS = new Set(Object.keys(VIEW_ATTRIBUTES));

/** data-kebab rendering of a reserved key, for messages. */
function kebab(key: string): string {
	return `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** Per-grammar cache of the augmented (view) grammar, so repeated
 * renderView calls compile once. */
const viewGrammarCache = new WeakMap<Grammar, Grammar>();

/** The consumer's grammar with the three view attributes declared on
 * every node type — the shipped build() then does all serialization,
 * which is what makes expanded regions byte-identical to build(). */
function viewGrammarFor(grammar: Grammar): Grammar {
	const cached = viewGrammarCache.get(grammar);
	if (cached) return cached;
	const nodes: Record<string, NodeSpec> = {};
	for (const [type, spec] of Object.entries(grammar.config.nodes)) {
		nodes[type] = {
			...spec,
			attributes: { ...(spec.attributes ?? {}), ...VIEW_ATTRIBUTES },
		};
	}
	const augmented = defineGrammar({ ...grammar.config, nodes });
	viewGrammarCache.set(grammar, augmented);
	return augmented;
}

/**
 * Render a focused view of a tree as HTML-dialect markup.
 *
 * The spine (root-to-focus paths) renders fully; children of focus
 * nodes always appear in document order, at minimum as placeholders
 * (childless elements carrying only type, name, id,
 * data-collapsed="true", and data-child-count); other non-spine
 * children are placeholders ("focused") or omitted with
 * data-omitted-children on the parent ("minimal", default). Every
 * visible id exists in the tree and can be targeted by
 * applyAnchoredPatch against the full tree.
 *
 * Unknown focus ids and reserved-attribute collisions come back as
 * structured issues. The input tree is never mutated. An invalid base
 * tree (unknown types, wrong attribute value types) throws
 * BarkupError from build(), tree side, as ever.
 */
export function renderView(
	grammar: Grammar,
	tree: BarkupNode,
	options: ViewOptions,
): ViewResult {
	const mode = options.mode ?? "minimal";
	if (mode !== "focused" && mode !== "minimal") {
		// The mode is chosen by the caller's program, not the model:
		// tree side, throw.
		throw new BarkupError(
			`renderView: unknown mode "${String(mode)}" — allowed: "focused", "minimal".`,
		);
	}
	const focusIds = options.focus;
	if (
		!Array.isArray(focusIds) ||
		focusIds.some((id) => typeof id !== "string")
	) {
		return {
			ok: false,
			issues: [
				{
					code: "invalid-view",
					message: '"focus" must be an array of node id strings.',
					path: "(view focus)",
				},
			],
		};
	}
	const issues: ViewIssue[] = [];
	collectReservedGrammarIssues(grammar, issues);
	collectReservedTreeIssues(tree, "", issues);
	const spine = collectSpine(tree, focusIds, issues);
	if (issues.length > 0) return { ok: false, issues };
	const viewTree = buildViewTree(tree, spine, new Set(focusIds), mode);
	return { ok: true, html: viewGrammarFor(grammar).build(viewTree) };
}

/** A grammar that declares a reserved view attribute cannot render
 * unambiguous views — report every collision. */
function collectReservedGrammarIssues(
	grammar: Grammar,
	issues: ViewIssue[],
): void {
	for (const [type, spec] of Object.entries(grammar.config.nodes)) {
		for (const key of Object.keys(spec.attributes ?? {})) {
			if (RESERVED_VIEW_KEYS.has(key)) {
				issues.push({
					code: "invalid-view",
					message: `The grammar declares attribute "${key}" on node type "${type}", but "${key}" is reserved by the view dialect (it renders as ${kebab(key)}). Rename the attribute to render views of this grammar.`,
					path: pathSegment(type),
					attribute: key,
				});
			}
		}
	}
}

/** Same reservation on the tree itself (covers undeclared attributes
 * kept under the "string" policy). */
function collectReservedTreeIssues(
	node: BarkupNode,
	prefix: string,
	issues: ViewIssue[],
): void {
	const path = prefix
		? `${prefix} > ${pathSegment(node.type, node.name)}`
		: pathSegment(node.type, node.name);
	for (const key of Object.keys(node.attributes ?? {})) {
		if (RESERVED_VIEW_KEYS.has(key)) {
			issues.push({
				code: "invalid-view",
				message: `Attribute "${key}" is reserved by the view dialect (it renders as ${kebab(key)}) and cannot appear on a node.`,
				path,
				...(node.id !== undefined ? { nodeId: node.id } : {}),
				attribute: key,
			});
		}
	}
	for (const child of node.children ?? []) {
		collectReservedTreeIssues(child, path, issues);
	}
}

/** Every node on a root-to-focus path. Unknown focus ids become
 * issues — never silently ignored (a view that quietly dropped a
 * focus would break "visible implies patchable" downstream). */
function collectSpine(
	tree: BarkupNode,
	focusIds: readonly string[],
	issues: ViewIssue[],
): Set<BarkupNode> {
	const spine = new Set<BarkupNode>();
	const descend = (node: BarkupNode, targetId: string): boolean => {
		if (node.id === targetId) {
			spine.add(node);
			return true;
		}
		for (const child of node.children ?? []) {
			if (descend(child, targetId)) {
				spine.add(node);
				return true;
			}
		}
		return false;
	};
	for (const id of focusIds) {
		if (!descend(tree, id)) {
			issues.push({
				code: "invalid-view",
				message: `Focus id "${id}" does not exist in the tree.`,
				path: "(view focus)",
				nodeId: id,
			});
		}
	}
	return spine;
}

/** A placeholder: type, name, id, and the two view attributes — no
 * grammar attributes, no children. data-child-count is the node's
 * REAL child count (honesty is what the prompt rules promise). */
function placeholderOf(node: BarkupNode): BarkupNode {
	return {
		type: node.type,
		...(node.name !== undefined ? { name: node.name } : {}),
		...(node.id !== undefined ? { id: node.id } : {}),
		attributes: {
			collapsed: true,
			childCount: node.children?.length ?? 0,
		},
	};
}

/** The view as a BarkupNode carrying the view metadata as declared
 * attributes, so the shipped build() does all serialization. Ported
 * from the renderer Study J scored. */
function buildViewTree(
	tree: BarkupNode,
	spine: Set<BarkupNode>,
	focus: Set<string>,
	mode: ViewMode,
): BarkupNode {
	const render = (node: BarkupNode): BarkupNode => {
		const rendered: BarkupNode[] = [];
		let omitted = 0;
		for (const child of node.children ?? []) {
			if (spine.has(child)) {
				rendered.push(render(child));
			} else if (focus.has(node.id as string) || mode === "focused") {
				rendered.push(placeholderOf(child));
			} else {
				omitted += 1;
			}
		}
		return viewNodeOf(node, rendered, omitted);
	};
	return render(tree);
}

/** Assemble one rendered view node: the original shell (type, name,
 * id, attributes) plus the honest omission count and the children
 * that made the cut. */
function viewNodeOf(
	node: BarkupNode,
	rendered: BarkupNode[],
	omitted: number,
): BarkupNode {
	const attributes = {
		...(node.attributes ?? {}),
		...(omitted > 0 ? { omittedChildren: omitted } : {}),
	};
	return {
		type: node.type,
		...(node.name !== undefined ? { name: node.name } : {}),
		...(node.id !== undefined ? { id: node.id } : {}),
		...(Object.keys(attributes).length > 0 ? { attributes } : {}),
		...(rendered.length > 0 ? { children: rendered } : {}),
	};
}

// ---------------------------------------------------------------------------
// Content search — the benchmark-validated retrieval companion
// (barkup-bench Study N's find_nodes scorer, ported faithfully).
// ---------------------------------------------------------------------------

/**
 * The benchmark-validated prompt block for agents given a find_nodes
 * search tool (barkup-bench BRIEF-N wording, scored by Study N, with
 * the benchmark's "anchored patch" phrasing generalized the same way
 * VIEW_PROMPT_RULES was). Show the model a minimal view of the tree's
 * root (renderView with focus: [rootId]) plus a find_nodes tool backed
 * by renderSearch, append this block to the system prompt, and one
 * search call is the median path to a correctly grounded edit.
 */
export const SEARCH_PROMPT_RULES = `Search rules:
- You are shown a minimal view of the tree's root. Collapsed elements are real nodes shown without their contents; data-child-count is how many children each actually has.
- Call find_nodes with a few search words (names, types, attribute values) to retrieve the 5 best-matching nodes, shown in place in the tree with their ancestors. Search as many times as you need to locate the nodes the edit request concerns.
- When you have found them, reply with your patch as your final message. Every id you use must be one you have seen.`;

/**
 * The exact no-match tool result the benchmark scored. renderSearch
 * returns null on a miss (null is retrieval data, not an error — the
 * issues union stays reserved for real failures); return this text as
 * the tool result so the model knows to reword, exactly as the
 * benchmark's harness did.
 */
export const NO_MATCHES_MESSAGE =
	"No nodes match that query. Try different words (node types, names, attribute values).";

export interface FindNodesOptions {
	/** Maximum number of ids returned. Defaults to 5 — the top-k the
	 * benchmark pre-registered and scored. */
	limit?: number;
}

/** Lowercase alphanumeric token runs of a string, as a set (distinct
 * tokens — repetition never scores twice). */
function tokenize(text: string): Set<string> {
	return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/** The node text a query is scored against: type, name, and every
 * attribute as `key JSON-value`. */
function searchableText(node: BarkupNode): string {
	const attrs = Object.entries(node.attributes ?? {})
		.map(([key, value]) => `${key} ${JSON.stringify(value)}`)
		.join(" ");
	return `${node.type} ${node.name ?? ""} ${attrs}`;
}

/**
 * Find the node ids best matching a content query — the deterministic
 * scorer barkup-bench Study N handed to models as a find_nodes tool.
 *
 * Scoring is distinct-token overlap: a node's score is how many of its
 * distinct tokens (from type, name, and attributes) appear in the
 * query's token set. Nodes without ids are skipped (search feeds focus
 * and patches, which address by id); zero scores are excluded; ties
 * break by document order (depth-first pre-order). Returns at most
 * `limit` (default 5) ids — possibly none.
 *
 * Deliberately simple: in the benchmark, this keyword scorer driven by
 * the model's own queries matched the frontier model's id-oracle
 * accuracy, and swapping it for off-the-shelf text embeddings measured
 * no better (Study N refuted that upgrade).
 */
export function findNodes(
	tree: BarkupNode,
	query: string,
	options?: FindNodesOptions,
): string[] {
	const limit = options?.limit ?? 5;
	const wanted = tokenize(query);
	const scored: { id: string; score: number; order: number }[] = [];
	let order = 0;
	const walk = (node: BarkupNode): void => {
		if (node.id !== undefined) {
			let score = 0;
			for (const token of tokenize(searchableText(node))) {
				if (wanted.has(token)) score += 1;
			}
			if (score > 0) scored.push({ id: node.id, score, order });
			order += 1;
		}
		for (const child of node.children ?? []) walk(child);
	};
	walk(tree);
	return scored
		.sort((a, b) => b.score - a.score || a.order - b.order)
		.slice(0, limit)
		.map((s) => s.id);
}

export interface SearchOptions extends FindNodesOptions {
	/** View mode for the rendered matches. Defaults to "minimal" — the
	 * rendering the benchmark scored as the find_nodes tool result. */
	mode?: ViewMode;
}

/**
 * Search the tree and render the matches in place — the exact
 * find_nodes tool-result composition barkup-bench Study N scored:
 * `renderView(grammar, tree, { focus: findNodes(tree, query), mode: "minimal" })`.
 *
 * Returns null when nothing matches: a miss is retrieval data, not a
 * failure, so it does not join the issues union — send
 * NO_MATCHES_MESSAGE (the exact benchmarked miss text) back as the
 * tool result instead. A returned ViewResult can still be
 * `{ ok: false }` for the usual view-input reasons (reserved-attribute
 * collisions); found ids are always real, so unknown-focus issues
 * cannot occur.
 */
export function renderSearch(
	grammar: Grammar,
	tree: BarkupNode,
	query: string,
	options?: SearchOptions,
): ViewResult | null {
	const focus = findNodes(tree, query, options);
	if (focus.length === 0) return null;
	return renderView(grammar, tree, {
		focus,
		...(options?.mode !== undefined ? { mode: options.mode } : {}),
	});
}

// ---------------------------------------------------------------------------
// Deterministic selection — the fan-out enumeration step
// (barkup-bench Study R's decomposition pipeline; the {type, within}
// semantics are ported faithfully from the benchmark's committed
// enumerator, src/corpus/fanout.ts fanoutTargets).
// ---------------------------------------------------------------------------

/**
 * An exact, structural node query. All present criteria are ANDed; an
 * empty query matches every id-bearing node in the tree.
 */
export interface SelectQuery {
	/** Node type to match (exact). */
	type?: string;
	/** Node name to match (exact). */
	name?: string;
	/** Attribute equality constraints: every listed key must be
	 * present on the node with a deep-equal value. Primitives compare
	 * by identity (`"40"` never matches `40` — declared coercion only,
	 * as everywhere); json values compare structurally, with array
	 * order significant and JSON object key order not (the same
	 * equality `nodesEqual` in barkup/testing uses). */
	attributes?: Record<string, AttributeValue>;
	/** Restrict matches to STRICT descendants of the node with this
	 * id — the anchor node itself never matches. An unknown id selects
	 * nothing (`[]`): selection is data, not an error, matching
	 * renderSearch's null-on-a-miss philosophy — a within id can go
	 * stale between turns exactly like a search that stops matching. */
	within?: string;
}

/** First node with the id, searching in document order (depth-first
 * pre-order) — ids are unique in valid trees, so "first" only matters
 * for malformed input, where doc order is the deterministic choice. */
function firstById(node: BarkupNode, id: string): BarkupNode | null {
	if (node.id === id) return node;
	for (const child of node.children ?? []) {
		const found = firstById(child, id);
		if (found) return found;
	}
	return null;
}

/** A non-null, non-array object — a JSON object for our purposes
 * (attribute values are typed JSON by contract). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
	return (
		a.length === b.length &&
		a.every((value, index) => attributeValuesEqual(value, b[index]))
	);
}

/** Key-set equality — JSON object key order is not significant,
 * matching `nodesEqual` in barkup/testing. */
function objectsEqual(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): boolean {
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length &&
		keys.every((key) => key in b && attributeValuesEqual(a[key], b[key]))
	);
}

/** Deep equality over attribute values: primitives by `===`, arrays
 * element-wise in order, JSON objects by key set. */
function attributeValuesEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a)) return Array.isArray(b) && arraysEqual(a, b);
	if (isJsonObject(a)) return isJsonObject(b) && objectsEqual(a, b);
	return false;
}

/** Every listed attribute must be present with a deep-equal value. */
function matchesAttributes(
	node: BarkupNode,
	constraints: Record<string, AttributeValue> | undefined,
): boolean {
	if (constraints === undefined) return true;
	const attributes = node.attributes ?? {};
	return Object.entries(constraints).every(
		([key, value]) =>
			key in attributes && attributeValuesEqual(attributes[key], value),
	);
}

/** Every present criterion must hold (AND). */
function matchesSelect(node: BarkupNode, query: SelectQuery): boolean {
	if (query.type !== undefined && node.type !== query.type) return false;
	if (query.name !== undefined && node.name !== query.name) return false;
	return matchesAttributes(node, query.attributes);
}

/**
 * Select the ids of every node matching an exact structural query —
 * the deterministic enumeration step of the benchmark-measured
 * fan-out decomposition loop (barkup-bench Study R):
 *
 * ```ts
 * const targets = selectNodes(tree, { type: "text-atom", within: sectionId });
 * for (const id of targets) {
 *   // one single-target anchored edit per node,
 *   // against a focused view of that node
 * }
 * ```
 *
 * All present criteria are ANDed; an empty query matches every
 * id-bearing node. `within` scopes to strict descendants (the anchor
 * itself never matches; an unknown id returns `[]` — see SelectQuery).
 * Results are ids in document order (depth-first pre-order, the same
 * order findNodes breaks ties in), nodes without ids are skipped, and
 * selection is purely structural and synchronous — no scoring, no
 * fuzziness. It is the exact complement to findNodes: fuzzy search
 * grounds human language, selectNodes grounds programmatic queries.
 * Deterministic; never mutates the input.
 *
 * In Study R, this enumeration plus one single-target anchored edit
 * per returned id ran 90/90 fan-out tasks on both models tested
 * (674/674 subtasks, zero failures, including every 7–32-target
 * task) at about a third of the input cost of a whole-tree prompt —
 * while every prompt-side alternative left partial coverage.
 */
export function selectNodes(tree: BarkupNode, query: SelectQuery): string[] {
	const scoped = query.within !== undefined;
	const scope =
		query.within === undefined ? tree : firstById(tree, query.within);
	if (scope === null) return [];
	const ids: string[] = [];
	const walk = (node: BarkupNode, isAnchor: boolean): void => {
		if (
			!(isAnchor && scoped) &&
			node.id !== undefined &&
			matchesSelect(node, query)
		) {
			ids.push(node.id);
		}
		for (const child of node.children ?? []) walk(child, false);
	};
	walk(scope, true);
	return ids;
}
