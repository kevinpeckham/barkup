/**
 * Property tests for deterministic selection over randomly-generated
 * grammar-valid trees, checked against an independent oracle: the
 * brief's core property — selectNodes output equals a filter over a
 * full depth-first pre-order walk, in walk order — plus within
 * strictness (no result is the anchor; every result is a strict
 * descendant), determinism, and input immutability. Queries are drawn
 * from the tree itself (real types, names, ids, and attribute sets,
 * including json values) mixed with misses, so both outcomes are
 * exercised.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import { treeArbitrary } from "../src/testing.js";
import type { AttributeValue, BarkupNode } from "../src/types.js";
import { type SelectQuery, selectNodes } from "../src/view.js";
import { DOC_CONFIG } from "./helpers.js";

const RUNS = 200;

/** treeArbitrary leaves some ids missing; selection skips id-less
 * nodes, so fill them (uniquely, away from its `n0…` namespace) like
 * format() would. */
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

// --- Independent oracle (deliberately re-implemented) ----------------------

/** Depth-first pre-order nodes — document order. */
function allNodes(node: BarkupNode): BarkupNode[] {
	return [node, ...(node.children ?? []).flatMap(allNodes)];
}

/** Canonical JSON with object keys sorted recursively, so equality
 * ignores object key order without sharing the shipped comparator. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(canonical).join(",")}]`;
	}
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`);
		return `{${entries.join(",")}}`;
	}
	return JSON.stringify(value);
}

function oracleMatches(node: BarkupNode, query: SelectQuery): boolean {
	if (query.type !== undefined && node.type !== query.type) return false;
	if (query.name !== undefined && node.name !== query.name) return false;
	const attributes = node.attributes ?? {};
	return Object.entries(query.attributes ?? {}).every(
		([key, value]) =>
			key in attributes && canonical(attributes[key]) === canonical(value),
	);
}

/** The brief's property, computed independently: walk the whole tree
 * in pre-order tracking ancestor ids, and keep matching id-bearing
 * nodes that are strict descendants of `within` (when present). */
function oracleSelect(tree: BarkupNode, query: SelectQuery): string[] {
	const out: string[] = [];
	const walk = (node: BarkupNode, ancestorIds: Set<string>): void => {
		const inScope = query.within === undefined || ancestorIds.has(query.within);
		if (inScope && node.id !== undefined && oracleMatches(node, query)) {
			out.push(node.id);
		}
		const next = node.id === undefined ? ancestorIds : new Set(ancestorIds);
		if (node.id !== undefined) next.add(node.id);
		for (const child of node.children ?? []) walk(child, next);
	};
	walk(tree, new Set());
	return out;
}

// --- Query generation: drawn from the tree, mixed with misses --------------

const TYPES = [...Object.keys(DOC_CONFIG.nodes), "no-such-type"];

/** A (possibly partial) copy of a picked node's attributes, or a
 * constraint nothing satisfies on a miss — json values included, so
 * deep-equality is exercised with values that really occur. */
function attributesFor(
	node: BarkupNode,
	seed: number,
	miss: boolean,
): Record<string, AttributeValue> {
	const entries = Object.entries(node.attributes ?? {});
	if (miss || entries.length === 0) return { maxLength: -12345 };
	return Object.fromEntries(
		entries.slice(0, 1 + (seed % entries.length)),
	) as Record<string, AttributeValue>;
}

/** Build a query from the tree via seed indexes, so criteria usually
 * reference things the tree really contains (a node's actual
 * type/name, another node's id as within, a third node's attribute
 * subset) but sometimes miss. */
function queryFor(
	tree: BarkupNode,
	seeds: { picks: number[]; use: boolean[] },
): SelectQuery {
	const nodes = allNodes(tree);
	const pick = (seed: number): BarkupNode =>
		nodes[seed % nodes.length] as BarkupNode;
	const [typeSeed = 0, nameSeed = 0, attrSeed = 0, withinSeed = 0] =
		seeds.picks;
	const [useType, useName, useAttrs, useWithin, miss = false] = seeds.use;
	const missType = TYPES[typeSeed % TYPES.length] as string;
	const query: SelectQuery = {};
	if (useType) query.type = miss ? missType : pick(typeSeed).type;
	if (useName) query.name = miss ? "no-name" : (pick(nameSeed).name ?? "x");
	if (useAttrs)
		query.attributes = attributesFor(pick(attrSeed), attrSeed, miss);
	if (useWithin)
		query.within = miss ? "no-id" : (pick(withinSeed).id as string);
	return query;
}

const selectArbitrary = fc
	.tuple(
		treeArbitrary(DOC_CONFIG),
		fc.array(fc.nat(1000), { minLength: 4, maxLength: 4 }),
		fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
	)
	.map(([raw, picks, use]) => {
		const tree = withIds(raw);
		return { tree, query: queryFor(tree, { picks, use }) };
	});

describe("selectNodes: agreement with an independent full-walk filter", () => {
	test("output equals the oracle's filtered walk, in walk order", () => {
		fc.assert(
			fc.property(selectArbitrary, ({ tree, query }) => {
				expect(selectNodes(tree, query)).toEqual(oracleSelect(tree, query));
			}),
			{ numRuns: RUNS },
		);
	});

	test("within is strict: never the anchor, always its descendants", () => {
		fc.assert(
			fc.property(selectArbitrary, ({ tree, query }) => {
				const anchorId = query.within;
				if (anchorId === undefined) return;
				const ids = selectNodes(tree, query);
				expect(ids).not.toContain(anchorId);
				const anchor = allNodes(tree).find((node) => node.id === anchorId);
				const descendantIds = new Set(
					anchor === undefined
						? []
						: allNodes(anchor)
								.filter((node) => node !== anchor)
								.map((node) => node.id),
				);
				for (const id of ids) {
					expect(descendantIds.has(id)).toBe(true);
				}
			}),
			{ numRuns: RUNS },
		);
	});

	test("selection is deterministic and never mutates the input", () => {
		fc.assert(
			fc.property(selectArbitrary, ({ tree, query }) => {
				const before = JSON.stringify(tree);
				const a = selectNodes(tree, query);
				const b = selectNodes(tree, query);
				expect(a).toEqual(b);
				expect(JSON.stringify(tree)).toBe(before);
			}),
			{ numRuns: RUNS },
		);
	});
});
