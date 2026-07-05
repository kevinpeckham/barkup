/**
 * Property tests for the four guarantees, over randomly-generated
 * grammar-valid trees (see src/testing.ts). These are the tests the
 * article says should have existed from day one.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import { assertRoundTrip, nodesEqual, treeArbitrary } from "../src/testing.js";
import type { BarkupNode } from "../src/types.js";
import { adapter, DOC_CONFIG, docGrammar } from "./helpers.js";

const RUNS = 200;

describe("guarantee 1 + 2: round-trip identity (ids, names, attributes)", () => {
	test("parse(build(tree)) equals normalize(tree)", () => {
		const grammar = docGrammar();
		fc.assert(
			fc.property(treeArbitrary(DOC_CONFIG), (tree) => {
				assertRoundTrip(grammar, tree, adapter);
			}),
			{ numRuns: RUNS },
		);
	});
});

describe("guarantee 1: format() preserves every existing id byte-for-byte", () => {
	test("ids survive format; missing ids are filled; nothing else changes", () => {
		const grammar = docGrammar();
		fc.assert(
			fc.property(treeArbitrary(DOC_CONFIG), (tree) => {
				const markup = grammar.build(tree);
				const formatted = grammar.format(markup, adapter);
				expect(formatted.ok).toBe(true);
				if (!formatted.ok) return;

				const before = grammar.parse(markup, adapter);
				const after = grammar.parse(formatted.markup, adapter);
				expect(before.ok && after.ok).toBe(true);
				if (!before.ok || !after.ok) return;

				// Every id present before is present, unchanged, at the same
				// position after; ids missing before are now filled.
				const beforeIds = collectIds(before.node);
				const afterIds = collectIds(after.node);
				expect(afterIds.length).toBe(beforeIds.length);
				for (let i = 0; i < beforeIds.length; i++) {
					const original = beforeIds[i];
					if (original !== undefined) {
						expect(afterIds[i]).toBe(original);
					} else {
						expect(typeof afterIds[i]).toBe("string");
					}
				}

				// And the tree is otherwise identical (compare with ids erased).
				expect(nodesEqual(stripIds(before.node), stripIds(after.node))).toBe(
					true,
				);
			}),
			{ numRuns: RUNS },
		);
	});
});

describe("guarantee 3: declared coercion only", () => {
	test("string attributes never change type, even when numeric-looking", () => {
		const grammar = docGrammar();
		fc.assert(
			fc.property(
				fc.oneof(
					fc.double({ noNaN: true, noDefaultInfinity: true }).map(String),
					fc.constantFrom("true", "false", "1.5", "007", "0x10", "1e3"),
				),
				(value) => {
					const tree: BarkupNode = {
						type: "block",
						children: [
							{
								type: "text-atom",
								attributes: { maxLength: 10, content: value },
							},
						],
					};
					const result = grammar.parse(grammar.build(tree), adapter);
					expect(result.ok).toBe(true);
					if (result.ok) {
						const atom = result.node.children?.[0];
						expect(atom?.attributes?.content).toBe(value);
						expect(typeof atom?.attributes?.content).toBe("string");
					}
				},
			),
			{ numRuns: RUNS },
		);
	});
});

describe("guarantee 4: loud boundaries", () => {
	test("invalid markup never yields a repaired tree", () => {
		const grammar = docGrammar();
		const invalid = [
			`<div data-type="mystery"></div>`,
			`<div data-type="text-atom"></div>`,
			`<div data-type="block">stray text</div>`,
			`<div data-type="block" class="x"></div>`,
			`<div data-type="block" id="a"><div data-type="block" id="a"></div></div>`,
		];
		for (const markup of invalid) {
			const result = grammar.parse(markup, adapter);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.issues.length).toBeGreaterThan(0);
				for (const issue of result.issues) {
					expect(issue.message.length).toBeGreaterThan(0);
					expect(issue.path.length).toBeGreaterThan(0);
				}
			}
		}
	});
});

function collectIds(node: BarkupNode): Array<string | undefined> {
	return [node.id, ...(node.children ?? []).flatMap(collectIds)];
}

function stripIds(node: BarkupNode): BarkupNode {
	const { id: _dropped, ...rest } = node;
	return {
		...rest,
		...(node.children && { children: node.children.map(stripIds) }),
	};
}
