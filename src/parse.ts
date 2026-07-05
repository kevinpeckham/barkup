/**
 * parse(): HTML markup → typed tree.
 *
 * All markup-side problems are collected as structured GrammarIssues and
 * returned in the result — the tree is never silently "repaired". Ids and
 * declared string attributes pass through byte-for-byte; coercion happens
 * ONLY for attributes whose grammar entry declares number/boolean/json.
 */
import type { DomAdapter, RawElement, RawNode } from "./adapter.js";
import type { CompiledGrammar, CompiledNodeSpec } from "./grammar.js";
import { kebabToCamel, pathSegment } from "./internal.js";
import type {
	AttributeValue,
	BarkupNode,
	GrammarIssue,
	ParseResult,
} from "./types.js";

export function parseMarkup(
	grammar: CompiledGrammar,
	markup: string,
	adapter: DomAdapter,
): ParseResult {
	const issues: GrammarIssue[] = [];

	let rawNodes: RawNode[];
	try {
		rawNodes = adapter.parse(markup);
	} catch (error) {
		return {
			ok: false,
			issues: [
				{
					code: "parse-failed",
					message: `The adapter could not parse the markup: ${
						error instanceof Error ? error.message : String(error)
					}`,
					path: "(root)",
				},
			],
		};
	}

	const rootElements: RawElement[] = [];
	for (const raw of rawNodes) {
		if (raw.kind === "text") {
			if (raw.text.trim() !== "") {
				issues.push({
					code: "unexpected-text",
					message:
						"Text content is not part of the dialect — put text in a declared attribute.",
					path: "(root)",
				});
			}
			continue;
		}
		rootElements.push(raw);
	}

	if (rootElements.length !== 1) {
		issues.push({
			code: "invalid-root",
			message: `Expected exactly one root element, found ${rootElements.length}.`,
			path: "(root)",
		});
		return { ok: false, issues };
	}

	const seenIds = new Set<string>();
	const root = rootElements[0] as RawElement;
	const node = parseElement(grammar, root, "", true, seenIds, issues);

	if (issues.length > 0) {
		return { ok: false, issues };
	}
	return { ok: true, node: node as BarkupNode };
}

function parseElement(
	grammar: CompiledGrammar,
	element: RawElement,
	parentPath: string,
	isRoot: boolean,
	seenIds: Set<string>,
	issues: GrammarIssue[],
): BarkupNode | null {
	const attrs = new Map(element.attributes);
	const type = attrs.get("data-type");
	const name = attrs.get("data-name");
	const id = attrs.get("id");

	const path = parentPath
		? `${parentPath} > ${pathSegment(type ?? element.tag, name)}`
		: pathSegment(type ?? element.tag, name);

	if (type === undefined) {
		issues.push({
			code: "unknown-type",
			message: `Element <${element.tag}> is missing data-type.`,
			path,
			...(id !== undefined && { nodeId: id }),
		});
		return null;
	}

	const compiled = grammar.nodes.get(type);
	if (!compiled) {
		issues.push({
			code: "unknown-type",
			message: `Node type "${type}" is not declared in the grammar.`,
			path,
			...(id !== undefined && { nodeId: id }),
		});
		return null;
	}

	if (isRoot && !grammar.roots.has(type)) {
		issues.push({
			code: "invalid-root",
			message: `Node type "${type}" is not an allowed root (allowed: ${[
				...grammar.roots,
			].join(", ")}).`,
			path,
			...(id !== undefined && { nodeId: id }),
		});
	}

	if (id !== undefined) {
		if (seenIds.has(id)) {
			issues.push({
				code: "duplicate-id",
				message: `Duplicate id "${id}".`,
				path,
				nodeId: id,
			});
		}
		seenIds.add(id);
	}

	const attributes = parseAttributes(
		grammar,
		compiled,
		attrs,
		path,
		id,
		issues,
	);
	const children = parseChildren(
		grammar,
		compiled,
		element,
		path,
		id,
		seenIds,
		issues,
	);

	const node: BarkupNode = { type };
	if (name !== undefined) node.name = name;
	if (id !== undefined) node.id = id;
	if (Object.keys(attributes).length > 0) node.attributes = attributes;
	if (children.length > 0) node.children = children;
	return node;
}

