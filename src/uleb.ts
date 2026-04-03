/**
 * ULEB128 encode/decode.
 *
 * Fast path uses plain number ops for values < 2^28 (covers 99.9% of BCS usage).
 * Falls back to BigInt for larger values up to MAX_SAFE_INTEGER.
 */

export function ulebEncode(num: number | bigint): number[] {
	if (num === 0 || num === 0n) return [0];

	// Fast path: values that fit in 32-bit unsigned
	if (typeof num === "number" && num < 0x100000000) {
		const arr: number[] = [];
		let n = num >>> 0;
		while (n > 0) {
			let byte = n & 0x7f;
			n >>>= 7;
			if (n > 0) byte |= 0x80;
			arr.push(byte);
		}
		return arr;
	}

	// BigInt path for larger values
	let big = BigInt(num);
	const arr: number[] = [];
	while (big > 0n) {
		let byte = Number(big & 0x7fn);
		big >>= 7n;
		if (big > 0n) byte |= 0x80;
		arr.push(byte);
	}
	return arr;
}

export function ulebDecode(arr: Uint8Array | number[]): {
	value: number;
	length: number;
} {
	let total = 0n;
	let shift = 0n;
	let len = 0;

	while (true) {
		if (len >= arr.length) {
			throw new Error("ULEB decode error: buffer overflow");
		}

		const byte = arr[len]!;
		len += 1;
		total += BigInt(byte & 0x7f) << shift;

		if ((byte & 0x80) === 0) {
			break;
		}
		shift += 7n;
	}

	if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error("ULEB decode error: value exceeds MAX_SAFE_INTEGER");
	}

	return { value: Number(total), length: len };
}
