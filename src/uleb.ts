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
	if (arr.length === 0) {
		throw new Error("ULEB decode error: buffer overflow");
	}

	// Fast path: single byte (value 0-127) — covers ~99% of BCS lengths
	const b0 = arr[0]!;
	if ((b0 & 0x80) === 0) return { value: b0, length: 1 };

	// Multi-byte: use number ops for up to 4 bytes, then BigInt for larger
	let total = b0 & 0x7f;
	let shift = 7;
	let len = 1;

	while (len < arr.length) {
		if (len >= 8) throw new Error("ULEB decode error: value too large");
		const byte = arr[len]!;
		len++;
		if (shift < 28) {
			total |= (byte & 0x7f) << shift;
		} else {
			// For shifts >= 28, use multiplication to avoid 32-bit truncation
			total += (byte & 0x7f) * (2 ** shift);
		}
		if ((byte & 0x80) === 0) {
			if (total > Number.MAX_SAFE_INTEGER) {
				throw new Error("ULEB decode error: value exceeds MAX_SAFE_INTEGER");
			}
			return { value: total, length: len };
		}
		shift += 7;
	}

	throw new Error("ULEB decode error: buffer overflow");
}