function parseAttributes(
	grammar: CompiledGrammar,
	compiled: CompiledNodeSpec,
	attrs: Map<string, string>,
	path: string,
	nodeId: string | undefined,
	issues: GrammarIssue[],
): Record<string, AttributeValue> {
	const out: Record<string, AttributeValue> = {};
	const issueBase = nodeId !== undefined ? { nodeId } : {};

	for (const [rawName, rawValue] of attrs) {
		if (
			rawName === "data-type" ||
			rawName === "data-name" ||
			rawName === "id"
		) {
			continue;
		}
		if (!rawName.startsWith("data-")) {
			issues.push({
				code: "reserved-attribute",
				message: `Attribute "${rawName}" is not part of the dialect — only id and data-* attributes are allowed.`,
				path,
				attribute: rawName,
				...issueBase,
			});
			continue;
		}
		const kebab = rawName.slice("data-".length);
		const key = compiled.kebabToKey.get(kebab);
		if (key === undefined) {
			if (grammar.unknownAttributes === "string") {
				out[kebabToCamel(kebab)] = rawValue;
			} else {
				issues.push({
					code: "unknown-attribute",
					message: `Attribute "${rawName}" is not declared for node type "${compiled.type}".`,
					path,
					attribute: rawName,
					...issueBase,
				});
			}
			continue;
		}
		const spec = compiled.attributes.get(key);
		if (!spec) continue;
		const coerced = coerceValue(rawValue, spec.type);
		if (coerced.ok) {
			out[key] = coerced.value;
		} else {
			issues.push({
				code: "invalid-attribute-value",
				message: `Attribute "${rawName}" is declared "${spec.type}" but "${rawValue}" ${coerced.reason}.`,
				path,
				attribute: rawName,
				...issueBase,
			});
		}
	}

	for (const [key, spec] of compiled.attributes) {
		if (spec.required && !(key in out)) {
			issues.push({
				code: "missing-attribute",
				message: `Required attribute "${key}" is missing on node type "${compiled.type}".`,
				path,
				attribute: key,
				...issueBase,
			});
		}
	}

	return out;
}

function parseChildren(
	grammar: CompiledGrammar,
	compiled: CompiledNodeSpec,
	element: RawElement,
	path: string,
	nodeId: string | undefined,
	seenIds: Set<string>,
	issues: GrammarIssue[],
): BarkupNode[] {
	const children: BarkupNode[] = [];
	const issueBase = nodeId !== undefined ? { nodeId } : {};

	for (const raw of element.children) {
		if (raw.kind === "text") {
			if (raw.text.trim() !== "") {
				issues.push({
					code: "unexpected-text",
					message:
						"Text content is not part of the dialect — put text in a declared attribute.",
					path,
					...issueBase,
				});
			}
			continue;
		}
		const child = parseElement(grammar, raw, path, false, seenIds, issues);
		if (!child) continue;
		if (
			compiled.allowedChildren !== null &&
			!compiled.allowedChildren.has(child.type)
		) {
			issues.push({
				code: "invalid-child",
				message: `Node type "${child.type}" is not an allowed child of "${compiled.type}".`,
				path,
				...issueBase,
			});
		}
		children.push(child);
	}
	return children;
}

function coerceValue(
	raw: string,
	type: "string" | "number" | "boolean" | "json",
): { ok: true; value: AttributeValue } | { ok: false; reason: string } {
	switch (type) {
		case "string":
			return { ok: true, value: raw };
		case "number": {
			if (raw.trim() === "") return { ok: false, reason: "is empty" };
			const value = Number(raw);
			if (!Number.isFinite(value)) {
				return { ok: false, reason: "is not a finite number" };
			}
			return { ok: true, value };
		}
		case "boolean": {
			if (raw === "true") return { ok: true, value: true };
			if (raw === "false") return { ok: true, value: false };
			return { ok: false, reason: 'is not "true" or "false"' };
		}
		case "json": {
			try {
				return { ok: true, value: JSON.parse(raw) };
			} catch {
				return { ok: false, reason: "is not valid JSON" };
			}
		}
	}
}
