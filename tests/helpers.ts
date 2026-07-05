import { DOMParser } from "linkedom";
import type { DomParserLike } from "../src/adapter.js";
import { domParserAdapter } from "../src/adapter.js";
import { defineGrammar } from "../src/index.js";
import type { GrammarConfig } from "../src/types.js";

export const adapter = domParserAdapter(
	new DOMParser() as unknown as DomParserLike,
);

/** A small document grammar in the spirit of the article's example. */
export const DOC_CONFIG: GrammarConfig = {
	nodes: {
		document: {
			label: "Document",
			children: ["page"],
			attributes: {
				title: { type: "string" },
				theme: { type: "string" },
			},
		},
		page: {
			label: "Page",
			tag: "section",
			children: ["block", "widget-slot"],
			attributes: {
				layoutSize: { type: "string" },
			},
		},
		block: {
			label: "Block",
			children: ["block", "text-atom", "image-atom"],
			attributes: {
				containerClasses: { type: "string" },
				featured: { type: "boolean" },
			},
		},
		"widget-slot": {
			label: "Widget Slot",
			attributes: {
				defaultWidgetId: { type: "string" },
				allowedWidgetIds: { type: "json" },
				requireBleed: { type: "boolean" },
			},
		},
		"text-atom": {
			label: "Text",
			attributes: {
				textStyle: { type: "string" },
				maxLength: { type: "number", required: true },
				minLength: { type: "number" },
				content: { type: "string" },
			},
		},
		"image-atom": {
			label: "Image",
			attributes: {
				src: { type: "string" },
				aspectRatio: { type: "string" },
			},
		},
	},
	roots: ["document", "block"],
};

export function docGrammar(overrides: Partial<GrammarConfig> = {}) {
	return defineGrammar({ ...DOC_CONFIG, ...overrides }, { adapter });
}
