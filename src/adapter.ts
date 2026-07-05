/**
 * DOM adapter seam. barkup's core has zero runtime dependencies: in
 * browsers it uses the platform DOMParser; on servers you pass any
 * standards-shaped DOMParser implementation (linkedom is the documented
 * recommendation) to `domParserAdapter()`.
 *
 * The adapter's output is a minimal raw tree (elements + text), decoupled
 * from any DOM library's object model.
 */
import { BarkupError } from "./types.js";

/** Raw element as produced by an adapter — untyped, pre-grammar. */
export interface RawElement {
	kind: "element";
	/** Lowercase tag name. */
	tag: string;
	/** Attribute name/value pairs in document order. */
	attributes: Array<[name: string, value: string]>;
	children: RawNode[];
}

export interface RawText {
	kind: "text";
	text: string;
}

export type RawNode = RawElement | RawText;

export interface DomAdapter {
	/** Parse an HTML fragment into top-level raw nodes. */
	parse(markup: string): RawNode[];
}

/** Structural subset of the standard DOMParser output that barkup needs.
 * Both the browser DOMParser and linkedom's satisfy it. */
export interface DomParserLike {
	parseFromString(
		markup: string,
		mimeType: string,
	): {
		body?: {
			childNodes: ArrayLike<unknown>;
		} | null;
	};
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

interface DomNodeShape {
	nodeType: number;
	textContent?: string | null;
	tagName?: string;
	childNodes?: ArrayLike<unknown>;
	getAttributeNames?: () => string[];
	getAttribute?: (name: string) => string | null;
}

function convertDomNode(node: DomNodeShape): RawNode | null {
	if (node.nodeType === TEXT_NODE) {
		return { kind: "text", text: node.textContent ?? "" };
	}
	if (node.nodeType !== ELEMENT_NODE) {
		return null; // comments, doctype, etc. — not part of the dialect
	}
	const attributes: Array<[string, string]> = [];
	const names = node.getAttributeNames?.() ?? [];
	for (const name of names) {
		attributes.push([name, node.getAttribute?.(name) ?? ""]);
	}
	const children: RawNode[] = [];
	const childNodes = node.childNodes ?? [];
	for (let i = 0; i < childNodes.length; i++) {
		const converted = convertDomNode(childNodes[i] as DomNodeShape);
		if (converted) children.push(converted);
	}
	return {
		kind: "element",
		tag: (node.tagName ?? "").toLowerCase(),
		attributes,
		children,
	};
}

/** Wrap any standards-shaped DOMParser (browser, linkedom, …) as an adapter. */
export function domParserAdapter(parser: DomParserLike): DomAdapter {
	return {
		parse(markup: string): RawNode[] {
			const doc = parser.parseFromString(
				`<html><body>${markup}</body></html>`,
				"text/html",
			);
			const body = doc.body;
			if (!body) return [];
			const out: RawNode[] = [];
			const childNodes = body.childNodes;
			for (let i = 0; i < childNodes.length; i++) {
				const converted = convertDomNode(childNodes[i] as DomNodeShape);
				if (converted) out.push(converted);
			}
			return out;
		},
	};
}

/** Resolve the platform DOMParser (browsers). Throws a helpful error in
 * runtimes without one — pass an adapter explicitly there. */
export function defaultAdapter(): DomAdapter {
	const DomParserCtor = (globalThis as { DOMParser?: new () => DomParserLike })
		.DOMParser;
	if (!DomParserCtor) {
		throw new BarkupError(
			"No DOMParser in this runtime. Pass an adapter explicitly, e.g. " +
				"`domParserAdapter(new DOMParser())` with linkedom: " +
				'`import { DOMParser } from "linkedom"`.',
		);
	}
	return domParserAdapter(new DomParserCtor());
}
