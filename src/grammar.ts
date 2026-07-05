/**
 * Grammar compilation: validates a GrammarConfig once (throwing
 * BarkupError on programmer mistakes) and precomputes the lookups the
 * codec needs — kebab↔camel attribute maps, allowed-children sets, and
 * deterministic attribute ordering.
 */
import {
	ATTRIBUTE_KEY_RE,
	camelToKebab,
	defaultGenerateId,
	RESERVED_KEYS,
	TAG_RE,
} from "./internal.js";
import type { AttributeSpec, GrammarConfig, NodeSpec } from "./types.js";
import { BarkupError } from "./types.js";

export interface CompiledNodeSpec {
	type: string;
	spec: NodeSpec;
	tag: string;
	/** null = any declared type is an allowed child ("*"). */
	allowedChildren: Set<string> | null;
	/** Declared attribute specs by camelCase key, in declaration order. */
	attributes: Map<string, AttributeSpec>;
	/** kebab-case data-attribute name → camelCase key. */
	kebabToKey: Map<string, string>;
}

export interface CompiledGrammar {
	config: GrammarConfig;
	nodes: Map<string, CompiledNodeSpec>;
	roots: Set<string>;
	unknownAttributes: "error" | "string";
	generateId: () => string;
}

export function compileGrammar(config: GrammarConfig): CompiledGrammar {
	const types = Object.keys(config.nodes);
	if (types.length === 0) {
		throw new BarkupError("Grammar must declare at least one node type.");
	}

	const nodes = new Map<string, CompiledNodeSpec>();
	for (const type of types) {
		const spec = config.nodes[type] as NodeSpec;
		const tag = spec.tag ?? "div";
		if (!TAG_RE.test(tag)) {
			throw new BarkupError(
				`Node type "${type}": tag "${tag}" is not a valid lowercase tag name.`,
			);
		}

		const attributes = new Map<string, AttributeSpec>();
		const kebabToKey = new Map<string, string>();
		for (const [key, attrSpec] of Object.entries(spec.attributes ?? {})) {
			if (!ATTRIBUTE_KEY_RE.test(key)) {
				throw new BarkupError(
					`Node type "${type}": attribute key "${key}" must be camelCase ` +
						"matching /^[a-z][a-zA-Z0-9]*$/ so it round-trips through " +
						"data-* kebab-case exactly.",
				);
			}
			if (RESERVED_KEYS.has(key)) {
				throw new BarkupError(
					`Node type "${type}": attribute key "${key}" is reserved ` +
						"(type/name/id are element-level).",
				);
			}
			attributes.set(key, attrSpec);
			kebabToKey.set(camelToKebab(key), key);
		}

		let allowedChildren: Set<string> | null = new Set<string>();
		for (const child of spec.children ?? []) {
			if (child === "*") {
				allowedChildren = null;
				break;
			}
			if (!(child in config.nodes)) {
				throw new BarkupError(
					`Node type "${type}": child type "${child}" is not declared in the grammar.`,
				);
			}
			allowedChildren.add(child);
		}

		nodes.set(type, {
			type,
			spec,
			tag,
			allowedChildren,
			attributes,
			kebabToKey,
		});
	}

	const roots = new Set<string>(config.roots ?? types);
	for (const root of roots) {
		if (!nodes.has(root)) {
			throw new BarkupError(
				`Root type "${root}" is not declared in the grammar.`,
			);
		}
	}

	return {
		config,
		nodes,
		roots,
		unknownAttributes: config.unknownAttributes ?? "error",
		generateId: config.generateId ?? defaultGenerateId,
	};
}
