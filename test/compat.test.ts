/**
 * Drop-in compatibility proof — these tests are ported directly from
 * @mysten/bcs's own test suite (ts-sdks/packages/bcs/tests/).
 * They run against @unconfirmed/bcs to prove byte-identical output.
 */

import { test, expect, describe } from "bun:test";
import {
	bcs,
	BcsReader,
	BcsWriter,
	BcsType,
	fromBase58,
	fromBase64,
	fromHex,
	toBase58,
	toBase64,
	toHex,
} from "../src/index.js";
import { ulebEncode, ulebDecode } from "../src/uleb.js";

// ━━━ builder.test.ts (ported from @mysten/bcs) ━━━━━━━━━━━━━━━━━━━━━

function testType<T, Input>(
	name: string,
	schema: BcsType<T, Input>,
	value: Input,
	hex: string,
	expected: T = value as never,
) {
	test(name, () => {
		const serialized = schema.serialize(value);
		const bytes = serialized.toBytes();
		expect(toHex(bytes)).toBe(hex);
		expect(serialized.toHex()).toBe(hex);
		expect(serialized.toBase64()).toBe(toBase64(bytes));
		expect(serialized.toBase58()).toBe(toBase58(bytes));

		const deserialized = schema.parse(bytes);
		expect(deserialized).toEqual(expected);

		const writer = new BcsWriter({ initialSize: bytes.length });
		schema.write(value, writer);
		expect(toHex(writer.toBytes())).toBe(hex);

		const reader = new BcsReader(bytes);
		expect(schema.read(reader)).toEqual(expected);
	});
}

