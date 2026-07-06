/**
 * Unit tests for anchored patches — every op and every failure mode,
 * ported from the benchmark's reference suite (barkup-bench
 * tests/condition-f.test.ts) and adapted to barkup's own validate().
 */
import { describe, expect, test } from "bun:test";
import { applyAnchoredPatch } from "../src/patch.js";
import type { BarkupNode } from "../src/types.js";
import { docGrammar } from "./helpers.js";

const grammar = docGrammar();

const tree: BarkupNode = {
	type: "document",
	id: "d1",
	attributes: { title: "T" },
	children: [
		{
			type: "page",
			id: "p1",
			children: [
				{
					type: "block",
					id: "b1",
					children: [
						{ type: "text-atom", id: "t1", attributes: { maxLength: 80 } },
						{ type: "image-atom", id: "i1" },
					],
				},
				{ type: "widget-slot", id: "w1" },
			],
		},
		{ type: "page", id: "p2" },
	],
};

function apply(ops: unknown) {
	return applyAnchoredPatch(grammar, tree, ops);
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

describe("applyAnchoredPatch — attribute and name ops", () => {
	test("set-attribute / set-name / remove-attribute", () => {
		const result = apply([
			{ op: "set-attribute", id: "t1", key: "content", value: "Hi." },
			{ op: "set-name", id: "b1", name: "hero" },
			{ op: "remove-attribute", id: "t1", key: "content" },
			{ op: "set-attribute", id: "t1", key: "content", value: "Bye." },
		]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(findById(result.node, "t1")?.attributes?.content).toBe("Bye.");
			expect(findById(result.node, "b1")?.name).toBe("hero");
		}
	});

	test("empty patch is a valid no-op returning the normalized tree", () => {
		const result = apply([]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.node).toEqual(tree);
		}
	});
});

describe("applyAnchoredPatch — structural ops", () => {
	test("insert before / after / append via parentId", () => {
		const result = apply([
			{ op: "insert", node: { type: "widget-slot", id: "w2" }, before: "b1" },
			{ op: "insert", node: { type: "block", id: "b2" }, after: "w1" },
			{
				op: "insert",
				node: { type: "text-atom", id: "t2", attributes: { maxLength: 5 } },
				parentId: "b1",
			},
		]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const p1 = findById(result.node, "p1") as BarkupNode;
			expect((p1.children ?? []).map((c) => c.id)).toEqual([
				"w2",
				"b1",
				"w1",
				"b2",
			]);
			const b1 = findById(result.node, "b1") as BarkupNode;
			expect((b1.children ?? []).map((c) => c.id)).toEqual(["t1", "i1", "t2"]);
		}
	});

	test("move with sibling anchors and cross-parent append", () => {
		const result = apply([
			{ op: "move", id: "i1", before: "t1" },
			{ op: "move", id: "b1", parentId: "p2" },
		]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const b1 = findById(result.node, "b1") as BarkupNode;
			expect((b1.children ?? []).map((c) => c.id)).toEqual(["i1", "t1"]);
			expect(parentOf(result.node, "b1")?.id).toBe("p2");
		}
	});

	test("remove drops the subtree", () => {
		const result = apply([{ op: "remove", id: "b1" }]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(findById(result.node, "t1")).toBeNull();
			expect(findById(result.node, "w1")).not.toBeNull();
		}
	});
});

