import type { Encoding } from "./types.js";

// --- Hex ---

export function toHex(data: Uint8Array): string {
	return data.reduce(
		(str, byte) => str + byte.toString(16).padStart(2, "0"),
		"",
	);
}

export function fromHex(hexStr: string): Uint8Array {
	const normalized = hexStr.startsWith("0x") ? hexStr.slice(2) : hexStr;
	const padded = normalized.length % 2 === 0 ? normalized : `0${normalized}`;
	const intArr =
		padded.match(/[0-9a-fA-F]{2}/g)?.map((byte) => parseInt(byte, 16)) ??
		[];

	if (intArr.length !== padded.length / 2) {
		throw new Error(`Invalid hex string ${hexStr}`);
	}

	return Uint8Array.from(intArr);
}

// --- Base64 ---

export function toBase64(data: Uint8Array): string {
	// Use Buffer in Node/Bun, btoa in browser
	if (typeof Buffer !== "undefined") {
		return Buffer.from(data).toString("base64");
	}
	let binary = "";
	for (let i = 0; i < data.length; i++) {
		binary += String.fromCharCode(data[i]);
	}
	return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
	if (typeof Buffer !== "undefined") {
		const buf = Buffer.from(b64, "base64");
		return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
	}
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

// --- Base58 (Bitcoin alphabet) ---

const BASE58_ALPHABET =
	"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP = new Uint8Array(128).fill(255);
for (let i = 0; i < 58; i++) {
	BASE58_MAP[BASE58_ALPHABET.charCodeAt(i)] = i;
}

export function toBase58(data: Uint8Array): string {
	if (data.length === 0) return "";

	// Count leading zeros
	let zeros = 0;
	while (zeros < data.length && data[zeros] === 0) zeros++;

	// Allocate enough space in big-endian base58 representation
	const size = ((data.length - zeros) * 138) / 100 + 1;
	const b58 = new Uint8Array(Math.ceil(size));

	let length = 0;
	for (let i = zeros; i < data.length; i++) {
		let carry = data[i];
		let j = 0;
		for (
			let it = b58.length - 1;
			(carry !== 0 || j < length) && it >= 0;
			it--, j++
		) {
			carry += 256 * b58[it];
			b58[it] = carry % 58;
			carry = (carry / 58) | 0;
		}
		length = j;
	}

	// Skip leading zeros in base58 result
	let it = b58.length - length;
	while (it < b58.length && b58[it] === 0) it++;

	let str = "1".repeat(zeros);
	for (; it < b58.length; it++) {
		str += BASE58_ALPHABET[b58[it]];
	}
	return str;
}

export function fromBase58(str: string): Uint8Array {
	if (str.length === 0) return new Uint8Array(0);

	// Count leading '1's
	let zeros = 0;
	while (zeros < str.length && str[zeros] === "1") zeros++;

	const size = ((str.length - zeros) * 733) / 1000 + 1;
	const b256 = new Uint8Array(Math.ceil(size));

	let length = 0;
	for (let i = zeros; i < str.length; i++) {
		let carry = BASE58_MAP[str.charCodeAt(i)];
		if (carry === 255) {
			throw new Error(`Invalid base58 character: ${str[i]}`);
		}
		let j = 0;
		for (
			let it = b256.length - 1;
			(carry !== 0 || j < length) && it >= 0;
			it--, j++
		) {
			carry += 58 * b256[it];
			b256[it] = carry % 256;
			carry = (carry / 256) | 0;
		}
		length = j;
	}

	let it = b256.length - length;
	while (it < b256.length && b256[it] === 0) it++;

	const result = new Uint8Array(zeros + (b256.length - it));
	// Leading zeros are already 0 in the Uint8Array
	result.set(b256.subarray(it), zeros);
	return result;
}

// --- Encoding helpers ---

export function encodeStr(data: Uint8Array, encoding: Encoding): string {
	switch (encoding) {
		case "base58":
			return toBase58(data);
		case "base64":
			return toBase64(data);
		case "hex":
			return toHex(data);
		default:
			throw new Error(
				"Unsupported encoding, supported values are: base58, base64, hex",
			);
	}
}

export function decodeStr(data: string, encoding: Encoding): Uint8Array {
	switch (encoding) {
		case "base58":
			return fromBase58(data);
		case "base64":
			return fromBase64(data);
		case "hex":
			return fromHex(data);
		default:
			throw new Error(
				"Unsupported encoding, supported values are: base58, base64, hex",
			);
	}
}

export function splitGenericParameters(
	str: string,
	genericSeparators: [string, string] = ["<", ">"],
) {
	const [left, right] = genericSeparators;
	const tok: string[] = [];
	let word = "";
	let nestedAngleBrackets = 0;

	for (let i = 0; i < str.length; i++) {
		const char = str[i];
		if (char === left) nestedAngleBrackets++;
		if (char === right) nestedAngleBrackets--;
		if (nestedAngleBrackets === 0 && char === ",") {
			tok.push(word.trim());
			word = "";
			continue;
		}
		word += char;
	}

	tok.push(word.trim());
	return tok;
}