describe("@mysten/bcs compat: base types", () => {
	testType("true", bcs.bool(), true, "01");
	testType("false", bcs.bool(), false, "00");
	testType("uleb128 0", bcs.uleb128(), 0, "00");
	testType("uleb128 1", bcs.uleb128(), 1, "01");
	testType("uleb128 127", bcs.uleb128(), 127, "7f");
	testType("uleb128 128", bcs.uleb128(), 128, "8001");
	testType("uleb128 255", bcs.uleb128(), 255, "ff01");
	testType("uleb128 256", bcs.uleb128(), 256, "8002");
	testType("uleb128 16383", bcs.uleb128(), 16383, "ff7f");
	testType("uleb128 16384", bcs.uleb128(), 16384, "808001");
	testType("uleb128 2097151", bcs.uleb128(), 2097151, "ffff7f");
	testType("uleb128 2097152", bcs.uleb128(), 2097152, "80808001");
	testType("uleb128 268435455", bcs.uleb128(), 268435455, "ffffff7f");
	testType("uleb128 268435456", bcs.uleb128(), 268435456, "8080808001");
	testType("u8 0", bcs.u8(), 0, "00");
	testType("u8 1", bcs.u8(), 1, "01");
	testType("u8 255", bcs.u8(), 255, "ff");
	testType("u16 0", bcs.u16(), 0, "0000");
	testType("u16 1", bcs.u16(), 1, "0100");
	testType("u16 255", bcs.u16(), 255, "ff00");
	testType("u16 256", bcs.u16(), 256, "0001");
	testType("u16 65535", bcs.u16(), 65535, "ffff");
	testType("u32 0", bcs.u32(), 0, "00000000");
	testType("u32 1", bcs.u32(), 1, "01000000");
	testType("u32 255", bcs.u32(), 255, "ff000000");
	testType("u32 256", bcs.u32(), 256, "00010000");
	testType("u32 65535", bcs.u32(), 65535, "ffff0000");
	testType("u32 65536", bcs.u32(), 65536, "00000100");
	testType("u32 16777215", bcs.u32(), 16777215, "ffffff00");
	testType("u32 16777216", bcs.u32(), 16777216, "00000001");
	testType("u32 4294967295", bcs.u32(), 4294967295, "ffffffff");
	testType("u64 0", bcs.u64(), 0, "0000000000000000", "0");
	testType("u64 1", bcs.u64(), 1, "0100000000000000", "1");
	testType("u64 255", bcs.u64(), 255n, "ff00000000000000", "255");
	testType("u64 256", bcs.u64(), 256n, "0001000000000000", "256");
	testType("u64 65535", bcs.u64(), 65535n, "ffff000000000000", "65535");
	testType("u64 65536", bcs.u64(), 65536n, "0000010000000000", "65536");
	testType(
		"u64 16777215",
		bcs.u64(),
		16777215n,
		"ffffff0000000000",
		"16777215",
	);
	testType(
		"u64 16777216",
		bcs.u64(),
		16777216n,
		"0000000100000000",
		"16777216",
	);
	testType(
		"u64 4294967295",
		bcs.u64(),
		4294967295n,
		"ffffffff00000000",
		"4294967295",
	);
	testType(
		"u64 4294967296",
		bcs.u64(),
		4294967296n,
		"0000000001000000",
		"4294967296",
	);
	testType(
		"u64 1099511627775",
		bcs.u64(),
		1099511627775n,
		"ffffffffff000000",
		"1099511627775",
	);
	testType(
		"u64 1099511627776",
		bcs.u64(),
		1099511627776n,
		"0000000000010000",
		"1099511627776",
	);
	testType(
		"u64 281474976710655",
		bcs.u64(),
		281474976710655n,
		"ffffffffffff0000",
		"281474976710655",
	);
	testType(
		"u64 281474976710656",
		bcs.u64(),
		281474976710656n,
		"0000000000000100",
		"281474976710656",
	);
	testType(
		"u64 72057594037927935",
		bcs.u64(),
		72057594037927935n,
		"ffffffffffffff00",
		"72057594037927935",
	);
	testType(
		"u64 72057594037927936",
		bcs.u64(),
		72057594037927936n,
		"0000000000000001",
		"72057594037927936",
	);
	testType(
		"u64 18446744073709551615",
		bcs.u64(),
		18446744073709551615n,
		"ffffffffffffffff",
		"18446744073709551615",
	);
	testType(
		"u128 0",
		bcs.u128(),
		0n,
		"00000000000000000000000000000000",
		"0",
	);
	testType(
		"u128 1",
		bcs.u128(),
		1n,
		"01000000000000000000000000000000",
		"1",
	);
	testType(
		"u128 255",
		bcs.u128(),
		255n,
		"ff000000000000000000000000000000",
		"255",
	);
	testType(
		"u128 18446744073709551615",
		bcs.u128(),
		18446744073709551615n,
		"ffffffffffffffff0000000000000000",
		"18446744073709551615",
	);
	testType(
		"u128 18446744073709551616",
		bcs.u128(),
		18446744073709551616n,
		"00000000000000000100000000000000",
		"18446744073709551616",
	);
	testType(
		"u128 340282366920938463463374607431768211455",
		bcs.u128(),
		340282366920938463463374607431768211455n,
		"ffffffffffffffffffffffffffffffff",
		"340282366920938463463374607431768211455",
	);
});

describe("@mysten/bcs compat: vector", () => {
	testType("vector([])", bcs.vector(bcs.u8()), [], "00");
	testType(
		"vector([1, 2, 3])",
		bcs.vector(bcs.u8()),
		[1, 2, 3],
		"03010203",
	);
	testType(
		"vector([1, null, 3])",
		bcs.vector(bcs.option(bcs.u8())),
		[1, null, 3],
		"03" + "0101" + "00" + "0103",
	);
});

describe("@mysten/bcs compat: fixedArray", () => {
	testType("fixedArray([])", bcs.fixedArray(0, bcs.u8()), [], "");
	testType(
		"fixedArray([1, 2, 3])",
		bcs.fixedArray(3, bcs.u8()),
		[1, 2, 3],
		"010203",
	);
	testType(
		"fixedArray([1, null, 3])",
		bcs.fixedArray(3, bcs.option(bcs.u8())),
		[1, null, 3],
		"0101" + "00" + "0103",
	);
});

describe("@mysten/bcs compat: options", () => {
	testType(
		"optional u8 undefined",
		bcs.option(bcs.u8()),
		undefined,
		"00",
		null,
	);
	testType("optional u8 null", bcs.option(bcs.u8()), null, "00");
	testType("optional u8 0", bcs.option(bcs.u8()), 0, "0100");
	testType(
		"optional vector(null)",
		bcs.option(bcs.vector(bcs.u8())),
		null,
		"00",
	);
	testType(
		"optional vector([1, 2, 3])",
		bcs.option(bcs.vector(bcs.option(bcs.u8()))),
		[1, null, 3],
		"01" + "03" + "0101" + "00" + "0103",
	);
});

