import { describe, expect, test } from "bun:test";

import { BarkupError, defineGrammar, normalizeNode } from "../src/index.js";
import type { BarkupNode } from "../src/types.js";
import { adapter, docGrammar } from "./helpers.js";

const TREE: BarkupNode = {
	type: "block",
	name: "feature-callout",
	id: "wgt-root",
	children: [
		{
			type: "block",
			name: "content-box",
			id: "wgt-content",
			attributes: {
				containerClasses: "rounded-2xl flex-[2] bg-primary p-6",
				featured: true,
			},
			children: [
				{
					type: "text-atom",
					name: "heading",
					id: "wgt-heading",
					attributes: { textStyle: "heading-2", maxLength: 60 },
				},
			],
		},
	],
};

describe("build", () => {
	test("serializes the article's example shape", () => {
		const grammar = docGrammar();
		const markup = grammar.build(TREE);
		expect(markup).toContain('data-type="block"');
		expect(markup).toContain('data-name="feature-callout"');
		expect(markup).toContain('id="wgt-root"');
		expect(markup).toContain(
			'data-container-classes="rounded-2xl flex-[2] bg-primary p-6"',
		);
		expect(markup).toContain('data-featured="true"');
		expect(markup).toContain('data-max-length="60"');
	});

	test("output is deterministic and indented", () => {
		const grammar = docGrammar();
		expect(grammar.build(TREE)).toBe(grammar.build(TREE));
		const lines = grammar.build(TREE).trimEnd().split("\n");
		expect(lines[1]?.startsWith("  <")).toBe(true);
		expect(lines[2]?.startsWith("    <")).toBe(true);
	});

	test("throws on unknown node type (tree-side = programmer error)", () => {
		const grammar = docGrammar();
		expect(() => grammar.build({ type: "mystery" })).toThrow(BarkupError);
	});

	test("throws on undeclared attribute under the error policy", () => {
		const grammar = docGrammar();
		expect(() =>
			grammar.build({
				type: "block",
				attributes: { sneaky: "value" },
			}),
		).toThrow(BarkupError);
	});

	test("throws on non-finite numbers", () => {
		const grammar = docGrammar();
		expect(() =>
			grammar.build({
				type: "text-atom",
				attributes: { maxLength: Number.NaN },
			}),
		).toThrow(BarkupError);
	});

	test("escapes attribute values", () => {
		const grammar = docGrammar();
		const markup = grammar.build({
			type: "text-atom",
			attributes: { maxLength: 10, content: '<b> & "quotes"' },
		});
		expect(markup).toContain(
			'data-content="&lt;b&gt; &amp; &quot;quotes&quot;"',
		);
	});
});

describe("parse", () => {
	test("round-trips the example tree", () => {
		const grammar = docGrammar();
		const result = grammar.parse(grammar.build(TREE));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.node).toEqual(normalizeNode(TREE));
		}
	});

	test("coerces only as declared: numeric-looking strings stay strings", () => {
		const grammar = docGrammar();
		const markup = `<div data-type="block"><div data-type="text-atom" data-max-length="60" data-content="1.5"></div></div>`;
		const result = grammar.parse(markup);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const atom = result.node.children?.[0];
			expect(atom?.attributes?.content).toBe("1.5");
			expect(atom?.attributes?.maxLength).toBe(60);
		}
	});

	test("reports unknown node types", () => {
		const grammar = docGrammar();
		const result = grammar.parse(`<div data-type="mystery"></div>`);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues[0]?.code).toBe("unknown-type");
		}
	});

	test("reports invalid containment", () => {
		const grammar = docGrammar();
		const markup = `<div data-type="document"><div data-type="text-atom" data-max-length="5"></div></div>`;
		const result = grammar.parse(markup);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.map((i) => i.code)).toContain("invalid-child");
		}
	});

	test("reports disallowed roots", () => {
		const grammar = docGrammar();
		const result = grammar.parse(
			`<div data-type="text-atom" data-max-length="5"></div>`,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.map((i) => i.code)).toContain("invalid-root");
		}
	});

	test("reports missing required attributes", () => {
		const grammar = docGrammar();
		const result = grammar.parse(`<div data-type="text-atom"></div>`);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.issues.find((i) => i.code === "missing-attribute");
			expect(issue?.attribute).toBe("maxLength");
		}
	});

	test("reports bad coercions with the offending value", () => {
		const grammar = docGrammar();
		const result = grammar.parse(
			`<div data-type="text-atom" data-max-length="tall"></div>`,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const issue = result.issues.find(
				(i) => i.code === "invalid-attribute-value",
			);
			expect(issue?.message).toContain("tall");
		}
	});

	test("reports unknown attributes under the error policy", () => {
		const grammar = docGrammar();
		const result = grammar.parse(
			`<div data-type="block" data-sneaky="1"></div>`,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues[0]?.code).toBe("unknown-attribute");
		}
	});

	test("keeps unknown attributes as strings under the string policy", () => {
		const grammar = docGrammar({ unknownAttributes: "string" });
		const result = grammar.parse(
			`<div data-type="block" data-sneaky-extra="1"></div>`,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.node.attributes?.sneakyExtra).toBe("1");
		}
	});

	test("reports duplicate ids", () => {
		const grammar = docGrammar();
		const markup = `<div data-type="block" id="dup"><div data-type="block" id="dup"></div></div>`;
		const result = grammar.parse(markup);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.map((i) => i.code)).toContain("duplicate-id");
		}
	});

	test("reports non-data attributes", () => {
		const grammar = docGrammar();
		const result = grammar.parse(`<div data-type="block" class="rogue"></div>`);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues[0]?.code).toBe("reserved-attribute");
		}
	});

	test("reports stray text content", () => {
		const grammar = docGrammar();
		const result = grammar.parse(`<div data-type="block">hello</div>`);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues[0]?.code).toBe("unexpected-text");
		}
	});

	test("reports multiple root elements", () => {
		const grammar = docGrammar();
		const result = grammar.parse(
			`<div data-type="block"></div><div data-type="block"></div>`,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues[0]?.code).toBe("invalid-root");
		}
	});
});

