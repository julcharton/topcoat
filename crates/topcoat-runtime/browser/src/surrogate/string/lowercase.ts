import {
	LOWERCASE_TABLES,
	type LowercaseRange,
	type LowercaseTables,
} from "./lowercase-data";

/** Unicode default lowercase, independent of the browser's Unicode version. */
export function lowercase(input: string, unicodeVersion: string): string {
	const tables = LOWERCASE_TABLES[unicodeVersion];
	if (
		!Object.hasOwn(LOWERCASE_TABLES, unicodeVersion) ||
		tables === undefined
	) {
		throw new Error(`Unsupported lowercase Unicode version: ${unicodeVersion}`);
	}
	let output = "";
	let precededByCased = false;
	let offset = 0;
	for (const character of input) {
		offset += character.length;
		if (
			character === "\u03a3" &&
			precededByCased &&
			!followedByCased(input, offset, tables)
		) {
			output += "\u03c2";
		} else {
			output += lowercaseCharacter(character, tables);
		}
		// Case_Ignorable takes precedence when a character has both properties.
		// Context is determined from the original input, before lowercasing.
		if (!tables.caseIgnorable.test(character)) {
			precededByCased = tables.cased.test(character);
		}
	}
	return output;
}

function followedByCased(
	input: string,
	offset: number,
	tables: LowercaseTables,
): boolean {
	while (offset < input.length) {
		const character = String.fromCodePoint(input.codePointAt(offset) as number);
		if (!tables.caseIgnorable.test(character))
			return tables.cased.test(character);
		offset += character.length;
	}
	return false;
}

function lowercaseCharacter(
	character: string,
	tables: LowercaseTables,
): string {
	const code = character.codePointAt(0) as number;
	const expansion = tables.expansions[code];
	if (expansion !== undefined) return expansion;
	let low = 0;
	let high = tables.ranges.length - 1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const [start, end, step, delta] = tables.ranges[middle] as LowercaseRange;
		if (code < start) {
			high = middle - 1;
		} else if (code > end) {
			low = middle + 1;
		} else {
			return (code - start) % step === 0
				? String.fromCodePoint(code + delta)
				: character;
		}
	}
	return character;
}
