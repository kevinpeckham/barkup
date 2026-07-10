/**
 * Unit tests for focused views (barkup/view): the validated contract
 * — spine rendering, placeholder shape, honest counts, both modes —
 * plus every failure mode (unknown focus ids, reserved-attribute
 * collisions, malformed focus) and the reserved prompt block.
 */
import { describe, expect, test } from "bun:test";
import type { BarkupNode } from "../src/types.js";
import { BarkupError } from "../src/types.js";
import { renderView, VIEW_PROMPT_RULES } from "../src/view.js";
import { DOC_CONFIG, docGrammar } from "./helpers.js";

const grammar = docGrammar({ roots: ["document"] });

/** The conformance-vector base tree (barkup-bench BASE). */
function baseTree(): BarkupNode {
	return {
		type: "document",
		id: "d1",
		attributes: { title: "Vectors" },
		children: [
			{
				type: "page",
				id: "p1",
				name: "intro",
				attributes: { layoutSize: "narrow" },
				children: [
					{
						type: "block",
						id: "b1",
						children: [
							{
								type: "text-atom",
								id: "t1",
								attributes: { maxLength: 80, content: "Hi." },
							},
							{ type: "image-atom", id: "i1" },
						],
					},
					{
						type: "widget-slot",
						id: "w1",
						attributes: { allowedWidgetIds: ["a", "b"] },
					},
				],
			},
			{ type: "page", id: "p2" },
		],
	};
}

describe("renderView: the contract", () => {
	test("minimal is the default mode", () => {
		const tree = baseTree();
		const explicit = renderView(grammar, tree, {
			focus: ["t1"],
			mode: "minimal",
		});
		const implicit = renderView(grammar, tree, { focus: ["t1"] });
		expect(implicit).toEqual(explicit);
	});

	test("the spine renders fully — type, name, id, attributes", () => {
		const result = renderView(grammar, baseTree(), { focus: ["t1"] });
		if (!result.ok) throw new Error("expected ok");
		expect(result.html).toContain(
			'<div data-type="text-atom" id="t1" data-max-length="80" data-content="Hi."></div>',
		);
		expect(result.html).toContain(
			'<section data-type="page" data-name="intro" id="p1" data-layout-size="narrow"',
		);
	});

	test("focused mode: every non-spine child of a spine node is a placeholder", () => {
		const result = renderView(grammar, baseTree(), {
			focus: ["t1"],
			mode: "focused",
		});
		if (!result.ok) throw new Error("expected ok");
		expect(result.html).toContain(
			'<div data-type="image-atom" id="i1" data-collapsed="true" data-child-count="0"></div>',
		);
		expect(result.html).toContain(
			'<div data-type="widget-slot" id="w1" data-collapsed="true" data-child-count="0"></div>',
		);
		expect(result.html).toContain(
			'<section data-type="page" id="p2" data-collapsed="true" data-child-count="0"></section>',
		);
		expect(result.html).not.toContain("data-omitted-children");
	});

	test("placeholders carry no grammar attributes", () => {
		// w1 has allowedWidgetIds in the tree; as a placeholder it must not.
		const result = renderView(grammar, baseTree(), {
			focus: ["t1"],
			mode: "focused",
		});
		if (!result.ok) throw new Error("expected ok");
		expect(result.html).not.toContain("data-allowed-widget-ids");
	});

	test("minimal mode: non-spine children are omitted with an honest count", () => {
		const result = renderView(grammar, baseTree(), { focus: ["t1"] });
		if (!result.ok) throw new Error("expected ok");
		// d1 has 2 children; p1 (spine) renders, p2 is omitted.
		expect(result.html).toContain(
			'<div data-type="document" id="d1" data-title="Vectors" data-omitted-children="1">',
		);
		expect(result.html).not.toContain('id="p2"');
		expect(result.html).not.toContain('id="w1"');
		expect(result.html).not.toContain("data-collapsed");
	});

	test("children of a focus node always appear, in document order", () => {
		const result = renderView(grammar, baseTree(), { focus: ["b1"] });
		if (!result.ok) throw new Error("expected ok");
		// b1 is the focus: both children are placeholders even in minimal.
		const t1 = result.html.indexOf('id="t1"');
		const i1 = result.html.indexOf('id="i1"');
		expect(t1).toBeGreaterThan(-1);
		expect(i1).toBeGreaterThan(t1);
		expect(result.html).toContain(
			'<div data-type="text-atom" id="t1" data-collapsed="true" data-child-count="0"></div>',
		);
	});

	test("placeholder child counts are the real child counts", () => {
		// Focus the root: p1 (2 children) and p2 (0) become placeholders.
		const result = renderView(grammar, baseTree(), { focus: ["d1"] });
		if (!result.ok) throw new Error("expected ok");
		expect(result.html).toContain(
			'<section data-type="page" data-name="intro" id="p1" data-collapsed="true" data-child-count="2"></section>',
		);
		expect(result.html).toContain(
			'<section data-type="page" id="p2" data-collapsed="true" data-child-count="0"></section>',
		);
	});

	test("multi-focus renders every spine", () => {
		const result = renderView(grammar, baseTree(), { focus: ["t1", "p2"] });
		if (!result.ok) throw new Error("expected ok");
		expect(result.html).toContain('id="t1" data-max-length="80"');
		expect(result.html).toContain('<section data-type="page" id="p2"');
		expect(result.html).not.toContain('id="p2" data-collapsed');
	});

	test("empty focus renders the root shell", () => {
		const result = renderView(grammar, baseTree(), { focus: [] });
		if (!result.ok) throw new Error("expected ok");
		expect(result.html).toContain('data-omitted-children="2"');
		expect(result.html).not.toContain('id="p1"');
	});

	test("focus on every leaf reproduces build() byte-for-byte", () => {
		const tree = baseTree();
		const result = renderView(grammar, tree, {
			focus: ["t1", "i1", "w1", "p2"],
		});
		if (!result.ok) throw new Error("expected ok");
		expect(result.html).toBe(grammar.build(tree));
	});

	test("the input tree is never mutated", () => {
		const tree = baseTree();
		const before = JSON.stringify(tree);
		renderView(grammar, tree, { focus: ["t1"], mode: "focused" });
		renderView(grammar, tree, { focus: ["t1"], mode: "minimal" });
		expect(JSON.stringify(tree)).toBe(before);
	});

	test("rendering is deterministic", () => {
		const a = renderView(grammar, baseTree(), { focus: ["t1", "p2"] });
		const b = renderView(grammar, baseTree(), { focus: ["t1", "p2"] });
		expect(a).toEqual(b);
	});

	test("a view is a prompt artifact, not parse() input", () => {
		// Placeholders omit required attributes and carry view-only
		// data-* attributes the base grammar does not declare.
		const result = renderView(grammar, baseTree(), { focus: ["b1"] });
		if (!result.ok) throw new Error("expected ok");
		const parsed = grammar.parse(result.html);
		expect(parsed.ok).toBe(false);
	});
});