describe("@mysten/bcs compat: string", () => {
	testType("string empty", bcs.string(), "", "00");
	testType("string hello", bcs.string(), "hello", "0568656c6c6f");
	testType(
		"string unicode",
		bcs.string(),
		"çå∞≠¢õß∂ƒ∫",
		"18c3a7c3a5e2889ee289a0c2a2c3b5c39fe28882c692e288ab",
	);
});

describe("@mysten/bcs compat: bytes", () => {
	testType(
		"bytes",
		bcs.bytes(4),
		new Uint8Array([1, 2, 3, 4]),
		"01020304",
	);
});

describe("@mysten/bcs compat: byteVector", () => {
	testType(
		"byteVector",
		bcs.byteVector(),
		new Uint8Array([1, 2, 3]),
		"03010203",
	);
});

describe("@mysten/bcs compat: tuples", () => {
	testType(
		"tuple(u8, u8)",
		bcs.tuple([bcs.u8(), bcs.u8()]),
		[1, 2],
		"0102",
	);
	testType(
		"tuple(u8, string, boolean)",
		bcs.tuple([bcs.u8(), bcs.string(), bcs.bool()]),
		[1, "hello", true],
		"010568656c6c6f01",
	);
	testType(
		"tuple(null, u8)",
		bcs.tuple([bcs.option(bcs.u8()), bcs.option(bcs.u8())]),
		[null, 1],
		"000101",
	);
});

describe("@mysten/bcs compat: structs", () => {
	const MyStruct = bcs.struct("MyStruct", {
		boolean: bcs.bool(),
		bytes: bcs.vector(bcs.u8()),
		label: bcs.string(),
	});

	const Wrapper = bcs.struct("Wrapper", {
		inner: MyStruct,
		name: bcs.string(),
	});

	testType(
		"struct { boolean: bool, bytes: Vec<u8>, label: String }",
		MyStruct,
		{
			boolean: true,
			bytes: new Uint8Array([0xc0, 0xde]),
			label: "a",
		},
		"0102c0de0161",
		{
			boolean: true,
			bytes: [0xc0, 0xde],
			label: "a",
		},
	);

	testType(
		"struct { inner: MyStruct, name: String }",
		Wrapper,
		{
			inner: {
				boolean: true,
				bytes: new Uint8Array([0xc0, 0xde]),
				label: "a",
			},
			name: "b",
		},
		"0102c0de01610162",
		{
			inner: {
				boolean: true,
				bytes: [0xc0, 0xde],
				label: "a",
			},
			name: "b",
		},
	);
});

describe("@mysten/bcs compat: enums", () => {
	const E = bcs.enum("E", {
		Variant0: bcs.u16(),
		Variant1: bcs.u8(),
		Variant2: bcs.string(),
	});

	testType("Enum::Variant0(1)", E, { Variant0: 1 }, "000100", {
		$kind: "Variant0",
		Variant0: 1,
	});
	testType("Enum::Variant1(1)", E, { Variant1: 1 }, "0101", {
		$kind: "Variant1",
		Variant1: 1,
	});
	testType(
		'Enum::Variant2("hello")',
		E,
		{ Variant2: "hello" },
		"020568656c6c6f",
		{
			$kind: "Variant2",
			Variant2: "hello",
		},
	);
});

