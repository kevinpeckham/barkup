/**
 * barkup/testing — property-test helpers so consumers can prove the
 * round-trip guarantees over their OWN grammars.
 *
 * Requires fast-check (optional peer dependency):
 *
 *   import fc from "fast-check";
 *   import { treeArbitrary, assertRoundTrip } from "@kevinpeckham/barkup/testing";
 *
 *   fc.assert(fc.property(treeArbitrary(grammar.config), (tree) => {
 *     assertRoundTrip(grammar, tree, adapter);
 *   }));
 */
import fc from "fast-check";

import type { DomAdapter } from "./adapter.js";
import type { Grammar } from "./index.js";
import { normalizeNode } from "./index.js";
import type {
	AttributeSpec,
	AttributeValue,
	BarkupNode,
	GrammarConfig,
	JsonValue,
	NodeSpec,
} from "./types.js";

export interface TreeArbitraryOptions {
	/** Maximum tree depth (root = 1). Default 4. */
	maxDepth?: number;
	/** Maximum children per node. Default 4. */
	maxChildren?: number;
}

/**
 * Attribute-value strings exclude control characters: HTML attribute
 * parsing normalizes them (e.g. NUL → U+FFFD, CR/LF handling), so they
 * cannot round-trip byte-for-byte through ANY spec-compliant parser.
 * This is an HTML limitation, not a barkup one — documented in README.
 */
const attributeString = () =>
	fc
		.string()
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — excluding the non-round-trippable range
		.filter((s) => !/[\u0000-\u001f\u007f]/.test(s));

const idString = () => fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,23}$/);

const jsonValue = (): fc.Arbitrary<JsonValue> =>
	fc
		.jsonValue({ maxDepth: 3 })
		.map((v) => JSON.parse(JSON.stringify(v)) as JsonValue);

function attributeValueArb(spec: AttributeSpec): fc.Arbitrary<AttributeValue> {
	switch (spec.type) {
		case "string":
			return attributeString();
		case "number":
			return fc
				.double({ noNaN: true, noDefaultInfinity: true })
				.map((n) => (Object.is(n, -0) ? 0 : n));
		case "boolean":
			return fc.boolean();
		case "json":
			return jsonValue();
	}
}

function attributesArb(
	spec: NodeSpec,
): fc.Arbitrary<Record<string, AttributeValue> | undefined> {
	const entries = Object.entries(spec.attributes ?? {});
	if (entries.length === 0) return fc.constant(undefined);
	const parts: Record<string, fc.Arbitrary<AttributeValue | undefined>> = {};
	const required: string[] = [];
	for (const [key, attrSpec] of entries) {
		if (attrSpec.required) required.push(key);
		parts[key] = attrSpec.required
			? attributeValueArb(attrSpec)
			: fc.option(attributeValueArb(attrSpec), { nil: undefined });
	}
	return fc.record(parts).map((rec) => {
		const out: Record<string, AttributeValue> = {};
		for (const [key, value] of Object.entries(rec)) {
			if (value !== undefined) out[key] = value;
		}
		return Object.keys(out).length > 0 ? out : undefined;
	});
}

/**
 * Generate random grammar-valid trees: allowed root types, allowed
 * children only, declared attributes with type-correct values, unique
 * ids (some nodes intentionally have no id — format() fills those).
 */
export function treeArbitrary(
	config: GrammarConfig,
	options: TreeArbitraryOptions = {},
): fc.Arbitrary<BarkupNode> {
	const maxDepth = options.maxDepth ?? 4;
	const maxChildren = options.maxChildren ?? 4;
	const types = Object.keys(config.nodes);
	const roots = [...(config.roots ?? types)];
	let idCounter = 0;

	const nodeArb = (type: string, depth: number): fc.Arbitrary<BarkupNode> => {
		const spec = config.nodes[type] as NodeSpec;
		const childTypes =
			spec.children?.includes("*") === true
				? types
				: [...(spec.children ?? [])];
		const childrenArb: fc.Arbitrary<BarkupNode[]> =
			depth >= maxDepth || childTypes.length === 0
				? fc.constant([])
				: fc.array(
						fc
							.constantFrom(...childTypes)
							.chain((childType) => nodeArb(childType, depth + 1)),
						{ maxLength: maxChildren },
					);

		return fc
			.record({
				name: fc.option(idString(), { nil: undefined }),
				hasId: fc.boolean(),
				attributes: attributesArb(spec),
				children: childrenArb,
			})
			.map(({ name, hasId, attributes, children }) => {
				const node: BarkupNode = { type };
				if (name !== undefined) node.name = name;
				if (hasId) node.id = `n${idCounter++}`;
				if (attributes) node.attributes = attributes;
				if (children.length > 0) node.children = children;
				return node;
			});
	};

	return fc.constantFrom(...roots).chain((root) => {
		idCounter = 0;
		return nodeArb(root, 1);
	});
}

/** Deep equality over normalized nodes (attribute key order ignored). */
export function nodesEqual(a: BarkupNode, b: BarkupNode): boolean {
	return (
		JSON.stringify(canonical(normalizeNode(a))) ===
		JSON.stringify(canonical(normalizeNode(b)))
	);
}

function canonical(node: BarkupNode): unknown {
	return {
		type: node.type,
		name: node.name ?? null,
		id: node.id ?? null,
		attributes: node.attributes
			? Object.fromEntries(
					Object.entries(node.attributes)
						.sort(([a], [b]) => (a < b ? -1 : 1))
						.map(([k, v]) => [k, canonicalValue(v)]),
				)
			: null,
		children: (node.children ?? []).map(canonical),
	};
}

function canonicalValue(value: AttributeValue): unknown {
	// JSON round-trip normalizes object key order recursively.
	return JSON.parse(JSON.stringify(sortJson(value)));
}

function sortJson(value: AttributeValue): AttributeValue {
	if (Array.isArray(value)) return value.map(sortJson) as JsonValue;
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => (a < b ? -1 : 1))
				.map(([k, v]) => [k, sortJson(v as AttributeValue)]),
		) as JsonValue;
	}
	return value;
}

/**
 * Assert guarantee 2 (round-trip identity) and guarantee 1 (id
 * preservation) for one tree. Throws with a readable diff on failure.
 */
export function assertRoundTrip(
	grammar: Grammar,
	tree: BarkupNode,
	adapter?: DomAdapter,
): void {
	const markup = grammar.build(tree);
	const result = grammar.parse(markup, adapter);
	if (!result.ok) {
		throw new Error(
			`Round trip failed at parse:\n${result.issues
				.map((issue) => `  [${issue.code}] ${issue.path}: ${issue.message}`)
				.join("\n")}\nMarkup:\n${markup}`,
		);
	}
	if (!nodesEqual(tree, result.node)) {
		throw new Error(
			`Round trip mismatch.\nInput:\n${JSON.stringify(
				normalizeNode(tree),
				null,
				2,
			)}\nOutput:\n${JSON.stringify(normalizeNode(result.node), null, 2)}`,
		);
	}
}