describe("renderView: failure modes", () => {
	test("unknown focus id is a structured issue, never silently ignored", () => {
		const result = renderView(grammar, baseTree(), { focus: ["zzz"] });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]?.code).toBe("invalid-view");
		expect(result.issues[0]?.message).toContain('"zzz"');
		expect(result.issues[0]?.nodeId).toBe("zzz");
	});

	test("every unknown focus id gets its own issue", () => {
		const result = renderView(grammar, baseTree(), {
			focus: ["zzz", "t1", "yyy"],
		});
		if (result.ok) throw new Error("expected issues");
		expect(result.issues.map((i) => i.nodeId)).toEqual(["zzz", "yyy"]);
	});

	test("focus must be an array of id strings", () => {
		const bad = renderView(grammar, baseTree(), {
			focus: "t1" as unknown as string[],
		});
		expect(bad.ok).toBe(false);
		const mixed = renderView(grammar, baseTree(), {
			focus: ["t1", 7 as unknown as string],
		});
		expect(mixed.ok).toBe(false);
		if (mixed.ok) throw new Error("unreachable");
		expect(mixed.issues[0]?.code).toBe("invalid-view");
	});

	test("a grammar declaring a reserved view attribute is rejected per collision", () => {
		const clashing = docGrammar({
			roots: ["document"],
			nodes: {
				...DOC_CONFIG.nodes,
				block: {
					...DOC_CONFIG.nodes.block,
					attributes: {
						...DOC_CONFIG.nodes.block?.attributes,
						collapsed: { type: "boolean" },
					},
				},
				page: {
					...DOC_CONFIG.nodes.page,
					attributes: {
						...DOC_CONFIG.nodes.page?.attributes,
						childCount: { type: "number" },
					},
				},
			},
		});
		const result = renderView(clashing, baseTree(), { focus: ["t1"] });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.issues).toHaveLength(2);
		for (const issue of result.issues) {
			expect(issue.code).toBe("invalid-view");
		}
		expect(result.issues.map((i) => i.attribute).sort()).toEqual([
			"childCount",
			"collapsed",
		]);
		expect(result.issues[0]?.message).toContain("reserved");
	});

	test("a tree carrying a reserved attribute key is rejected", () => {
		// Undeclared attributes survive under the "string" policy — the
		// tree-level check catches what the grammar-level check cannot.
		const lenient = docGrammar({
			roots: ["document"],
			unknownAttributes: "string",
		});
		const tree = baseTree();
		const b1 = tree.children?.[0]?.children?.[0] as BarkupNode;
		b1.attributes = { ...(b1.attributes ?? {}), omittedChildren: "3" };
		const result = renderView(lenient, tree, { focus: ["t1"] });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.issues[0]?.code).toBe("invalid-view");
		expect(result.issues[0]?.attribute).toBe("omittedChildren");
		expect(result.issues[0]?.nodeId).toBe("b1");
		expect(result.issues[0]?.path).toContain("block");
	});

	test("an unknown mode throws — tree side, programmer error", () => {
		expect(() =>
			renderView(grammar, baseTree(), {
				focus: ["t1"],
				mode: "compact" as unknown as "minimal",
			}),
		).toThrow(BarkupError);
	});
});

describe("VIEW_PROMPT_RULES", () => {
	test("is the exact pre-registered wording from barkup-bench BRIEF-J", () => {
		expect(VIEW_PROMPT_RULES).toBe(`View rules:
- You are shown a focused view of the tree, not the whole tree. The view is centered on the nodes the edit request references. Your patch is applied to the full tree, where every hidden node still exists.
- An element with data-collapsed="true" is a real node shown without its contents; data-child-count is how many children it actually has.
- An element with data-omitted-children="N" has N additional children that are not shown at all.
- Every visible id is a valid patch target. Never use an id that is not visible in the view.
- Give every node you create a fresh id unlikely to exist anywhere in the full tree (e.g. with a random-looking suffix); if it collides with a hidden node's id, the patch is rejected with a duplicate-id issue and you can correct it.`);
	});

	test("has exactly five bullets", () => {
		const bullets = VIEW_PROMPT_RULES.split("\n").filter((line) =>
			line.startsWith("- "),
		);
		expect(bullets).toHaveLength(5);
	});
});
