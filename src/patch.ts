/**
 * Anchored patches — the `@kevinpeckham/barkup/patch` entry.
 *
 * A patch is a JSON array of operations that address nodes by id —
 * `before`/`after` sibling anchors or `parentId` append; no positional
 * indexes exist in the dialect. Application is atomic (the first
 * failing operation rejects the whole patch, with the op index in the
 * issue) and the result must pass the grammar's validate().
 *
 * Patches are agent/user input, so the markup-side error model
 * applies: failures are data ({ ok: false, issues }), never throws.
 * The one precondition is stable node ids (guarantee 1) — a node
 * without an id cannot be addressed; format() fills missing ids.
 *
 * Semantics are ported from the benchmark-validated reference
 * implementation (barkup-bench condition F — see
 * docs/anchored-patches.md for the evidence and design).
 */
import type { Grammar } from "./index.js";
import { normalizeNode } from "./index.js";
import type { AttributeValue, BarkupNode, IssueCode } from "./types.js";
import { BarkupError } from "./types.js";

/** Placement for insert/move: exactly one of the three anchors.
 * `before`/`after` name a sibling id (the parent is derived);
 * `parentId` appends as the last child. */
export type AnchoredPlacement =
	| { before: string }
	| { after: string }
	| { parentId: string };

export type AnchoredOperation =
	| { op: "set-attribute"; id: string; key: string; value: AttributeValue }
	| { op: "remove-attribute"; id: string; key: string }
	| { op: "set-name"; id: string; name: string }
	| { op: "remove"; id: string }
	| ({ op: "insert"; node: BarkupNode } & AnchoredPlacement)
	| ({ op: "move"; id: string } & AnchoredPlacement);

/** `"invalid-patch"` marks op-level failures; grammar failures found
 * after application keep their ordinary IssueCode. */
export type PatchIssueCode = IssueCode | "invalid-patch";

/** A structured problem in a patch or in the patched tree. Op-level
 * issues carry the failing operation's index; GrammarIssue is
 * assignable to this shape (its opIndex is simply absent). */
export interface PatchIssue {
	code: PatchIssueCode;
	message: string;
	path: string;
	/** Index of the failing operation, for op-level issues. */
	opIndex?: number;
	nodeId?: string;
	attribute?: string;
}

export type PatchResult =
	| { ok: true; node: BarkupNode }
	| { ok: false; issues: PatchIssue[] };

interface RawOp {
	op?: unknown;
	id?: unknown;
	key?: unknown;
	value?: unknown;
	name?: unknown;
	node?: unknown;
	parentId?: unknown;
	before?: unknown;
	after?: unknown;
}

/**
 * Apply an anchored patch to a tree, atomically, and validate the
 * result against the grammar. The input tree is never mutated; an
 * `ok: true` result carries the patched tree in normalized form (the
 * same shape parse() returns), with every untouched id byte-for-byte
 * intact. `operations` is unknown because patches are agent input —
 * shape problems come back as issues, not type errors.
 */
export function applyAnchoredPatch(
	grammar: Grammar,
	tree: BarkupNode,
	operations: unknown,
): PatchResult {
	if (!Array.isArray(operations)) {
		return {
			ok: false,
			issues: [
				{
					code: "invalid-patch",
					message: "An anchored patch must be an array of operations.",
					path: "(patch)",
				},
			],
		};
	}
	let working: BarkupNode;
	try {
		working = jsonClone(tree);
	} catch {
		// The base tree comes from the caller's own code: tree side, throw.
		throw new BarkupError(
			"applyAnchoredPatch: the tree is not JSON-serializable.",
		);
	}
	for (let i = 0; i < operations.length; i += 1) {
		const issue = applyOp(working, operations[i] as RawOp, i);
		if (issue) return { ok: false, issues: [issue] };
	}
	const validated = grammar.validate(working);
	if (!validated.ok) {
		return { ok: false, issues: validated.issues };
	}
	return { ok: true, node: normalizeNode(working) };
}