describe("@mysten/bcs compat: map", () => {
	test("entries sorted by serialized key bytes", () => {
		const unsortedMap = new Map([
			["zebra", 1],
			["apple", 2],
			["mango", 3],
		]);
		const mapType = bcs.map(bcs.string(), bcs.u8());
		const serialized = mapType.serialize(unsortedMap);
		const parsed = mapType.parse(serialized.toBytes());
		expect([...parsed.keys()]).toEqual(["apple", "mango", "zebra"]);
	});

	test("numeric keys sort by BCS bytes", () => {
		const unsortedMap = new Map([
			[256, "b"],
			[1, "a"],
			[65535, "c"],
		]);
		const mapType = bcs.map(bcs.u16(), bcs.string());
		const serialized = mapType.serialize(unsortedMap);
		const parsed = mapType.parse(serialized.toBytes());
		expect([...parsed.keys()]).toEqual([256, 1, 65535]);
	});

	test("string keys of different lengths", () => {
		const unsortedMap = new Map([
			["abc", 1],
			["a", 2],
			["ab", 3],
		]);
		const mapType = bcs.map(bcs.string(), bcs.u8());
		const serialized = mapType.serialize(unsortedMap);
		const parsed = mapType.parse(serialized.toBytes());
		expect([...parsed.keys()]).toEqual(["a", "ab", "abc"]);
	});

	test("empty map", () => {
		const emptyMap = new Map<string, number>();
		const mapType = bcs.map(bcs.string(), bcs.u8());
		const serialized = mapType.serialize(emptyMap);
		expect(toHex(serialized.toBytes())).toBe("00");
		expect(mapType.parse(serialized.toBytes())).toEqual(new Map());
	});

	test("round-trip preserves values", () => {
		const originalMap = new Map([
			["key1", "value1"],
			["key2", "value2"],
		]);
		const mapType = bcs.map(bcs.string(), bcs.string());
		const serialized = mapType.serialize(originalMap);
		const parsed = mapType.parse(serialized.toBytes());
		expect(parsed.get("key1")).toBe("value1");
		expect(parsed.get("key2")).toBe("value2");
	});
});

describe("@mysten/bcs compat: transform", () => {
	const stringU8 = bcs.u8().transform({
		input: (val: string) => parseInt(val),
		output: (val) => val.toString(),
	});
	testType("transform input+output", stringU8, "1", "01", "1");

	const bigIntu64 = bcs.u64().transform({
		output: (val) => BigInt(val),
	});
	testType("transform output only (string)", bigIntu64, "1", "0100000000000000", 1n);
	testType("transform output only (number)", bigIntu64, 1, "0100000000000000", 1n);
	testType("transform output only (bigint)", bigIntu64, 1n, "0100000000000000", 1n);

	const hexU8 = bcs.u8().transform({
		input: (val: string) => Number.parseInt(val, 16),
	});
	testType("transform input only", hexU8, "ff", "ff", 255);
});

// ━━━ bcs.test.ts (ported from @mysten/bcs) ━━━━━━━━━━━━━━━━━━━━━━━━

describe("@mysten/bcs compat: primitives", () => {
	test("growing buffer size", () => {
		const Coin = bcs.struct("Coin", {
			value: bcs.u64(),
			owner: bcs.string(),
			is_locked: bcs.bool(),
		});

		const rustBcs = "gNGxBWAAAAAOQmlnIFdhbGxldCBHdXkA";
		const expected = {
			owner: "Big Wallet Guy",
			value: "412412400000",
			is_locked: false,
		};

		const setBytes = Coin.serialize(expected, {
			initialSize: 1,
			maxSize: 1024,
		});

		expect(Coin.parse(fromBase64(rustBcs))).toEqual(expected);
		expect(setBytes.toBase64()).toEqual(rustBcs);
	});

	test("error when exceeding max size", () => {
		const Coin = bcs.struct("Coin", {
			value: bcs.u64(),
			owner: bcs.string(),
			is_locked: bcs.bool(),
		});

		expect(() =>
			Coin.serialize(
				{
					owner: "Big Wallet Guy",
					value: 412412400000n,
					is_locked: false,
				},
				{ initialSize: 1, maxSize: 1 },
			),
		).toThrowError();
	});

	test("non-zero buffer offset", () => {
		const Coin = bcs.struct("Coin", {
			value: bcs.u64(),
			owner: bcs.string(),
			is_locked: bcs.bool(),
		});

		const rustBcs = "gNGxBWAAAAAOQmlnIFdhbGxldCBHdXkA";
		const bytes = fromBase64(rustBcs);

		const buffer = new ArrayBuffer(bytes.length + 10);
		const array = new Uint8Array(buffer, 10, bytes.length);
		for (let i = 0; i < bytes.length; i++) {
			array[i] = bytes[i]!;
		}

		expect(toBase64(array)).toEqual(rustBcs);

		expect(Coin.parse(array)).toEqual({
			owner: "Big Wallet Guy",
			value: "412412400000",
			is_locked: false,
		});
	});
});