describe("format", () => {
	test("fills missing ids and ONLY missing ids", () => {
		const grammar = docGrammar();
		const markup = [
			`<div data-type="block" id="wgt-wrapper">`,
			`<div data-type="text-atom" data-max-length="40"></div>`,
			`</div>`,
		].join("");
		const result = grammar.format(markup);
		expect(result.ok).toBe(true);
		if (result.ok) {
			// existing readable id preserved byte-for-byte (the article's scar #1)
			expect(result.markup).toContain('id="wgt-wrapper"');
			// the id-less atom got one
			const parsed = grammar.parse(result.markup);
			expect(parsed.ok).toBe(true);
			if (parsed.ok) {
				expect(parsed.node.children?.[0]?.id).toBeDefined();
			}
		}
	});

	test("is idempotent", () => {
		const grammar = docGrammar();
		const first = grammar.format(`<div data-type="block" id="a"></div>`);
		expect(first.ok).toBe(true);
		if (first.ok) {
			const second = grammar.format(first.markup);
			expect(second.ok).toBe(true);
			if (second.ok) expect(second.markup).toBe(first.markup);
		}
	});

	test("returns issues instead of formatting invalid markup", () => {
		const grammar = docGrammar();
		const result = grammar.format(`<div data-type="mystery"></div>`);
		expect(result.ok).toBe(false);
	});
});

describe("validate", () => {
	test("accepts the example tree", () => {
		const grammar = docGrammar();
		expect(grammar.validate(TREE).ok).toBe(true);
	});

	test("mirrors parse-side checks for programmatic trees", () => {
		const grammar = docGrammar();
		const result = grammar.validate({
			type: "document",
			children: [{ type: "text-atom", attributes: { maxLength: "sixty" } }],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const codes = result.issues.map((i) => i.code);
			expect(codes).toContain("invalid-child");
			expect(codes).toContain("invalid-attribute-value");
		}
	});
});

describe("defineGrammar config validation", () => {
	test("rejects non-camelCase attribute keys", () => {
		expect(() =>
			defineGrammar(
				{ nodes: { a: { attributes: { "bad-key": { type: "string" } } } } },
				{ adapter },
			),
		).toThrow(BarkupError);
	});

	test("rejects reserved attribute keys", () => {
		expect(() =>
			defineGrammar(
				{ nodes: { a: { attributes: { id: { type: "string" } } } } },
				{ adapter },
			),
		).toThrow(BarkupError);
	});

	test("rejects undeclared child types", () => {
		expect(() =>
			defineGrammar({ nodes: { a: { children: ["ghost"] } } }, { adapter }),
		).toThrow(BarkupError);
	});

	test("rejects undeclared root types", () => {
		expect(() =>
			defineGrammar({ nodes: { a: {} }, roots: ["ghost"] }, { adapter }),
		).toThrow(BarkupError);
	});
});