describe("applyAnchoredPatch — op-level failures", () => {
	test("stale id names the operation and carries opIndex", () => {
		const result = apply([
			{ op: "set-name", id: "p1", name: "ok" },
			{ op: "set-attribute", id: "zzz", key: "title", value: "x" },
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues[0]?.code).toBe("invalid-patch");
			expect(result.issues[0]?.message).toContain("Operation 1");
			expect(result.issues[0]?.message).toContain('"zzz"');
			expect(result.issues[0]?.opIndex).toBe(1);
			expect(result.issues[0]?.path).toBe("(patch op 1)");
		}
	});

	test("non-array patch and non-object operations rejected", () => {
		expect(apply({ op: "remove", id: "b1" }).ok).toBe(false);
		expect(apply("[]").ok).toBe(false);
		expect(apply([null]).ok).toBe(false);
		expect(apply([[{ op: "remove", id: "b1" }]]).ok).toBe(false);
	});

	test("malformed fields rejected: key, value, name, node", () => {
		expect(apply([{ op: "set-attribute", id: "t1", value: "x" }]).ok).toBe(
			false,
		);
		expect(apply([{ op: "set-attribute", id: "t1", key: "content" }]).ok).toBe(
			false,
		);
		expect(apply([{ op: "set-name", id: "b1", name: 7 }]).ok).toBe(false);
		expect(apply([{ op: "insert", node: "block", parentId: "p2" }]).ok).toBe(
			false,
		);
	});

	test("remove-attribute on an absent attribute rejected", () => {
		const result = apply([{ op: "remove-attribute", id: "t1", key: "content" }]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues[0]?.message).toContain('"content"');
		}
	});

	test("unknown op rejected with the allowed list", () => {
		const result = apply([{ op: "replace", id: "t1" }]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.issues[0]?.message).toContain("allowed:");
	});
});

describe("applyAnchoredPatch — placement and guard failures", () => {
	test("ambiguous or missing placement anchors rejected", () => {
		expect(
			apply([
				{ op: "insert", node: { type: "page" }, before: "p1", parentId: "d1" },
			]).ok,
		).toBe(false);
		expect(apply([{ op: "insert", node: { type: "page" } }]).ok).toBe(false);
	});

	test("the root cannot anchor a sibling placement", () => {
		expect(
			apply([{ op: "insert", node: { type: "page" }, before: "d1" }]).ok,
		).toBe(false);
	});

	test("root guards and own-subtree moves rejected", () => {
		expect(apply([{ op: "remove", id: "d1" }]).ok).toBe(false);
		expect(apply([{ op: "move", id: "d1", parentId: "p2" }]).ok).toBe(false);
		expect(apply([{ op: "move", id: "p1", parentId: "b1" }]).ok).toBe(false);
		expect(apply([{ op: "move", id: "b1", after: "t1" }]).ok).toBe(false);
	});
});

describe("applyAnchoredPatch — post-apply validation and atomicity", () => {
	test("patched tree must pass validate(): containment", () => {
		const result = apply([
			{ op: "insert", node: { type: "page", id: "p9" }, parentId: "b1" },
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.some((i) => i.code === "invalid-child")).toBe(true);
		}
	});

	test("patched tree must pass validate(): value types and required attrs", () => {
		const badValue = apply([
			{ op: "set-attribute", id: "t1", key: "maxLength", value: "eighty" },
		]);
		expect(badValue.ok).toBe(false);
		if (!badValue.ok) {
			expect(
				badValue.issues.some((i) => i.code === "invalid-attribute-value"),
			).toBe(true);
		}
		const missing = apply([
			{ op: "remove-attribute", id: "t1", key: "maxLength" },
		]);
		expect(missing.ok).toBe(false);
		if (!missing.ok) {
			expect(missing.issues.some((i) => i.code === "missing-attribute")).toBe(
				true,
			);
		}
	});

	test("patched tree must pass validate(): duplicate ids", () => {
		const result = apply([
			{ op: "insert", node: { type: "page", id: "p1" }, parentId: "d1" },
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.some((i) => i.code === "duplicate-id")).toBe(true);
		}
	});

	test("base tree never mutated, even on multi-op failure", () => {
		const before = JSON.stringify(tree);
		apply([
			{ op: "remove", id: "w1" },
			{ op: "set-attribute", id: "zzz", key: "x", value: 1 },
		]);
		expect(JSON.stringify(tree)).toBe(before);
	});
});
