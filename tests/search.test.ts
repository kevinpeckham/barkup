/**
 * Unit tests for content search (barkup/view): the benchmark-ported
 * scorer contract — distinct-token overlap, zero-score exclusion,
 * document-order ties, the limit cap, id-less skipping — plus the
 * renderSearch composition (in-place rendering, structured no-match
 * null, option passthrough, reserved-attribute failures) and the
 * exact wording of the search prompt block and miss message.
 */
import { describe, expect, test } from "bun:test";
import type { BarkupNode } from "../src/types.js";
import {
	findNodes,
	NO_MATCHES_MESSAGE,
	renderSearch,
	renderView,
	SEARCH_PROMPT_RULES,
} from "../src/view.js";
import { DOC_CONFIG, docGrammar } from "./helpers.js";

const grammar = docGrammar({ roots: ["document"] });

/** The benchmark's search-test tree (barkup-bench grounded-n suite),
 * adjusted to the doc grammar's containment. */
function searchTree(): BarkupNode {
	return {
		type: "document",
		id: "doc",
		attributes: { title: "T" },
		children: [
			{
				type: "page",
				id: "p1",
				name: "intro",
				children: [
					{
						type: "block",
						id: "b1",
						children: [
							{
								type: "text-atom",
								id: "t1",
								name: "hero",
								attributes: { maxLength: 80 },
							},
							{
								type: "text-atom",
								id: "t2",
								attributes: { maxLength: 41 },
							},
						],
					},
					{ type: "block", id: "b2" },
				],
			},
			{ type: "page", id: "p2", name: "atlas" },
		],
	};
}

describe("findNodes: the benched scorer", () => {
	test("finds a named node and ranks it first", () => {
		const ids = findNodes(searchTree(), "hero text-atom");
		expect(ids[0]).toBe("t1");
	});

	test("excludes zero-score nodes entirely", () => {
		expect(findNodes(searchTree(), "zzzz qqqq")).toEqual([]);
		// A narrow query returns only matching nodes, not doc-order filler.
		expect(findNodes(searchTree(), "atlas")).toEqual(["p2"]);
	});

	test("scores are distinct-token overlap, attributes included", () => {
		// {maxlength, 41}: t2 matches both tokens, t1 only "maxlength".
		const ids = findNodes(searchTree(), "maxLength 41");
		expect(ids).toEqual(["t2", "t1"]);
	});

	test("token repetition never scores twice", () => {
		const tree = searchTree();
		// b2 gains "hero hero hero" — still one distinct token, so the
		// earlier single-"hero" t1 stays ahead on the document-order tie.
		const b2 = tree.children?.[0]?.children?.[1] as BarkupNode;
		b2.attributes = { containerClasses: "hero hero hero" };
		const ids = findNodes(tree, "hero");
		expect(ids).toEqual(["t1", "b2"]);
	});

	test("caps at the limit with document-order ties", () => {
		const wide = findNodes(searchTree(), "page block text-atom document");
		expect(wide.length).toBeLessThanOrEqual(5);
		// Both pages score 1 on "page": earlier in document order first.
		expect(findNodes(searchTree(), "page")).toEqual(["p1", "p2"]);
	});

	test("limit is configurable and defaults to the benched 5", () => {
		const tree = searchTree();
		expect(findNodes(tree, "page block text-atom")).toHaveLength(5);
		expect(findNodes(tree, "page block text-atom", { limit: 2 })).toEqual(
			findNodes(tree, "page block text-atom").slice(0, 2),
		);
		expect(findNodes(tree, "page", { limit: 1 })).toEqual(["p1"]);
	});

	test("nodes without ids are skipped", () => {
		const tree = searchTree();
		const p2 = tree.children?.[1] as BarkupNode;
		delete p2.id;
		expect(findNodes(tree, "atlas")).toEqual([]);
	});

	test("an empty or non-alphanumeric query matches nothing", () => {
		expect(findNodes(searchTree(), "")).toEqual([]);
		expect(findNodes(searchTree(), "!!! ???")).toEqual([]);
	});
});

describe("renderSearch: the benched tool-result composition", () => {
	test("no matches returns null — retrieval data, not an issue", () => {
		expect(renderSearch(grammar, searchTree(), "zzzz")).toBeNull();
	});

	test("matches render in place with their ancestors visible", () => {
		const result = renderSearch(grammar, searchTree(), "hero");
		expect(result).not.toBeNull();
		if (!result?.ok) throw new Error("expected ok");
		expect(result.html).toContain('id="t1"');
		expect(result.html).toContain('id="b1"');
		expect(result.html).toContain('id="doc"');
	});

	test("is exactly renderView over findNodes, minimal mode", () => {
		const tree = searchTree();
		const query = "hero text-atom";
		expect(renderSearch(grammar, tree, query)).toEqual(
			renderView(grammar, tree, {
				focus: findNodes(tree, query),
				mode: "minimal",
			}),
		);
	});

	test("passes limit and mode through", () => {
		const tree = searchTree();
		const result = renderSearch(grammar, tree, "atlas hero", {
			limit: 1,
			mode: "focused",
		});
		expect(result).toEqual(
			renderView(grammar, tree, {
				focus: findNodes(tree, "atlas hero", { limit: 1 }),
				mode: "focused",
			}),
		);
	});

	test("view-input failures still surface as structured issues", () => {
		const clashing = docGrammar({
			roots: ["document"],
			nodes: {
				...DOC_CONFIG.nodes,
				page: {
					...DOC_CONFIG.nodes.page,
					attributes: {
						...DOC_CONFIG.nodes.page?.attributes,
						collapsed: { type: "boolean" },
					},
				},
			},
		});
		const result = renderSearch(clashing, searchTree(), "hero");
		expect(result).not.toBeNull();
		expect(result?.ok).toBe(false);
		if (!result || result.ok) throw new Error("unreachable");
		expect(result.issues[0]?.code).toBe("invalid-view");
	});
});

describe("the search prompt artifacts", () => {
	test("NO_MATCHES_MESSAGE is the exact benched miss text", () => {
		expect(NO_MATCHES_MESSAGE).toBe(
			"No nodes match that query. Try different words (node types, names, attribute values).",
		);
	});

	test("SEARCH_PROMPT_RULES is the benched wording, generalized like VIEW_PROMPT_RULES", () => {
		expect(SEARCH_PROMPT_RULES).toBe(`Search rules:
- You are shown a minimal view of the tree's root. Collapsed elements are real nodes shown without their contents; data-child-count is how many children each actually has.
- Call find_nodes with a few search words (names, types, attribute values) to retrieve the 5 best-matching nodes, shown in place in the tree with their ancestors. Search as many times as you need to locate the nodes the edit request concerns.
- When you have found them, reply with your patch as your final message. Every id you use must be one you have seen.`);
	});

	test("has exactly three bullets, names the tool, and drops the benchmark dialect", () => {
		const bullets = SEARCH_PROMPT_RULES.split("\n").filter((line) =>
			line.startsWith("- "),
		);
		expect(bullets).toHaveLength(3);
		expect(SEARCH_PROMPT_RULES).toContain("find_nodes");
		expect(SEARCH_PROMPT_RULES).not.toContain("anchored");
	});
});
