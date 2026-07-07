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
 */
import type { Grammar } from "./index.js";
import { defineGrammar } from "./index.js";
import { pathSegment } from "./internal.js";
import type {
	AttributeSpec,
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
