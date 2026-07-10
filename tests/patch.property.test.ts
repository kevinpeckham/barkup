/**
 * Property tests for anchored patches over randomly-generated
 * grammar-valid trees: atomicity, equivalence with direct programmatic
 * edits, id preservation for untouched nodes, and validity of every
 * accepted result.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import { normalizeNode } from "../src/index.js";
import { applyAnchoredPatch } from "../src/patch.js";
import { nodesEqual, treeArbitrary } from "../src/testing.js";
import type {
	AttributeValue,
	BarkupNode,
	GrammarConfig,
} from "../src/types.js";
import { DOC_CONFIG, docGrammar } from "./helpers.js";

const RUNS = 200;
const grammar = docGrammar();

/** treeArbitrary leaves some ids missing; patches address by id, so
 * fill them (uniquely, away from its `n0…` namespace) like format()
 * would. */
function withIds(tree: BarkupNode): BarkupNode {
	const clone = structuredClone(tree);
	let next = 0;
	const fill = (node: BarkupNode): void => {
		if (node.id === undefined) node.id = `fx${next++}`;
		for (const child of node.children ?? []) fill(child);
	};
	fill(clone);
	return clone;
}

function allNodes(node: BarkupNode): BarkupNode[] {
	return [node, ...(node.children ?? []).flatMap(allNodes)];
}

function collectIds(node: BarkupNode): string[] {
	return allNodes(node).map((n) => n.id as string);
}

