/**
 * build(): typed tree → HTML markup.
 *
 * Output is deterministic and pretty-printed (2-space indent, one element
 * per line) so diffs stay readable and format() is idempotent. Attribute
 * order: data-type, data-name, id, declared attributes in grammar
 * declaration order, then undeclared string attributes alphabetically.
 *
 * Tree-side problems (unknown type, undeclared attribute under the
 * "error" policy, non-finite numbers, wrong value type) are programmer
 * errors and throw BarkupError.
 */
import type { CompiledGrammar } from "./grammar.js";
import { camelToKebab, escapeAttribute, pathSegment } from "./internal.js";
import type { AttributeValue, BarkupNode } from "./types.js";
import { BarkupError } from "./types.js";

export function buildMarkup(
	grammar: CompiledGrammar,
	tree: BarkupNode,
): string {
	const lines: string[] = [];
	buildNode(grammar, tree, 0, "", lines);
	return `${lines.join("\n")}\n`;
}

function buildNode(
	grammar: CompiledGrammar,
	node: BarkupNode,
	depth: number,
	parentPath: string,
	lines: string[],
): void {
	const path = parentPath
		? `${parentPath} > ${pathSegment(node.type, node.name)}`
		: pathSegment(node.type, node.name);
	const compiled = grammar.nodes.get(node.type);
	if (!compiled) {
		throw new BarkupError(
			`build: unknown node type "${node.type}" at ${path}.`,
		);
	}

	const attrs: string[] = [`data-type="${escapeAttribute(node.type)}"`];
	if (node.name !== undefined) {
		attrs.push(`data-name="${escapeAttribute(node.name)}"`);
	}
	if (node.id !== undefined) {
		attrs.push(`id="${escapeAttribute(node.id)}"`);
	}

	const provided = node.attributes ?? {};
	const seen = new Set<string>();
	// Declared attributes first, in grammar declaration order.
	for (const [key, spec] of compiled.attributes) {
		if (!(key in provided)) continue;
		seen.add(key);
		const serialized = serializeValue(
			provided[key] as AttributeValue,
			spec.type,
			key,
			path,
		);
		attrs.push(`data-${camelToKebab(key)}="${escapeAttribute(serialized)}"`);
	}
	// Undeclared attributes: allowed (as strings) only under the "string"
	// policy; a programmer error otherwise.
	const undeclared = Object.keys(provided)
		.filter((key) => !seen.has(key))
		.sort();
	for (const key of undeclared) {
		if (grammar.unknownAttributes !== "string") {
			throw new BarkupError(
				`build: attribute "${key}" at ${path} is not declared in the ` +
					`grammar for "${node.type}" (unknownAttributes is "error").`,
			);
		}
		const value = provided[key];
		if (typeof value !== "string") {
			throw new BarkupError(
				`build: undeclared attribute "${key}" at ${path} must be a string.`,
			);
		}
		attrs.push(`data-${camelToKebab(key)}="${escapeAttribute(value)}"`);
	}

	const indent = "  ".repeat(depth);
	const open = `${indent}<${compiled.tag} ${attrs.join(" ")}>`;
	const children = node.children ?? [];
	if (children.length === 0) {
		lines.push(`${open}</${compiled.tag}>`);
		return;
	}
	lines.push(open);
	for (const child of children) {
		buildNode(grammar, child, depth + 1, path, lines);
	}
	lines.push(`${indent}</${compiled.tag}>`);
}

function serializeValue(
	value: AttributeValue,
	type: "string" | "number" | "boolean" | "json",
	key: string,
	path: string,
): string {
	switch (type) {
		case "string": {
			if (typeof value !== "string") {
				throw new BarkupError(
					`build: attribute "${key}" at ${path} is declared "string" ` +
						`but received ${typeof value}.`,
				);
			}
			return value;
		}
		case "number": {
			if (typeof value !== "number" || !Number.isFinite(value)) {
				throw new BarkupError(
					`build: attribute "${key}" at ${path} is declared "number" ` +
						"but received a non-finite or non-number value.",
				);
			}
			return String(value);
		}
		case "boolean": {
			if (typeof value !== "boolean") {
				throw new BarkupError(
					`build: attribute "${key}" at ${path} is declared "boolean" ` +
						`but received ${typeof value}.`,
				);
			}
			return String(value);
		}
		case "json": {
			try {
				const serialized = JSON.stringify(value);
				if (serialized === undefined) {
					throw new Error("not JSON-serializable");
				}
				return serialized;
			} catch {
				throw new BarkupError(
					`build: attribute "${key}" at ${path} is declared "json" ` +
						"but the value is not JSON-serializable.",
				);
			}
		}
	}
}