// ━━━ encodings.test.ts (ported from @mysten/bcs) ━━━━━━━━━━━━━━━━━━

describe("@mysten/bcs compat: encodings", () => {
	test("de/ser hex, base58 and base64", () => {
		expect(bcs.u8().parse(fromBase64("AA=="))).toEqual(0);
		expect(bcs.u8().parse(fromHex("00"))).toEqual(0);
		expect(bcs.u8().parse(fromBase58("1"))).toEqual(0);

		const STR = "this is a test string";
		const str = bcs.string().serialize(STR);

		expect(bcs.string().parse(fromBase58(str.toBase58()))).toEqual(STR);
		expect(bcs.string().parse(fromBase64(str.toBase64()))).toEqual(STR);
		expect(bcs.string().parse(fromHex(str.toHex()))).toEqual(STR);
	});

	test("hex with leading zeros", () => {
		expect(toHex(Uint8Array.from([0, 1]))).toEqual("0001");
		expect(fromHex("0x1")).toEqual(Uint8Array.from([1]));
		expect(fromHex("1")).toEqual(Uint8Array.from([1]));
		expect(fromHex("111")).toEqual(Uint8Array.from([1, 17]));
		expect(fromHex("001")).toEqual(Uint8Array.from([0, 1]));
		expect(fromHex("011")).toEqual(Uint8Array.from([0, 17]));
		expect(fromHex("0011")).toEqual(Uint8Array.from([0, 17]));
		expect(fromHex("0x0011")).toEqual(Uint8Array.from([0, 17]));
	});

	test("invalid hex throws", () => {
		expect(() => fromHex("0xZZ")).toThrow("Invalid hex string 0xZZ");
		expect(() => fromHex("GG")).toThrow("Invalid hex string GG");
		expect(() => fromHex("hello")).toThrow("Invalid hex string hello");
		expect(() => fromHex("12 34")).toThrow("Invalid hex string 12 34");
		expect(() => fromHex("12\n34")).toThrow("Invalid hex string 12\n34");
		expect(() => fromHex("12-34")).toThrow("Invalid hex string 12-34");
	});
});

// ━━━ uleb.test.ts (ported from @mysten/bcs) ━━━━━━━━━━━━━━━━━━━━━━━

