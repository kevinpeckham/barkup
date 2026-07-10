/**
 * Property tests for focused views over randomly-generated
 * grammar-valid trees: every visible id exists in the tree, focus
 * nodes render expanded with complete ordered child lists, placeholder
 * and omission counts are honest, every visible id is patchable
 * against the full tree ("visible implies patchable"), rendering is
 * deterministic, and focusing every leaf reproduces build() exactly.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import type { RawElement, RawNode } from "../src/adapter.js";
import { applyAnchoredPatch } from "../src/patch.js";
import { treeArbitrary } from "../src/testing.js";
import type { BarkupNode } from "../src/types.js";
import type { ViewMode } from "../src/view.js";
import { renderView } from "../src/view.js";
import { adapter, DOC_CONFIG, docGrammar } from "./helpers.js";

const RUNS = 200;
const grammar = docGrammar();

/** treeArbitrary leaves some ids missing; views address by id, so
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

function findById(node: BarkupNode, id: string): BarkupNode | null {
	if (node.id === id) return node;
	for (const child of node.children ?? []) {
		const found = findById(child, id);
		if (found) return found;
	}
	return null;
}

function leafIds(tree: BarkupNode): string[] {
	return allNodes(tree)
		.filter((n) => (n.children ?? []).length === 0)
		.map((n) => n.id as string);
}

/** A rendered view plus the tree and focus that produced it. */
const viewArbitrary = fc
	.tuple(
		treeArbitrary(DOC_CONFIG),
		fc.array(fc.nat(), { minLength: 1, maxLength: 3 }),
		fc.constantFrom<ViewMode>("focused", "minimal"),
	)
	.map(([raw, picks, mode]) => {
		const tree = withIds(raw);
		const ids = allNodes(tree).map((n) => n.id as string);
		const focus = [...new Set(picks.map((p) => ids[p % ids.length] as string))];
		return { tree, focus, mode };
	});

/** Parse view HTML back into the adapter's raw (pre-grammar) tree —
 * a structural read of exactly what a model would see. */
function viewRoot(html: string): RawElement {
	const elements = adapter
		.parse(html)
		.filter((n): n is RawElement => n.kind === "element");
	expect(elements).toHaveLength(1);
	return elements[0] as RawElement;
}

function elementChildren(el: RawElement): RawElement[] {
	return el.children.filter(
		(n: RawNode): n is RawElement => n.kind === "element",
	);
}

function attr(el: RawElement, name: string): string | undefined {
	return el.attributes.find(([n]) => n === name)?.[1];
}

function walk(el: RawElement, visit: (el: RawElement) => void): void {
	visit(el);
	for (const child of elementChildren(el)) walk(child, visit);
}

const VIEW_ONLY_ATTRS = new Set([
	"data-type",
	"data-name",
	"id",
	"data-collapsed",
	"data-child-count",
]);

describe("focused views: honesty of everything visible", () => {
	test("visible ids are real; placeholder and omission counts match the tree", () => {
		fc.assert(
			fc.property(viewArbitrary, ({ tree, focus, mode }) => {
				const result = renderView(grammar, tree, { focus, mode });
				expect(result.ok).toBe(true);
				if (!result.ok) return;
				walk(viewRoot(result.html), (el) => {
					const id = attr(el, "id") as string;
					const node = findById(tree, id);
					// Every visible id exists in the tree.
					expect(node).not.toBeNull();
					if (!node) return;
					const realCount = (node.children ?? []).length;
					const shown = elementChildren(el);
					if (attr(el, "data-collapsed") !== undefined) {
						// Placeholder: childless, honest count, no grammar attributes.
						expect(attr(el, "data-collapsed")).toBe("true");
						expect(shown).toHaveLength(0);
						expect(attr(el, "data-child-count")).toBe(String(realCount));
						for (const [name] of el.attributes) {
							expect(VIEW_ONLY_ATTRS.has(name)).toBe(true);
						}
					} else {
						// Expanded: rendered + omitted children sum to the real count,
						// and rendered ids are the tree's child ids in document order.
						const omitted = Number(attr(el, "data-omitted-children") ?? "0");
						expect(shown.length + omitted).toBe(realCount);
						const realIds = (node.children ?? []).map((c) => c.id);
						const shownIds = shown.map((c) => attr(c, "id"));
						const shownSet = new Set(shownIds);
						expect(realIds.filter((i) => shownSet.has(i))).toEqual(shownIds);
					}
				});
			}),
			{ numRuns: RUNS },
		);
	});

	test("focus nodes render expanded with their complete child list in order", () => {
		fc.assert(
			fc.property(viewArbitrary, ({ tree, focus, mode }) => {
				const result = renderView(grammar, tree, { focus, mode });
				expect(result.ok).toBe(true);
				if (!result.ok) return;
				const focusSet = new Set(focus);
				walk(viewRoot(result.html), (el) => {
					const id = attr(el, "id") as string;
					if (!focusSet.has(id)) return;
					expect(attr(el, "data-collapsed")).toBeUndefined();
					expect(attr(el, "data-omitted-children")).toBeUndefined();
					const node = findById(tree, id) as BarkupNode;
					const shownIds = elementChildren(el).map((c) => attr(c, "id"));
					expect(shownIds).toEqual((node.children ?? []).map((c) => c.id));
				});
			}),
			{ numRuns: RUNS },
		);
	});
});

describe("focused views: visible implies patchable", () => {
	test("every visible id is a valid anchored-patch target on the full tree", () => {
		fc.assert(
			fc.property(viewArbitrary, ({ tree, focus, mode }) => {
				const result = renderView(grammar, tree, { focus, mode });
				expect(result.ok).toBe(true);
				if (!result.ok) return;
				walk(viewRoot(result.html), (el) => {
					const id = attr(el, "id") as string;
					const patched = applyAnchoredPatch(grammar, tree, [
						{ op: "set-name", id, name: "probe" },
					]);
					expect(patched.ok).toBe(true);
				});
			}),
			{ numRuns: RUNS },
		);
	});
});

describe("focused views: determinism and parity", () => {
	test("rendering is deterministic and never mutates the input", () => {
		fc.assert(
			fc.property(viewArbitrary, ({ tree, focus, mode }) => {
				const before = JSON.stringify(tree);
				const a = renderView(grammar, tree, { focus, mode });
				const b = renderView(grammar, tree, { focus, mode });
				expect(a).toEqual(b);
				expect(JSON.stringify(tree)).toBe(before);
			}),
			{ numRuns: RUNS },
		);
	});

	test("focusing every leaf reproduces build() byte-for-byte", () => {
		fc.assert(
			fc.property(
				treeArbitrary(DOC_CONFIG),
				fc.constantFrom<ViewMode>("focused", "minimal"),
				(raw, mode) => {
					const tree = withIds(raw);
					const result = renderView(grammar, tree, {
						focus: leafIds(tree),
						mode,
					});
					expect(result.ok).toBe(true);
					if (!result.ok) return;
					expect(result.html).toBe(grammar.build(tree));
				},
			),
			{ numRuns: RUNS },
		);
	});
});
