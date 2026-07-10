/**
 * Unit tests for deterministic selection (barkup/view): the
 * benchmark-ported enumeration contract — the {type, within} cases
 * from barkup-bench's fanoutTargets suite — plus AND semantics,
 * strict-descendant scoping, the unknown-within empty result,
 * attribute deep-equality (primitives strict, json values structural,
 * object key order ignored, array order significant), the empty
 * query, document-order (pre-order) results, id-less skipping,
 * determinism, and input immutability.
 */
import { describe, expect, test } from "bun:test";
import type { BarkupNode } from "../src/types.js";
import { selectNodes } from "../src/view.js";

/** The benchmark's fan-out test tree (barkup-bench tests/fanout.test.ts),
 * extended with a nested block, a widget-slot carrying json values, and
 * an id-less node — the cases selectNodes adds over fanoutTargets. */
function selectTree(): BarkupNode {
	return {
		type: "document",
		id: "doc",
		children: [
			{
				type: "page",
				id: "p1",
				name: "intro",
				children: [
					{
						type: "block",
						id: "b1",
						name: "gallery",
						children: [
							{ type: "image-atom", id: "i1", attributes: { src: "a.webp" } },
							{ type: "image-atom", id: "i2" },
							{
								type: "text-atom",
								id: "t1",
								name: "hero",
								attributes: { maxLength: 40, textStyle: "serif" },
							},
							{
								type: "block",
								id: "b3",
								children: [
									{
										type: "text-atom",
										id: "t2",
										attributes: { maxLength: 40 },
									},
								],
							},
						],
					},
					{ type: "block", id: "b2", name: "gallery" },
					{
						type: "widget-slot",
						id: "w1",
						attributes: {
							allowedWidgetIds: ["a", "b"],
							requireBleed: true,
						},
					},
					{
						type: "widget-slot",
						id: "w2",
						attributes: {
							allowedWidgetIds: { primary: "a", fallback: ["b", "c"] },
						},
					},
				],
			},
			{ type: "page", id: "p2", name: "atlas" },
		],
	};
}

describe("selectNodes: the benched {type, within} enumeration", () => {
	test("targets are strict descendants of the anchor, in document order", () => {
		// The fanoutTargets cases from barkup-bench tests/fanout.test.ts.
		expect(selectNodes(selectTree(), { type: "image-atom", within: "b1" })) //
			.toEqual(["i1", "i2"]);
		expect(selectNodes(selectTree(), { type: "block", within: "doc" })) //
			.toEqual(["b1", "b3", "b2"]);
		expect(selectNodes(selectTree(), { type: "page", within: "b1" })) //
			.toEqual([]);
	});

	test("the anchor itself never matches, even when it fits the query", () => {
		// b1 is a block; only its strict block descendant comes back.
		expect(selectNodes(selectTree(), { type: "block", within: "b1" })) //
			.toEqual(["b3"]);
	});

	test("an unknown within id selects nothing — data, not an error", () => {
		expect(selectNodes(selectTree(), { type: "block", within: "gone" })) //
			.toEqual([]);
		expect(selectNodes(selectTree(), { within: "gone" })).toEqual([]);
	});

	test("within a leaf (no descendants) selects nothing", () => {
		expect(selectNodes(selectTree(), { within: "i1" })).toEqual([]);
	});
});

