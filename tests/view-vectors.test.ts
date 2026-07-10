/**
 * Focused-view conformance vectors — replay suite.
 *
 * The fixture (tests/fixtures/view-vectors.json) was generated in the
 * companion benchmark repo
 * (https://github.com/kevinpeckham/barkup-bench,
 * corpus/view-vectors.json) by the exact renderer Study J scored
 * (src/conditions/views-html.ts). The vectors are the view dialect's
 * conformance suite: an implementation of focused views conforms by
 * replaying this file against the grammar below (DOC_CONFIG with
 * roots: ["document"] — the benchmark grammar) and reproducing every
 * expected rendering byte-for-byte. Divergence from a vector is a bug
 * in the implementation, not the vector.
 *
 * To refresh: regenerate in barkup-bench via
 * `bun scripts/generate-view-vectors.ts` and re-copy the file here.
 *
 * Expected-outcome semantics (matching the generator): on success,
 * the exact HTML-dialect rendering; on failure ({ ok: false },
 * unknown focus id), a structured-issue result.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { BarkupNode } from "../src/types.js";
import type { ViewMode } from "../src/view.js";
import { renderView } from "../src/view.js";
import { docGrammar } from "./helpers.js";

interface Vector {
	name: string;
	tree: BarkupNode;
	focus: string[];
	mode: ViewMode;
	expected: { ok: true; html: string } | { ok: false };
}

interface VectorFile {
	version: number;
	grammar: string;
	vectors: Vector[];
}

const fixture: VectorFile = JSON.parse(
	readFileSync(
		new URL("./fixtures/view-vectors.json", import.meta.url),
		"utf8",
	),
);

// The grammar the vectors were generated against: the benchmark
// grammar, i.e. DOC_CONFIG with roots narrowed to ["document"].
const grammar = docGrammar({ roots: ["document"] });

describe("focused-view conformance vectors", () => {
	test("fixture is intact", () => {
		expect(fixture.version).toBe(1);
		expect(fixture.vectors.length).toBe(39);
	});

	for (const vector of fixture.vectors) {
		test(vector.name, () => {
			const result = renderView(grammar, vector.tree, {
				focus: vector.focus,
				mode: vector.mode,
			});
			expect(result.ok).toBe(vector.expected.ok);
			if (vector.expected.ok) {
				if (!result.ok) throw new Error("unreachable");
				expect(result.html).toBe(vector.expected.html);
			} else {
				if (result.ok) throw new Error("unreachable");
				expect(result.issues.length).toBeGreaterThan(0);
				expect(result.issues[0]?.code).toBe("invalid-view");
			}
		});
	}
});
