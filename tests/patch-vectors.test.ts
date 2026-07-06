/**
 * Anchored-patch conformance vectors — replay suite.
 *
 * The fixture (tests/fixtures/patch-vectors.json) was generated and
 * cross-checked in the companion benchmark repo
 * (https://github.com/kevinpeckham/barkup-bench,
 * corpus/patch-vectors.json) against TWO implementations: the shipped
 * `@kevinpeckham/barkup/patch` and the benchmark-validated reference
 * applier (condition F) — generation fails on any divergence. The
 * vectors are the dialect's conformance suite: an alternate
 * implementation of anchored patches conforms by replaying this file
 * against the grammar below (DOC_CONFIG with roots: ["document"] —
 * the benchmark grammar) and reproducing every expected outcome.
 *
 * To refresh: regenerate in barkup-bench via
 * `bun scripts/generate-patch-vectors.ts` and re-copy the file here.
 *
 * Expected-outcome semantics (matching the generator): on success,
 * the normalized patched tree; on failure, the FIRST issue's code and
 * — when the issue carries one — its opIndex.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PatchIssueCode } from "../src/patch.js";
import { applyAnchoredPatch } from "../src/patch.js";
import { nodesEqual } from "../src/testing.js";
import type { BarkupNode } from "../src/types.js";
import { docGrammar } from "./helpers.js";

interface Vector {
	name: string;
	base: BarkupNode;
	patch: unknown;
	expected:
		| { ok: true; node: BarkupNode }
		| { ok: false; code: PatchIssueCode; opIndex?: number };
}

interface VectorFile {
	version: number;
	grammar: string;
	vectors: Vector[];
}

const fixture: VectorFile = JSON.parse(
	readFileSync(
		new URL("./fixtures/patch-vectors.json", import.meta.url),
		"utf8",
	),
);

// The grammar the vectors were generated against: the benchmark
// grammar, i.e. DOC_CONFIG with roots narrowed to ["document"].
const grammar = docGrammar({ roots: ["document"] });

describe("anchored-patch conformance vectors", () => {
	test("fixture is intact", () => {
		expect(fixture.version).toBe(1);
		expect(fixture.vectors.length).toBe(40);
	});

	for (const vector of fixture.vectors) {
		test(vector.name, () => {
			const result = applyAnchoredPatch(grammar, vector.base, vector.patch);
			expect(result.ok).toBe(vector.expected.ok);
			if (vector.expected.ok) {
				if (!result.ok) throw new Error("unreachable");
				expect(nodesEqual(result.node, vector.expected.node)).toBe(true);
			} else {
				if (result.ok) throw new Error("unreachable");
				const first = result.issues[0];
				expect(first?.code).toBe(vector.expected.code);
				expect(first?.opIndex).toBe(vector.expected.opIndex);
			}
		});
	}
});
