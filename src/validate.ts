/**
 * validate(): grammar checks for trees built programmatically (the typed
 * side of the codec). Mirrors the checks parse() applies to markup:
 * declared types, root types, containment, required attributes, value
 * types, duplicate ids. Returns structured issues; never throws, never
 * repairs.
 */
import type { CompiledGrammar } from "./grammar.js";
import { pathSegment } from "./internal.js";
import type {
	AttributeSpec,
	AttributeValue,
	BarkupNode,
	GrammarIssue,
	ValidationResult,
} from "./types.js";

export function validateTree(
	grammar: CompiledGrammar,
	tree: BarkupNode,
): ValidationResult {
	const issues: GrammarIssue[] = [];
	const seenIds = new Set<string>();
	visit(grammar, tree, "", true, seenIds, issues);
	return issues.length > 0 ? { ok: false, issues } : { ok: true };
}

function visit(
	grammar: CompiledGrammar,
	node: BarkupNode,
	parentPath: string,
	isRoot: boolean,
	seenIds: Set<string>,
	issues: GrammarIssue[],
): void {
	const path = parentPath
		? `${parentPath} > ${pathSegment(node.type, node.name)}`
		: pathSegment(node.type, node.name);
	const issueBase = node.id !== undefined ? { nodeId: node.id } : {};

	const compiled = grammar.nodes.get(node.type);
	if (!compiled) {
		issues.push({
			code: "unknown-type",
			message: `Node type "${node.type}" is not declared in the grammar.`,
			path,
			...issueBase,
		});
		return;
	}

	if (isRoot && !grammar.roots.has(node.type)) {
		issues.push({
			code: "invalid-root",
			message: `Node type "${node.type}" is not an allowed root (allowed: ${[
				...grammar.roots,
			].join(", ")}).`,
			path,
			...issueBase,
		});
	}

	if (node.id !== undefined) {
		if (seenIds.has(node.id)) {
			issues.push({
				code: "duplicate-id",
				message: `Duplicate id "${node.id}".`,
				path,
				nodeId: node.id,
			});
		}
		seenIds.add(node.id);
	}

	const provided = node.attributes ?? {};
	for (const [key, value] of Object.entries(provided)) {
		const spec = compiled.attributes.get(key);
		if (!spec) {
			if (grammar.unknownAttributes === "string") {
				if (typeof value !== "string") {
					issues.push({
						code: "invalid-attribute-value",
						message: `Undeclared attribute "${key}" must be a string.`,
						path,
						attribute: key,
						...issueBase,
					});
				}
			} else {
				issues.push({
					code: "unknown-attribute",
					message: `Attribute "${key}" is not declared for node type "${node.type}".`,
					path,
					attribute: key,
					...issueBase,
				});
			}
			continue;
		}
		const problem = checkValue(value, spec);
		if (problem) {
			issues.push({
				code: "invalid-attribute-value",
				message: `Attribute "${key}" ${problem}.`,
				path,
				attribute: key,
				...issueBase,
			});
		}
	}

	for (const [key, spec] of compiled.attributes) {
		if (spec.required && !(key in provided)) {
			issues.push({
				code: "missing-attribute",
				message: `Required attribute "${key}" is missing on node type "${node.type}".`,
				path,
				attribute: key,
				...issueBase,
			});
		}
	}

	for (const child of node.children ?? []) {
		if (
			compiled.allowedChildren !== null &&
			!compiled.allowedChildren.has(child.type)
		) {
			issues.push({
				code: "invalid-child",
				message: `Node type "${child.type}" is not an allowed child of "${node.type}".`,
				path,
				...issueBase,
			});
		}
		visit(grammar, child, path, false, seenIds, issues);
	}
}

function checkValue(value: AttributeValue, spec: AttributeSpec): string | null {
	switch (spec.type) {
		case "string":
			return typeof value === "string"
				? null
				: `is declared "string" but is ${typeof value}`;
		case "number":
			return typeof value === "number" && Number.isFinite(value)
				? null
				: 'is declared "number" but is not a finite number';
		case "boolean":
			return typeof value === "boolean"
				? null
				: `is declared "boolean" but is ${typeof value}`;
		case "json": {
			try {
				return JSON.stringify(value) === undefined
					? 'is declared "json" but is not JSON-serializable'
					: null;
			} catch {
				return 'is declared "json" but is not JSON-serializable';
			}
		}
	}
}