function findById(node: BarkupNode, id: string): BarkupNode | null {
	if (node.id === id) return node;
	for (const child of node.children ?? []) {
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}

function parentOf(node: BarkupNode, id: string): BarkupNode | null {
	for (const child of node.children ?? []) {
		if (child.id === id) return node;
		const found = parentOf(child, id);
		if (found) return found;
	}
	return null;
}

const REQUIRED_VALUE: Record<string, AttributeValue> = {
	string: "x",
	number: 1,
	boolean: true,
	json: null,
};

/** Minimal grammar-valid node of the given type (required attrs set). */
function minimalNode(
	config: GrammarConfig,
	type: string,
	id: string,
): BarkupNode {
	const attributes: Record<string, AttributeValue> = {};
	for (const [key, spec] of Object.entries(
		config.nodes[type]?.attributes ?? {},
	)) {
		if (spec.required) {
			attributes[key] = REQUIRED_VALUE[spec.type] as AttributeValue;
		}
	}
	const node: BarkupNode = { type, id };
	if (Object.keys(attributes).length > 0) node.attributes = attributes;
	return node;
}

/** A grammar-valid value for the declared attribute type. */
function valueFor(type: string, seed: number): AttributeValue {
	switch (type) {
		case "number":
			return seed;
		case "boolean":
			return seed % 2 === 0;
		case "json":
			return { seed };
		default:
			return `v${seed}`;
	}
}

/** A single edit expressed BOTH as an anchored op and as a direct
 * programmatic mutation, so the two applications can be compared. */
interface Edit {
	op: Record<string, unknown>;
	direct: (t: BarkupNode) => void;
}

/** set-attribute: a declared attribute with a type-correct value. */
function editSetAttribute(node: BarkupNode, fieldPick: number): Edit | null {
	const id = node.id as string;
	const specs = Object.entries(DOC_CONFIG.nodes[node.type]?.attributes ?? {});
	if (specs.length === 0) return null;
	const [key, spec] = specs[fieldPick % specs.length] as [
		string,
		{ type: string },
	];
	const value = valueFor(spec.type, fieldPick);
	return {
		op: { op: "set-attribute", id, key, value },
		direct: (t) => {
			const target = findById(t, id) as BarkupNode;
			target.attributes = { ...(target.attributes ?? {}), [key]: value };
		},
	};
}

function editSetName(node: BarkupNode, fieldPick: number): Edit {
	const id = node.id as string;
	const name = `renamed-${fieldPick}`;
	return {
		op: { op: "set-name", id, name },
		direct: (t) => {
			(findById(t, id) as BarkupNode).name = name;
		},
	};
}

/** remove: any non-root node. */
function editRemove(tree: BarkupNode, node: BarkupNode): Edit | null {
	if (node === tree) return null;
	const id = node.id as string;
	return {
		op: { op: "remove", id },
		direct: (t) => {
			const parent = parentOf(t, id) as BarkupNode;
			parent.children = (parent.children ?? []).filter((c) => c.id !== id);
			if (parent.children.length === 0) delete parent.children;
		},
	};
}

/** insert: a fresh minimal child appended under a node that allows one. */
function editInsert(node: BarkupNode, fieldPick: number): Edit | null {
	const id = node.id as string;
	const allowed = DOC_CONFIG.nodes[node.type]?.children ?? [];
	if (allowed.length === 0) return null;
	const childType = allowed[fieldPick % allowed.length] as string;
	const fresh = minimalNode(DOC_CONFIG, childType, `ins-${fieldPick}`);
	return {
		op: { op: "insert", node: fresh, parentId: id },
		direct: (t) => {
			const parent = findById(t, id) as BarkupNode;
			parent.children = [...(parent.children ?? []), structuredClone(fresh)];
		},
	};
}

/** move: reorder a non-root node among its own siblings (containment
 * is preserved by construction). */
function editMove(
	tree: BarkupNode,
	node: BarkupNode,
	fieldPick: number,
): Edit | null {
	if (node === tree) return null;
	const id = node.id as string;
	const parent = parentOf(tree, id) as BarkupNode;
	const siblings = (parent.children ?? []).filter((c) => c.id !== id);
	if (siblings.length === 0) return null;
	const anchor = siblings[fieldPick % siblings.length] as BarkupNode;
	const before = fieldPick % 2 === 0;
	return {
		op: before
			? { op: "move", id, before: anchor.id }
			: { op: "move", id, after: anchor.id },
		direct: (t) => {
			const p = parentOf(t, id) as BarkupNode;
			const moved = (p.children ?? []).find((c) => c.id === id) as BarkupNode;
			const rest = (p.children ?? []).filter((c) => c.id !== id);
			const at = rest.findIndex((c) => c.id === anchor.id);
			rest.splice(before ? at : at + 1, 0, moved);
			p.children = rest;
		},
	};
}

/**
 * One random single edit; the five kinds mirror the benchmark's
 * transformation families. Returns null when the drawn kind is
 * impossible on the drawn tree (e.g. move on a single-node tree);
 * fast-check just draws again.
 */
function makeEdit(
	tree: BarkupNode,
	kindPick: number,
	nodePick: number,
	fieldPick: number,
): Edit | null {
	const nodes = allNodes(tree);
	const node = nodes[nodePick % nodes.length] as BarkupNode;
	switch (kindPick % 5) {
		case 0:
			return editSetAttribute(node, fieldPick);
		case 1:
			return editSetName(node, fieldPick);
		case 2:
			return editRemove(tree, node);
		case 3:
			return editInsert(node, fieldPick);
		default:
			return editMove(tree, node, fieldPick);
	}
}

const editArbitrary = fc
	.tuple(treeArbitrary(DOC_CONFIG), fc.nat(), fc.nat(), fc.nat())
	.map(([raw, kindPick, nodePick, fieldPick]) => {
		const tree = withIds(raw);
		return { tree, edit: makeEdit(tree, kindPick, nodePick, fieldPick) };
	})
	.filter((drawn) => drawn.edit !== null);

describe("anchored patches: atomicity", () => {
	test("a failing op at any position leaves the input byte-identical and returns ok: false", () => {
		fc.assert(
			fc.property(
				treeArbitrary(DOC_CONFIG),
				fc.nat(),
				fc.nat(),
				(raw, prefixPick, namePick) => {
					const tree = withIds(raw);
					const nodes = allNodes(tree);
					// A prefix of valid ops, then one guaranteed-stale id.
					const prefix = Array.from({ length: prefixPick % 3 }, (_, i) => ({
						op: "set-name",
						id: nodes[(namePick + i) % nodes.length]?.id,
						name: `n-${i}`,
					}));
					const ops = [
						...prefix,
						{ op: "set-name", id: "__no-such-id__", name: "x" },
						{ op: "remove", id: nodes[0]?.id },
					];
					const before = JSON.stringify(tree);
					const result = applyAnchoredPatch(grammar, tree, ops);
					expect(result.ok).toBe(false);
					if (!result.ok) {
						expect(result.issues[0]?.opIndex).toBe(prefix.length);
					}
					expect(JSON.stringify(tree)).toBe(before);
				},
			),
			{ numRuns: RUNS },
		);
	});
});

describe("anchored patches: equivalence with direct programmatic edits", () => {
	test("each of the five edit kinds, as an anchored op, produces the same tree", () => {
		fc.assert(
			fc.property(editArbitrary, ({ tree, edit }) => {
				if (!edit) return;
				const result = applyAnchoredPatch(grammar, tree, [edit.op]);
				expect(result.ok).toBe(true);
				if (!result.ok) return;
				const direct = structuredClone(tree);
				edit.direct(direct);
				expect(nodesEqual(result.node, normalizeNode(direct))).toBe(true);
			}),
			{ numRuns: RUNS },
		);
	});
});

describe("anchored patches: id preservation", () => {
	test("untouched nodes keep their ids byte-for-byte", () => {
		fc.assert(
			fc.property(editArbitrary, ({ tree, edit }) => {
				if (!edit) return;
				const before = new Set(collectIds(tree));
				const result = applyAnchoredPatch(grammar, tree, [edit.op]);
				expect(result.ok).toBe(true);
				if (!result.ok) return;
				const after = new Set(collectIds(result.node));
				const removedSubtree =
					edit.op.op === "remove"
						? new Set(
								collectIds(findById(tree, edit.op.id as string) as BarkupNode),
							)
						: new Set<string>();
				for (const id of before) {
					if (!removedSubtree.has(id)) {
						expect(after.has(id)).toBe(true);
					}
				}
			}),
			{ numRuns: RUNS },
		);
	});
});

describe("anchored patches: validity", () => {
	test("every ok: true result passes validate()", () => {
		fc.assert(
			fc.property(editArbitrary, ({ tree, edit }) => {
				if (!edit) return;
				const result = applyAnchoredPatch(grammar, tree, [edit.op]);
				expect(result.ok).toBe(true);
				if (result.ok) {
					expect(grammar.validate(result.node).ok).toBe(true);
				}
			}),
			{ numRuns: RUNS },
		);
	});
});
