/**
 * Public types for barkup — a config-driven codec between typed trees and
 * an HTML authoring dialect.
 *
 * Design principle: errors coming from the MARKUP side (what humans and
 * LLM agents author) are data — structured issues in a result object,
 * never silent repairs. Errors coming from the TYPED side (trees built by
 * your program) are programmer errors and throw.
 */

/** JSON-serializable value, used by attributes declared `type: "json"`. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

/** Declared attribute types. Coercion happens ONLY as declared — never
 * inferred from the value's shape. */
export type AttributeType = "string" | "number" | "boolean" | "json";

export type AttributeValue = string | number | boolean | JsonValue;

export interface AttributeSpec {
	type: AttributeType;
	/** Required attributes are enforced by parse() and validate(). */
	required?: boolean;
}

export interface NodeSpec {
	/** Human-facing label (editors, menus). Not serialized. */
	label?: string;
	/** HTML tag used when serializing this node type. Default: "div". */
	tag?: string;
	/**
	 * Allowed child node types. Omit or [] for a leaf node. Use ["*"] to
	 * accept any type declared in the grammar.
	 */
	children?: readonly string[];
	/**
	 * Declared attributes, keyed by camelCase name. Serialized as
	 * `data-{kebab-case}`. Keys must match /^[a-z][a-zA-Z0-9]*$/ and must
	 * not collide with the reserved names ("type", "name", "id").
	 */
	attributes?: Record<string, AttributeSpec>;
}

export interface GrammarConfig {
	/** Node specs keyed by node type (the `data-type` value). */
	nodes: Record<string, NodeSpec>;
	/** Allowed root types. Default: any type declared in `nodes`. */
	roots?: readonly string[];
	/**
	 * How parse() treats `data-*` attributes not declared in the grammar:
	 * - "error" (default): structured issue, parse fails loudly.
	 * - "string": kept as a string attribute (camelCased key).
	 */
	unknownAttributes?: "error" | "string";
	/**
	 * Id generator used by format() to fill in MISSING ids. Existing ids
	 * are never touched. Default: 12-char base36 random.
	 */
	generateId?: () => string;
}

/** A node in the typed tree. */
export interface BarkupNode {
	type: string;
	/** Stable human label — serialized as `data-name`. */
	name?: string;
	/** Stable identifier — serialized as the native `id` attribute.
	 * Preserved byte-for-byte through parse/build/format. */
	id?: string;
	attributes?: Record<string, AttributeValue>;
	children?: BarkupNode[];
}

export type IssueCode =
	| "parse-failed"
	| "invalid-root"
	| "unexpected-text"
	| "unknown-type"
	| "invalid-child"
	| "unknown-attribute"
	| "reserved-attribute"
	| "invalid-attribute-value"
	| "missing-attribute"
	| "duplicate-id";

/** A structured problem found in markup or a tree. Never a repair. */
export interface GrammarIssue {
	code: IssueCode;
	message: string;
	/** Human-readable path from the root, e.g. `block(intro) > text-atom(headline)`. */
	path: string;
	nodeId?: string;
	attribute?: string;
}

export type ParseResult =
	| { ok: true; node: BarkupNode }
	| { ok: false; issues: GrammarIssue[] };

export type FormatResult =
	| { ok: true; markup: string }
	| { ok: false; issues: GrammarIssue[] };

export type ValidationResult =
	| { ok: true }
	| { ok: false; issues: GrammarIssue[] };

/** Thrown for programmer errors on the typed side (invalid grammar config,
 * unserializable tree values). Markup-side problems never throw. */
export class BarkupError extends Error {
	override name = "BarkupError";
}