/** Trees are typed JSON by contract; a JSON round trip is the clone. */
function jsonClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function fail(index: number, message: string): PatchIssue {
	return {
		code: "invalid-patch",
		message: `Operation ${index}: ${message}`,
		path: `(patch op ${index})`,
		opIndex: index,
	};
}

function findById(tree: BarkupNode, id: string): BarkupNode | null {
	if (tree.id === id) return tree;
	for (const child of tree.children ?? []) {
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}

function findParent(
	tree: BarkupNode,
	id: string,
): { parent: BarkupNode; index: number } | null {
	const children = tree.children ?? [];
	for (let i = 0; i < children.length; i += 1) {
		const child = children[i] as BarkupNode;
		if (child.id === id) return { parent: tree, index: i };
		const found = findParent(child, id);
		if (found) return found;
	}
	return null;
}

function subtreeContainsId(node: BarkupNode, id: unknown): boolean {
	for (const child of node.children ?? []) {
		if (child.id === id || subtreeContainsId(child, id)) return true;
	}
	return false;
}

function mustNode(
	tree: BarkupNode,
	id: unknown,
	index: number,
	role: string,
): BarkupNode | PatchIssue {
	if (typeof id !== "string") {
		return fail(index, `"${role}" must be a node id string.`);
	}
	const node = findById(tree, id);
	if (!node) {
		return fail(index, `No node with id "${id}" exists in the tree.`);
	}
	return node;
}

/**
 * Resolve an anchor spec to a concrete (parent, index) placement.
 * Exactly one of before/after/parentId must be provided; before/after
 * derive the parent from the sibling.
 */
function resolvePlacement(
	tree: BarkupNode,
	op: RawOp,
	index: number,
): { parent: BarkupNode; at: number } | PatchIssue {
	const anchors = [op.before, op.after, op.parentId].filter(
		(a) => a !== undefined,
	);
	if (anchors.length !== 1) {
		return fail(
			index,
			'provide exactly one placement anchor: "before" or "after" (a sibling id) or "parentId" (append as last child).',
		);
	}
	if (op.before !== undefined || op.after !== undefined) {
		return resolveSiblingPlacement(tree, op, index);
	}
	const parent = mustNode(tree, op.parentId, index, "parentId");
	if (!("type" in parent)) return parent;
	return { parent, at: (parent.children ?? []).length };
}

/** before/after: derive the parent from the sibling anchor. */
function resolveSiblingPlacement(
	tree: BarkupNode,
	op: RawOp,
	index: number,
): { parent: BarkupNode; at: number } | PatchIssue {
	const sibling = mustNode(
		tree,
		op.before ?? op.after,
		index,
		op.before !== undefined ? "before" : "after",
	);
	if (!("type" in sibling)) return sibling;
	const located = findParent(tree, sibling.id as string);
	if (!located) {
		return fail(
			index,
			`Node "${sibling.id}" is the root and cannot anchor a sibling placement.`,
		);
	}
	return {
		parent: located.parent,
		at: op.before !== undefined ? located.index : located.index + 1,
	};
}

/** Resolve the placement and splice the node in. */
function attach(
	tree: BarkupNode,
	op: RawOp,
	index: number,
	node: BarkupNode,
): PatchIssue | null {
	const placement = resolvePlacement(tree, op, index);
	if (!("parent" in placement)) return placement;
	const children = placement.parent.children ?? [];
	children.splice(placement.at, 0, node);
	placement.parent.children = children;
	return null;
}

function detach(tree: BarkupNode, id: string, index: number): PatchIssue | null {
	const located = findParent(tree, id);
	if (!located) {
		return fail(index, `No node with id "${id}".`);
	}
	located.parent.children?.splice(located.index, 1);
	if (located.parent.children?.length === 0) {
		delete located.parent.children;
	}
	return null;
}

const OP_HANDLERS: Record<
	string,
	(tree: BarkupNode, op: RawOp, i: number) => PatchIssue | null
> = {
	"set-attribute": applySetAttribute,
	"remove-attribute": applyRemoveAttribute,
	"set-name": applySetName,
	remove: applyRemove,
	insert: applyInsert,
	move: applyMove,
};

function applyOp(tree: BarkupNode, op: RawOp, i: number): PatchIssue | null {
	if (op === null || typeof op !== "object" || Array.isArray(op)) {
		return fail(i, "each operation must be an object.");
	}
	const handler =
		typeof op.op === "string" ? OP_HANDLERS[op.op] : undefined;
	if (!handler) {
		return fail(
			i,
			`unknown op "${String(op.op)}" — allowed: ${Object.keys(OP_HANDLERS).join(", ")}.`,
		);
	}
	return handler(tree, op, i);
}

function applySetAttribute(
	tree: BarkupNode,
	op: RawOp,
	i: number,
): PatchIssue | null {
	const node = mustNode(tree, op.id, i, "id");
	if (!("type" in node)) return node;
	if (typeof op.key !== "string") {
		return fail(i, '"key" must be a string.');
	}
	if (op.value === undefined) {
		return fail(i, '"value" is required.');
	}
	node.attributes = {
		...(node.attributes ?? {}),
		[op.key]: op.value as AttributeValue,
	};
	return null;
}

function applyRemoveAttribute(
	tree: BarkupNode,
	op: RawOp,
	i: number,
): PatchIssue | null {
	const node = mustNode(tree, op.id, i, "id");
	if (!("type" in node)) return node;
	if (typeof op.key !== "string" || !(op.key in (node.attributes ?? {}))) {
		return fail(
			i,
			`attribute "${String(op.key)}" is not present on node "${node.id}".`,
		);
	}
	if (node.attributes) {
		delete node.attributes[op.key];
		if (Object.keys(node.attributes).length === 0) {
			delete node.attributes;
		}
	}
	return null;
}

function applySetName(
	tree: BarkupNode,
	op: RawOp,
	i: number,
): PatchIssue | null {
	const node = mustNode(tree, op.id, i, "id");
	if (!("type" in node)) return node;
	if (typeof op.name !== "string") {
		return fail(i, '"name" must be a string.');
	}
	node.name = op.name;
	return null;
}

/** Resolve op.id to a node that is not the root (remove/move target). */
function mustNonRootNode(
	tree: BarkupNode,
	op: RawOp,
	i: number,
	verb: string,
): BarkupNode | PatchIssue {
	const node = mustNode(tree, op.id, i, "id");
	if (!("type" in node)) return node;
	if (node === tree) {
		return fail(i, `the root node cannot be ${verb}.`);
	}
	return node;
}

function applyRemove(tree: BarkupNode, op: RawOp, i: number): PatchIssue | null {
	const node = mustNonRootNode(tree, op, i, "removed");
	if (!("type" in node)) return node;
	return detach(tree, node.id as string, i);
}

function applyInsert(tree: BarkupNode, op: RawOp, i: number): PatchIssue | null {
	if (op.node === null || typeof op.node !== "object" || Array.isArray(op.node)) {
		return fail(i, '"node" must be a node object.');
	}
	let inserted: BarkupNode;
	try {
		inserted = jsonClone(op.node) as BarkupNode;
	} catch {
		return fail(i, '"node" must be a JSON-serializable node object.');
	}
	return attach(tree, op, i, inserted);
}

function applyMove(tree: BarkupNode, op: RawOp, i: number): PatchIssue | null {
	const node = mustNonRootNode(tree, op, i, "moved");
	if (!("type" in node)) return node;
	// The anchor may not be inside the moved subtree (or the node itself).
	const anchorId = op.before ?? op.after ?? op.parentId;
	if (anchorId === node.id || subtreeContainsId(node, anchorId)) {
		return fail(
			i,
			`Node "${node.id}" cannot be moved relative to itself or into its own subtree.`,
		);
	}
	const detached = detach(tree, node.id as string, i);
	if (detached) return detached;
	// Resolve placement AFTER detaching (before/after semantics).
	return attach(tree, op, i, node);
}
