/**
 * Property tests for content search over randomly-generated
 * grammar-valid trees, checked against an independent re-scoring:
 * every returned id exists and shares a token with the query, results
 * are distinct, capped, and ordered by score-then-document-order,
 * search is deterministic and never mutates the input, and the
 * renderSearch composition is exactly findNodes piped into renderView
 * (null only on a true miss, every match visible in the html).
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import { treeArbitrary } from "../src/testing.js";
import type { BarkupNode } from "../src/types.js";
import { findNodes, renderSearch, renderView } from "../src/view.js";
import { DOC_CONFIG, docGrammar } from "./helpers.js";

const RUNS = 200;
const grammar = docGrammar();

/** treeArbitrary leaves some ids missing; search skips id-less nodes,
 * so fill them (uniquely, away from its `n0…` namespace) like format()
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

// --- Independent re-scoring oracle (deliberately re-implemented) ----------

function oracleTokens(text: string): Set<string> {
	return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function oracleText(node: BarkupNode): string {
	const attrs = Object.entries(node.attributes ?? {})
		.map(([key, value]) => `${key} ${JSON.stringify(value)}`)
		.join(" ");
	return `${node.type} ${node.name ?? ""} ${attrs}`;
}

function oracleScore(node: BarkupNode, query: string): number {
	const wanted = oracleTokens(query);
	let score = 0;
	for (const token of oracleTokens(oracleText(node))) {
		if (wanted.has(token)) score += 1;
	}
	return score;
}

/** Depth-first pre-order nodes — document order. */
function allNodes(node: BarkupNode): BarkupNode[] {
	return [node, ...(node.children ?? []).flatMap(allNodes)];
}

function findById(tree: BarkupNode, id: string): BarkupNode | null {
	return allNodes(tree).find((node) => node.id === id) ?? null;
}

/** Queries mix words the doc grammar's trees actually contain with
 * noise, numbers, and punctuation the tokenizer must shrug off. */
const queryArbitrary = fc
	.array(
		fc.constantFrom(
			"document",
			"page",
			"block",
			"text",
			"atom",
			"widget",
			"slot",
			"image",
			"title",
			"maxLength",
			"content",
			"featured",
			"true",
			"n1",
			"n2",
			"3",
			"zzz",
			"!!!",
		),
		{ minLength: 0, maxLength: 6 },
	)
	.map((words) => words.join(" "));

const searchArbitrary = fc
	.tuple(
		treeArbitrary(DOC_CONFIG),
		queryArbitrary,
		fc.integer({ min: 1, max: 8 }),
	)
	.map(([raw, query, limit]) => ({ tree: withIds(raw), query, limit }));

describe("findNodes: agreement with an independent re-scoring", () => {
	test("results are real, relevant, distinct, capped, and rank-ordered", () => {
		fc.assert(
			fc.property(searchArbitrary, ({ tree, query, limit }) => {
				const ids = findNodes(tree, query, { limit });
				expect(ids.length).toBeLessThanOrEqual(limit);
				expect(new Set(ids).size).toBe(ids.length);
				const order = allNodes(tree).map((node) => node.id);
				let previousScore = Number.POSITIVE_INFINITY;
				let previousOrder = -1;
				for (const id of ids) {
					const node = findById(tree, id);
					expect(node).not.toBeNull();
					if (!node) return;
					const score = oracleScore(node, query);
					expect(score).toBeGreaterThan(0);
					// Non-increasing score; ties strictly in document order.
					expect(score).toBeLessThanOrEqual(previousScore);
					const position = order.indexOf(id);
					if (score === previousScore) {
						expect(position).toBeGreaterThan(previousOrder);
					}
					previousScore = score;
					previousOrder = position;
				}
			}),
			{ numRuns: RUNS },
		);
	});

	test("nothing relevant is left out of an unfilled result", () => {
		fc.assert(
			fc.property(searchArbitrary, ({ tree, query, limit }) => {
				const ids = new Set(findNodes(tree, query, { limit }));
				if (ids.size >= limit) return;
				// The result had room: every positive-scoring id must be in it.
				for (const node of allNodes(tree)) {
					if (node.id !== undefined && oracleScore(node, query) > 0) {
						expect(ids.has(node.id)).toBe(true);
					}
				}
			}),
			{ numRuns: RUNS },
		);
	});

	test("search is deterministic and never mutates the input", () => {
		fc.assert(
			fc.property(searchArbitrary, ({ tree, query, limit }) => {
				const before = JSON.stringify(tree);
				const a = findNodes(tree, query, { limit });
				const b = findNodes(tree, query, { limit });
				expect(a).toEqual(b);
				expect(JSON.stringify(tree)).toBe(before);
			}),
			{ numRuns: RUNS },
		);
	});
});

describe("renderSearch: the composition, at scale", () => {
	test("null exactly on a miss; otherwise renderView on the found ids", () => {
		fc.assert(
			fc.property(searchArbitrary, ({ tree, query, limit }) => {
				const ids = findNodes(tree, query, { limit });
				const result = renderSearch(grammar, tree, query, { limit });
				if (ids.length === 0) {
					expect(result).toBeNull();
					return;
				}
				expect(result).toEqual(
					renderView(grammar, tree, { focus: ids, mode: "minimal" }),
				);
				if (!result?.ok) throw new Error("expected ok");
				// Every match is visible — and therefore patchable.
				for (const id of ids) {
					expect(result.html).toContain(`id="${id}"`);
				}
			}),
			{ numRuns: RUNS },
		);
	});
});
