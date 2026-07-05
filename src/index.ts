/**
 * barkup — author typed trees as HTML.
 *
 * `defineGrammar(config)` compiles a grammar once and returns the codec:
 *
 *   const grammar = defineGrammar({ nodes: { ... } });
 *   grammar.build(tree)            // typed tree → markup (throws on bad trees)
 *   grammar.parse(markup)          // markup → { ok, node | issues }
 *   grammar.format(markup)         // pretty-print; fills ONLY missing ids
 *   grammar.validate(tree)         // { ok, issues } for programmatic trees
 *
 * Guarantees:
 *   1. Ids survive parse/build/format byte-for-byte.
 *   2. parse(build(tree)) deep-equals normalize(tree).
 *   3. Attribute coercion happens only as declared — never inferred.
 *   4. Invalid markup returns structured issues, never a repaired tree.
 */

import type { DomAdapter } from "./adapter.js";
import { defaultAdapter } from "./adapter.js";
import { buildMarkup } from "./build.js";
import { compileGrammar } from "./grammar.js";
import { parseMarkup } from "./parse.js";
import type {
	BarkupNode,
	FormatResult,
	GrammarConfig,
	ParseResult,
	ValidationResult,
} from "./types.js";
import { validateTree } from "./validate.js";

export interface DefineGrammarOptions {
	/** DOM adapter used by parse()/format(). Defaults to the platform
	 * DOMParser; required in runtimes without one (Node, Bun). */
	adapter?: DomAdapter;
}

export interface Grammar {
	readonly config: GrammarConfig;
	/** Typed tree → markup. Throws BarkupError on tree-side problems. */
	build(tree: BarkupNode): string;
	/** Markup → typed tree, or structured issues. Never repairs. */
	parse(markup: string, adapter?: DomAdapter): ParseResult;
	/** Parse + fill MISSING ids + rebuild. Existing ids are untouched. */
	format(markup: string, adapter?: DomAdapter): FormatResult;
	/** Grammar checks for programmatically-built trees. */
	validate(tree: BarkupNode): ValidationResult;
}

export function defineGrammar(
	config: GrammarConfig,
	options: DefineGrammarOptions = {},
): Grammar {
	const compiled = compileGrammar(config);
	const resolveAdapter = (override?: DomAdapter): DomAdapter =>
		override ?? options.adapter ?? defaultAdapter();

	return {
		config,
		build(tree) {
			return buildMarkup(compiled, tree);
		},
		parse(markup, adapter) {
			return parseMarkup(compiled, markup, resolveAdapter(adapter));
		},
		format(markup, adapter) {
			const result = parseMarkup(compiled, markup, resolveAdapter(adapter));
			if (!result.ok) {
				return { ok: false, issues: result.issues };
			}
			fillMissingIds(result.node, compiled.generateId);
			return { ok: true, markup: buildMarkup(compiled, result.node) };
		},
		validate(tree) {
			return validateTree(compiled, tree);
		},
	};
}

/** Fill in ids ONLY where missing — never regenerate an existing id.
 * (Ids are a contract: agents and content systems reference them.) */
function fillMissingIds(node: BarkupNode, generateId: () => string): void {
	if (node.id === undefined) {
		node.id = generateId();
	}
	for (const child of node.children ?? []) {
		fillMissingIds(child, generateId);
	}
}

/**
 * Canonicalize a tree for comparison: drops empty attributes/children
 * containers and returns a structurally-clean copy. parse() always
 * produces normalized trees; run your own trees through this before
 * deep-equality checks (see guarantee 2).
 */
export function normalizeNode(node: BarkupNode): BarkupNode {
	const out: BarkupNode = { type: node.type };
	if (node.name !== undefined) out.name = node.name;
	if (node.id !== undefined) out.id = node.id;
	if (node.attributes && Object.keys(node.attributes).length > 0) {
		out.attributes = { ...node.attributes };
	}
	if (node.children && node.children.length > 0) {
		out.children = node.children.map(normalizeNode);
	}
	return out;
}

export type {
	DomAdapter,
	DomParserLike,
	RawElement,
	RawNode,
	RawText,
} from "./adapter.js";
export { defaultAdapter, domParserAdapter } from "./adapter.js";
export type {
	AttributeSpec,
	AttributeType,
	AttributeValue,
	BarkupNode,
	FormatResult,
	GrammarConfig,
	GrammarIssue,
	IssueCode,
	JsonValue,
	NodeSpec,
	ParseResult,
	ValidationResult,
} from "./types.js";
export { BarkupError } from "./types.js";