describe("@mysten/bcs compat: ULEB128", () => {
	describe("encode", () => {
		test("zero", () => expect(ulebEncode(0)).toEqual([0]));
		test("1", () => expect(ulebEncode(1)).toEqual([1]));
		test("127", () => expect(ulebEncode(127)).toEqual([127]));
		test("128", () =>
			expect(ulebEncode(128)).toEqual([0x80, 0x01]));
		test("129", () =>
			expect(ulebEncode(129)).toEqual([0x81, 0x01]));
		test("255", () =>
			expect(ulebEncode(255)).toEqual([0xff, 0x01]));
		test("300", () =>
			expect(ulebEncode(300)).toEqual([0xac, 0x02]));
		test("16384", () =>
			expect(ulebEncode(16384)).toEqual([0x80, 0x80, 0x01]));
		test("2097152", () =>
			expect(ulebEncode(2097152)).toEqual([0x80, 0x80, 0x80, 0x01]));
		test("2^31", () =>
			expect(ulebEncode(2147483648)).toEqual([
				0x80, 0x80, 0x80, 0x80, 0x08,
			]));
		test("2^32 - 1", () =>
			expect(ulebEncode(4294967295)).toEqual([
				0xff, 0xff, 0xff, 0xff, 0x0f,
			]));
		test("2^32", () =>
			expect(ulebEncode(4294967296)).toEqual([
				0x80, 0x80, 0x80, 0x80, 0x10,
			]));
		test("2^40 - 1", () =>
			expect(ulebEncode(1099511627775)).toEqual([
				0xff, 0xff, 0xff, 0xff, 0xff, 0x1f,
			]));
		test("MAX_SAFE_INTEGER", () =>
			expect(ulebEncode(Number.MAX_SAFE_INTEGER)).toEqual([
				0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f,
			]));
	});

	describe("decode", () => {
		test("zero", () => {
			expect(ulebDecode([0])).toEqual({ value: 0, length: 1 });
		});
		test("1", () => {
			expect(ulebDecode([1])).toEqual({ value: 1, length: 1 });
		});
		test("127", () => {
			expect(ulebDecode([127])).toEqual({ value: 127, length: 1 });
		});
		test("128", () => {
			expect(ulebDecode([0x80, 0x01])).toEqual({
				value: 128,
				length: 2,
			});
		});
		test("300", () => {
			expect(ulebDecode([0xac, 0x02])).toEqual({
				value: 300,
				length: 2,
			});
		});
		test("16384", () => {
			expect(ulebDecode([0x80, 0x80, 0x01])).toEqual({
				value: 16384,
				length: 3,
			});
		});
		test("2^31", () => {
			expect(ulebDecode([0x80, 0x80, 0x80, 0x80, 0x08])).toEqual({
				value: 2147483648,
				length: 5,
			});
		});
		test("2^32 - 1", () => {
			expect(ulebDecode([0xff, 0xff, 0xff, 0xff, 0x0f])).toEqual({
				value: 4294967295,
				length: 5,
			});
		});
		test("2^32", () => {
			expect(ulebDecode([0x80, 0x80, 0x80, 0x80, 0x10])).toEqual({
				value: 4294967296,
				length: 5,
			});
		});
		test("2^40 - 1", () => {
			expect(
				ulebDecode([0xff, 0xff, 0xff, 0xff, 0xff, 0x1f]),
			).toEqual({ value: 1099511627775, length: 6 });
		});
		test("MAX_SAFE_INTEGER", () => {
			expect(
				ulebDecode([
					0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f,
				]),
			).toEqual({ value: Number.MAX_SAFE_INTEGER, length: 8 });
		});
		test("Uint8Array input", () => {
			expect(ulebDecode(new Uint8Array([0x80, 0x01]))).toEqual({
				value: 128,
				length: 2,
			});
		});
		test("extra data after encoded value", () => {
			const result = ulebDecode([0x80, 0x01, 0xff, 0xff]);
			expect(result.value).toBe(128);
			expect(result.length).toBe(2);
		});
		test("multi-byte sequences from issue reproduction", () => {
			expect(ulebDecode([0x80, 0x00])).toEqual({
				value: 0,
				length: 2,
			});
			expect(ulebDecode([0xff, 0xff, 0xff, 0xff, 0x07])).toEqual({
				value: 2147483647,
				length: 5,
			});
			expect(ulebDecode([0xff, 0xff, 0xff, 0xff, 0x0f])).toEqual({
				value: 4294967295,
				length: 5,
			});
			expect(ulebDecode([0xff, 0xff, 0xff, 0xff, 0x1f])).toEqual({
				value: 8589934591,
				length: 5,
			});
		});
	});

	describe("malformed input", () => {
		test("empty buffer", () => {
			expect(() => ulebDecode([])).toThrow(
				"ULEB decode error: buffer overflow",
			);
		});
		test("continuation without termination", () => {
			expect(() => ulebDecode([0x80])).toThrow(
				"ULEB decode error: buffer overflow",
			);
			expect(() => ulebDecode([0x81])).toThrow(
				"ULEB decode error: buffer overflow",
			);
			expect(() => ulebDecode([0xff])).toThrow(
				"ULEB decode error: buffer overflow",
			);
			expect(() => ulebDecode([0x80, 0x80])).toThrow(
				"ULEB decode error: buffer overflow",
			);
		});
	});

	describe("round-trip", () => {
		test("encode/decode consistency", () => {
			const testValues = [
				0, 1, 127, 128, 129, 255, 256, 300, 1000, 16384, 65535,
				1000000, 2097152, 2147483648, 4294967295, 4294967296,
				1099511627775, Number.MAX_SAFE_INTEGER,
			];
			for (const value of testValues) {
				const encoded = ulebEncode(value);
				const decoded = ulebDecode(encoded);
				expect(decoded.value).toBe(value);
				expect(decoded.length).toBe(encoded.length);
			}
		});

		test("extra data preserved", () => {
			const encoded = ulebEncode(300);
			const withExtra = [...encoded, 0xaa, 0xbb, 0xcc];
			const result = ulebDecode(withExtra);
			expect(result.value).toBe(300);
			expect(result.length).toBe(encoded.length);
		});
	});
});
