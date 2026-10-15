import { expect, it, vi } from "vitest";

import { Integer, integerType, setServerUsizeBits } from "./integer";
import { String as RuntimeString, Str } from "./string";

// Regression for #192: `String.deref()` returned `this`, so any loop that
// unwraps ref-like values (`while (typeof v.deref === "function")`) never
// terminated, freezing the page on the first client-side text render of an
// owned string.

it("derefs to the borrowed form, not itself", () => {
	const owned = new RuntimeString("hello");
	const borrowed = owned.deref();

	expect(borrowed).toBeInstanceOf(Str);
	expect(borrowed).not.toBeInstanceOf(RuntimeString);
	expect(borrowed).not.toBe(owned);
	expect(borrowed.toNodeText()).toBe("hello");
});

it("ref-unwrapping an owned string terminates", () => {
	let current: unknown = new RuntimeString("hello");
	let steps = 0;
	while (
		current !== null &&
		typeof current === "object" &&
		typeof (current as { deref?: unknown }).deref === "function"
	) {
		current = (current as { deref: () => unknown }).deref();
		expect(++steps).toBeLessThan(10);
	}

	expect(current).toBeInstanceOf(Str);
	expect((current as Str).toNodeText()).toBe("hello");
});

// The expected values below are what Rust produces for the same input. An
// expression runs on the server during the initial render and again in the
// browser, so a surrogate that disagrees with `str` changes what the page
// says after hydration.

// Regression for #126: `len()` counted UTF-16 code units.
it("counts length in UTF-8 bytes", () => {
	setServerUsizeBits(64);
	expect(new Str("한😊").len().toString()).toBe("7");
	expect(new Str("a").len().toString()).toBe("1");
	expect(new Str("é").len().toString()).toBe("2");
});

it("measures length as the server's usize", () => {
	setServerUsizeBits(32);
	const length = new Str("abc").len();
	const index = new Integer(3n, integerType("usize", 32));
	expect(length.eq(index).toString()).toBe("true");
	expect(() => length.eq(new Integer(3n, integerType("usize", 64)))).toThrow();
});

// Regression for #236: `<` and friends order by UTF-16 code unit, which puts
// U+1F600 below U+FB00 because its high surrogate is 0xD83D.
it("orders strings by code point", () => {
	const below = new Str("\u{FB00}");
	const above = new Str("\u{1F600}");

	expect(below.lt(above).toString()).toBe("true");
	expect(below.le(above).toString()).toBe("true");
	expect(above.gt(below).toString()).toBe("true");
	expect(above.ge(below).toString()).toBe("true");
});

it("orders a prefix before the string that extends it", () => {
	const short = new Str("ab");
	const long = new Str("abc");

	expect(short.lt(long).toString()).toBe("true");
	expect(long.gt(short).toString()).toBe("true");
	expect(short.le(new Str("ab")).toString()).toBe("true");
	expect(short.ge(new Str("ab")).toString()).toBe("true");
	expect(short.gt(new Str("ab")).toString()).toBe("false");
});

// Regression for #238: the ECMAScript whitespace set strips U+FEFF and keeps
// U+0085, and Rust's `White_Space` property does the opposite.
it("trims the code points Rust treats as whitespace", () => {
	expect(new Str("\u{FEFF}x\u{FEFF}").trim().toNodeText()).toBe(
		"\u{FEFF}x\u{FEFF}",
	);
	expect(new Str("\u{0085}x\u{0085}").trim().toNodeText()).toBe("x");
	expect(new Str("\u{00A0}\u{1680}\u{2000}\u{3000}x").trim().toNodeText()).toBe(
		"x",
	);
	expect(new Str("\u{180E}x").trim().toNodeText()).toBe("\u{180E}x");
	expect(new Str(" \t\n x \r\n ").trim().toNodeText()).toBe("x");
});

