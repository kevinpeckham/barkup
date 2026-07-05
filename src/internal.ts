/**
 * Internal helpers: attribute-name casing, HTML escaping, id generation,
 * and shared constants. Casing must round-trip exactly for every declared
 * key — defineGrammar() enforces the key shape that guarantees it.
 */

/** Declared attribute keys must match this: camelCase, leading lowercase. */
export const ATTRIBUTE_KEY_RE = /^[a-z][a-zA-Z0-9]*$/;

/** Serialized tag names must be simple lowercase tokens. */
export const TAG_RE = /^[a-z][a-z0-9-]*$/;

/** Reserved on the element: these never map to declared attributes. */
export const RESERVED_KEYS = new Set(["type", "name", "id"]);

export function camelToKebab(key: string): string {
	return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export function kebabToCamel(name: string): string {
	return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Escape a string for use inside a double-quoted HTML attribute. */
export function escapeAttribute(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

/** Default id generator: 12-char base36. Used only for MISSING ids. */
export function defaultGenerateId(): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	let id = "";
	for (let i = 0; i < 12; i++) {
		id += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return id;
}

/** Human-readable node path segment, e.g. `text-atom(headline)`. */
export function pathSegment(type: string, name?: string): string {
	return name ? `${type}(${name})` : type;
}