describe("selectNodes: AND semantics", () => {
	test("all present criteria must hold at once", () => {
		const tree = selectTree();
		// Each criterion alone matches more than the conjunction.
		expect(selectNodes(tree, { type: "block" })).toEqual(["b1", "b3", "b2"]);
		expect(selectNodes(tree, { name: "gallery" })).toEqual(["b1", "b2"]);
		expect(selectNodes(tree, { type: "block", name: "gallery", within: "b1" })) //
			.toEqual([]);
		expect(
			selectNodes(tree, { type: "text-atom", attributes: { maxLength: 40 } }),
		).toEqual(["t1", "t2"]);
		expect(
			selectNodes(tree, {
				type: "text-atom",
				name: "hero",
				attributes: { maxLength: 40 },
				within: "b1",
			}),
		).toEqual(["t1"]);
	});

	test("name matches exactly", () => {
		expect(selectNodes(selectTree(), { name: "atlas" })).toEqual(["p2"]);
		expect(selectNodes(selectTree(), { name: "atla" })).toEqual([]);
		// A name criterion never matches nodes without a name.
		expect(selectNodes(selectTree(), { name: "" })).toEqual([]);
	});

	test("the empty query matches every id-bearing node, in document order", () => {
		expect(selectNodes(selectTree(), {})).toEqual([
			"doc",
			"p1",
			"b1",
			"i1",
			"i2",
			"t1",
			"b3",
			"t2",
			"b2",
			"w1",
			"w2",
			"p2",
		]);
	});
});

describe("selectNodes: attribute equality", () => {
	test("every listed attribute must be present and deep-equal", () => {
		const tree = selectTree();
		expect(selectNodes(tree, { attributes: { maxLength: 40 } })) //
			.toEqual(["t1", "t2"]);
		expect(
			selectNodes(tree, { attributes: { maxLength: 40, textStyle: "serif" } }),
		).toEqual(["t1"]);
		// A key the node lacks never matches.
		expect(selectNodes(tree, { attributes: { theme: "dark" } })).toEqual([]);
	});

	test("primitives compare strictly — declared coercion only, as everywhere", () => {
		const tree = selectTree();
		expect(selectNodes(tree, { attributes: { maxLength: "40" } })).toEqual([]);
		expect(selectNodes(tree, { attributes: { requireBleed: true } })) //
			.toEqual(["w1"]);
		expect(selectNodes(tree, { attributes: { requireBleed: "true" } })) //
			.toEqual([]);
	});

	test("json arrays compare element-wise, order significant", () => {
		const tree = selectTree();
		expect(selectNodes(tree, { attributes: { allowedWidgetIds: ["a", "b"] } })) //
			.toEqual(["w1"]);
		expect(selectNodes(tree, { attributes: { allowedWidgetIds: ["b", "a"] } })) //
			.toEqual([]);
		expect(selectNodes(tree, { attributes: { allowedWidgetIds: ["a"] } })) //
			.toEqual([]);
	});

	test("json objects compare by key set — key order is not significant", () => {
		const tree = selectTree();
		expect(
			selectNodes(tree, {
				attributes: {
					allowedWidgetIds: { fallback: ["b", "c"], primary: "a" },
				},
			}),
		).toEqual(["w2"]);
		expect(
			selectNodes(tree, {
				attributes: { allowedWidgetIds: { primary: "a" } },
			}),
		).toEqual([]);
	});
});

describe("selectNodes: order, ids, and hygiene", () => {
	test("results are depth-first pre-order, not breadth-first", () => {
		// Pre-order puts b1's nested b3 before the later sibling b2;
		// the benchmark's BFS walk would have returned [b1, b2, b3].
		expect(selectNodes(selectTree(), { type: "block" })) //
			.toEqual(["b1", "b3", "b2"]);
	});

	test("nodes without ids are skipped, their subtrees still walked", () => {
		const tree = selectTree();
		const b1 = tree.children?.[0]?.children?.[0] as BarkupNode;
		delete b1.id;
		expect(selectNodes(tree, { type: "block" })).toEqual(["b3", "b2"]);
		// The id-less node's descendants still match.
		expect(selectNodes(tree, { type: "image-atom" })).toEqual(["i1", "i2"]);
	});

	test("selection is deterministic and never mutates the input", () => {
		const tree = selectTree();
		const before = JSON.stringify(tree);
		const query = { type: "text-atom", within: "p1" } as const;
		expect(selectNodes(tree, query)).toEqual(selectNodes(tree, query));
		expect(JSON.stringify(tree)).toBe(before);
	});
});