it("trims only the requested end", () => {
	expect(new Str("\u{0085}x\u{0085}").trim_start().toNodeText()).toBe(
		"x\u{0085}",
	);
	expect(new Str("\u{0085}x\u{0085}").trim_end().toNodeText()).toBe(
		"\u{0085}x",
	);
	expect(new Str("x\u{FEFF}").trim_end().toNodeText()).toBe("x\u{FEFF}");
});

it.each([
	["", ""],
	["already lowercase 123", "already lowercase 123"],
	["ASCII MiXeD", "ascii mixed"],
	["I\u0130\u0131i", "ii\u0307\u0131i"],
	["\u00c9\u0416\u0391\u4e2d", "\u00e9\u0436\u03b1\u4e2d"],
	["\u03a3", "\u03c3"],
	["\u039f\u03a3", "\u03bf\u03c2"],
	["\u039f\u03a3\u0391", "\u03bf\u03c3\u03b1"],
	["A\u0301\u03a3\u0301", "a\u0301\u03c2\u0301"],
	["A\u03a3\u0301B", "a\u03c3\u0301b"],
	["A'\u03a3'", "a'\u03c2'"],
	["A\u03a3'B", "a\u03c3'b"],
	["\u0345\u03a3", "\u0345\u03c3"],
	["A\u03a3\u0345", "a\u03c2\u0345"],
	["A\u03a3\u0345B", "a\u03c3\u0345b"],
	["A \u03a3", "a \u03c3"],
	["A\u03a3 B", "a\u03c2 b"],
	["\u{10400}\u{104b0}\u{1e900}", "\u{10428}\u{104d8}\u{1e922}"],
	["\u1c89\ua7ce\u{10d50}\u{16ea0}", "\u1c8a\ua7cf\u{10d70}\u{16ebb}"],
])("lowercases %j with Rust's default Unicode casing", (input, expected) => {
	for (const version of ["17.0.0", "18.0.0"]) {
		for (const original of [new Str(input), new RuntimeString(input)]) {
			const result = original.to_lowercase(new Str(version));
			expect(result).toBeInstanceOf(RuntimeString);
			expect(result.toNodeText()).toBe(expected);
			expect(original.toNodeText()).toBe(input);
		}
	}
});

it("does not depend on host lowercase tables or locale", () => {
	const lowercase = vi.spyOn(globalThis.String.prototype, "toLowerCase");
	const localeLowercase = vi.spyOn(
		globalThis.String.prototype,
		"toLocaleLowerCase",
	);
	try {
		const result = new Str("\u0130\ua7ceA\u03a3").to_lowercase(
			new Str("17.0.0"),
		);
		expect(lowercase).not.toHaveBeenCalled();
		expect(localeLowercase).not.toHaveBeenCalled();
		expect(result.toNodeText()).toBe("i\u0307\ua7cfa\u03c2");
	} finally {
		lowercase.mockRestore();
		localeLowercase.mockRestore();
	}
});

it("selects mappings and sigma context using the server's Unicode version", () => {
	const input = new Str(
		"\ua7dd\u03a3 A\u03a3\ua7dd \u{1df40} A\u0558\u03a3 A\u03a3\u0558B",
	);
	expect(input.to_lowercase(new Str("17.0.0")).toNodeText()).toBe(
		"\ua7dd\u03c3 a\u03c2\ua7dd \u{1df40} a\u0558\u03c3 a\u03c2\u0558b",
	);
	expect(input.to_lowercase(new Str("18.0.0")).toNodeText()).toBe(
		"\u0277\u03c2 a\u03c3\u0277 \u{1df41} a\u0558\u03c2 a\u03c3\u0558b",
	);
});

it.each([
	"19.0.0",
	"17.0.1",
	"__proto__",
	"constructor",
])("rejects unsupported Unicode version %s even for empty strings", (version) => {
	expect(() => new Str("").to_lowercase(new Str(version))).toThrow();
});
