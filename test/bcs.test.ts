import { test, expect, describe } from "bun:test";
import {
	bcs,
	BcsType,
	BcsReader,
	BcsWriter,
	BcsStruct,
	BcsEnum,
	BcsTuple,
	SerializedBcs,
	isSerializedBcs,
	compareBcsBytes,
	toHex,
	fromHex,
	toBase64,
	fromBase64,
	toBase58,
	fromBase58,
	encodeStr,
	decodeStr,
	splitGenericParameters,
	loadWasmSync,
	getWasm,
} from "../src/index.js";

// ── Primitives ─────────────────────────────────────────────────────────

describe("u8", () => {
	const type = bcs.u8();

	test("serialize 0", () => {
		expect(type.serialize(0).toBytes()).toEqual(new Uint8Array([0]));
	});

	test("serialize 255", () => {
		expect(type.serialize(255).toBytes()).toEqual(new Uint8Array([255]));
	});

	test("roundtrip", () => {
		expect(type.parse(type.serialize(42).toBytes())).toBe(42);
	});

	test("rejects negative", () => {
		expect(() => type.serialize(-1)).toThrow();
	});

	test("rejects overflow", () => {
		expect(() => type.serialize(256)).toThrow();
	});
});

describe("u16", () => {
	const type = bcs.u16();

	test("serialize little-endian", () => {
		expect(type.serialize(256).toBytes()).toEqual(new Uint8Array([0, 1]));
	});

	test("serialize max", () => {
		expect(type.serialize(65535).toBytes()).toEqual(
			new Uint8Array([255, 255]),
		);
	});

	test("roundtrip", () => {
		expect(type.parse(type.serialize(1000).toBytes())).toBe(1000);
	});
});

describe("u32", () => {
	const type = bcs.u32();

	test("serialize little-endian", () => {
		expect(type.serialize(1).toBytes()).toEqual(
			new Uint8Array([1, 0, 0, 0]),
		);
	});

	test("serialize max", () => {
		expect(type.serialize(4294967295).toBytes()).toEqual(
			new Uint8Array([255, 255, 255, 255]),
		);
	});

	test("roundtrip", () => {
		expect(type.parse(type.serialize(123456789).toBytes())).toBe(123456789);
	});
});

describe("u64", () => {
	const type = bcs.u64();

	test("serialize 1", () => {
		expect(type.serialize(1).toBytes()).toEqual(
			new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]),
		);
	});

	test("accepts number", () => {
		expect(type.serialize(42).toBytes()).toEqual(
			new Uint8Array([42, 0, 0, 0, 0, 0, 0, 0]),
		);
	});

	test("accepts bigint", () => {
		expect(type.serialize(42n).toBytes()).toEqual(
			new Uint8Array([42, 0, 0, 0, 0, 0, 0, 0]),
		);
	});

	test("accepts string", () => {
		expect(type.serialize("42").toBytes()).toEqual(
			new Uint8Array([42, 0, 0, 0, 0, 0, 0, 0]),
		);
	});

	test("returns string on parse", () => {
		const result = type.parse(type.serialize(42).toBytes());
		expect(result).toBe("42");
		expect(typeof result).toBe("string");
	});

	test("roundtrip large value", () => {
		const val = "18446744073709551615"; // u64 max
		expect(type.parse(type.serialize(val).toBytes())).toBe(val);
	});

	test("rejects negative", () => {
		expect(() => type.serialize(-1)).toThrow();
	});
});

describe("u128", () => {
	const type = bcs.u128();

	test("serialize 1", () => {
		const bytes = type.serialize(1).toBytes();
		expect(bytes.length).toBe(16);
		expect(bytes[0]).toBe(1);
		for (let i = 1; i < 16; i++) expect(bytes[i]).toBe(0);
	});

	test("roundtrip max", () => {
		const max = (2n ** 128n - 1n).toString();
		expect(type.parse(type.serialize(max).toBytes())).toBe(max);
	});

	test("roundtrip", () => {
		const val = "340282366920938463463374607431768211455";
		expect(type.parse(type.serialize(val).toBytes())).toBe(val);
	});
});

describe("u256", () => {
	const type = bcs.u256();

	test("serialize 1", () => {
		const bytes = type.serialize(1).toBytes();
		expect(bytes.length).toBe(32);
		expect(bytes[0]).toBe(1);
	});

	test("roundtrip max", () => {
		const max = (2n ** 256n - 1n).toString();
		expect(type.parse(type.serialize(max).toBytes())).toBe(max);
	});

	test("roundtrip specific value", () => {
		const val =
			"12345678901234567890123456789012345678901234567890123456789012345678";
		expect(type.parse(type.serialize(val).toBytes())).toBe(val);
	});
});

describe("bool", () => {
	const type = bcs.bool();

	test("serialize true", () => {
		expect(type.serialize(true).toBytes()).toEqual(new Uint8Array([1]));
	});

	test("serialize false", () => {
		expect(type.serialize(false).toBytes()).toEqual(new Uint8Array([0]));
	});

	test("roundtrip", () => {
		expect(type.parse(type.serialize(true).toBytes())).toBe(true);
		expect(type.parse(type.serialize(false).toBytes())).toBe(false);
	});

	test("rejects non-boolean", () => {
		expect(() => type.serialize(1 as any)).toThrow();
	});
});

// ── ULEB128 ────────────────────────────────────────────────────────────

describe("uleb128", () => {
	const type = bcs.uleb128();

	test("encode 0", () => {
		expect(type.serialize(0).toBytes()).toEqual(new Uint8Array([0]));
	});

	test("encode 127", () => {
		expect(type.serialize(127).toBytes()).toEqual(new Uint8Array([127]));
	});

	test("encode 128", () => {
		expect(type.serialize(128).toBytes()).toEqual(
			new Uint8Array([0x80, 0x01]),
		);
	});

	test("encode 300", () => {
		expect(type.serialize(300).toBytes()).toEqual(
			new Uint8Array([0xac, 0x02]),
		);
	});

	test("roundtrip", () => {
		for (const val of [0, 1, 127, 128, 255, 256, 16383, 16384, 1000000]) {
			expect(type.parse(type.serialize(val).toBytes())).toBe(val);
		}
	});
});

// ── String ─────────────────────────────────────────────────────────────

describe("string", () => {
	const type = bcs.string();

	test("serialize empty", () => {
		expect(type.serialize("").toBytes()).toEqual(new Uint8Array([0]));
	});

	test("serialize 'a'", () => {
		expect(type.serialize("a").toBytes()).toEqual(
			new Uint8Array([1, 97]),
		);
	});

	test("roundtrip", () => {
		const val = "hello world";
		expect(type.parse(type.serialize(val).toBytes())).toBe(val);
	});

	test("roundtrip unicode", () => {
		const val = "Hello, 世界! 🌍";
		expect(type.parse(type.serialize(val).toBytes())).toBe(val);
	});

	test("rejects non-string", () => {
		expect(() => type.serialize(42 as any)).toThrow();
	});
});

// ── Bytes ──────────────────────────────────────────────────────────────

describe("bytes", () => {
	test("fixed size", () => {
		const type = bcs.bytes(3);
		const bytes = type.serialize(new Uint8Array([1, 2, 3])).toBytes();
		expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
	});

	test("roundtrip", () => {
		const type = bcs.bytes(32);
		const input = new Uint8Array(32).fill(0xab);
		expect(type.parse(type.serialize(input).toBytes())).toEqual(input);
	});

	test("rejects wrong length", () => {
		const type = bcs.bytes(3);
		expect(() => type.serialize(new Uint8Array([1, 2]))).toThrow();
	});
});

describe("byteVector", () => {
	test("serialize with length prefix", () => {
		const type = bcs.byteVector();
		expect(type.serialize(new Uint8Array([1, 2, 3])).toBytes()).toEqual(
			new Uint8Array([3, 1, 2, 3]),
		);
	});

	test("roundtrip", () => {
		const type = bcs.byteVector();
		const input = new Uint8Array([10, 20, 30, 40, 50]);
		expect(type.parse(type.serialize(input).toBytes())).toEqual(input);
	});

	test("empty vector", () => {
		const type = bcs.byteVector();
		expect(type.serialize(new Uint8Array(0)).toBytes()).toEqual(
			new Uint8Array([0]),
		);
	});
});

// ── Vector ─────────────────────────────────────────────────────────────

describe("vector", () => {
	test("vector<u8>", () => {
		const type = bcs.vector(bcs.u8());
		const bytes = type.serialize([1, 2, 3]).toBytes();
		expect(bytes).toEqual(new Uint8Array([3, 1, 2, 3]));
	});

	test("vector<u32>", () => {
		const type = bcs.vector(bcs.u32());
		const result = type.parse(type.serialize([1, 2]).toBytes());
		expect(result).toEqual([1, 2]);
	});

	test("empty vector", () => {
		const type = bcs.vector(bcs.u8());
		expect(type.serialize([]).toBytes()).toEqual(new Uint8Array([0]));
	});

	test("nested vector", () => {
		const type = bcs.vector(bcs.vector(bcs.u8()));
		const input = [
			[1, 2],
			[3, 4, 5],
		];
		expect(type.parse(type.serialize(input).toBytes())).toEqual(input);
	});

	test("vector<string>", () => {
		const type = bcs.vector(bcs.string());
		const input = ["hello", "world"];
		expect(type.parse(type.serialize(input).toBytes())).toEqual(input);
	});
});

// ── Fixed Array ────────────────────────────────────────────────────────

describe("fixedArray", () => {
	test("no length prefix", () => {
		const type = bcs.fixedArray(3, bcs.u8());
		expect(type.serialize([1, 2, 3]).toBytes()).toEqual(
			new Uint8Array([1, 2, 3]),
		);
	});

	test("roundtrip", () => {
		const type = bcs.fixedArray(2, bcs.u32());
		expect(type.parse(type.serialize([100, 200]).toBytes())).toEqual([
			100, 200,
		]);
	});

	test("rejects wrong length", () => {
		const type = bcs.fixedArray(3, bcs.u8());
		expect(() => type.serialize([1, 2])).toThrow();
	});
});

// ── Option ─────────────────────────────────────────────────────────────

describe("option", () => {
	test("None", () => {
		const type = bcs.option(bcs.u8());
		expect(type.serialize(null).toBytes()).toEqual(new Uint8Array([0]));
	});

	test("Some", () => {
		const type = bcs.option(bcs.u8());
		expect(type.serialize(1).toBytes()).toEqual(new Uint8Array([1, 1]));
	});

	test("roundtrip None", () => {
		const type = bcs.option(bcs.u8());
		expect(type.parse(type.serialize(null).toBytes())).toBe(null);
	});

	test("roundtrip Some", () => {
		const type = bcs.option(bcs.u8());
		expect(type.parse(type.serialize(42).toBytes())).toBe(42);
	});

	test("accepts undefined as None", () => {
		const type = bcs.option(bcs.u8());
		expect(type.serialize(undefined).toBytes()).toEqual(
			new Uint8Array([0]),
		);
	});

	test("option<string>", () => {
		const type = bcs.option(bcs.string());
		expect(type.parse(type.serialize("hello").toBytes())).toBe("hello");
		expect(type.parse(type.serialize(null).toBytes())).toBe(null);
	});
});

// ── Struct ──────────────────────────────────────────────────────────────

describe("struct", () => {
	test("simple struct", () => {
		const MyStruct = bcs.struct("MyStruct", {
			a: bcs.u8(),
			b: bcs.u16(),
		});
		const bytes = MyStruct.serialize({ a: 1, b: 256 }).toBytes();
		expect(bytes).toEqual(new Uint8Array([1, 0, 1]));
	});

	test("roundtrip", () => {
		const MyStruct = bcs.struct("MyStruct", {
			name: bcs.string(),
			age: bcs.u8(),
			active: bcs.bool(),
		});
		const input = { name: "Alice", age: 30, active: true };
		expect(MyStruct.parse(MyStruct.serialize(input).toBytes())).toEqual(
			input,
		);
	});

	test("nested struct", () => {
		const Inner = bcs.struct("Inner", {
			x: bcs.u32(),
		});
		const Outer = bcs.struct("Outer", {
			inner: Inner,
			y: bcs.bool(),
		});
		const input = { inner: { x: 42 }, y: true };
		expect(Outer.parse(Outer.serialize(input).toBytes())).toEqual(input);
	});

	test("struct with vectors", () => {
		const S = bcs.struct("S", {
			items: bcs.vector(bcs.u8()),
			label: bcs.string(),
		});
		const input = { items: [1, 2, 3], label: "test" };
		expect(S.parse(S.serialize(input).toBytes())).toEqual(input);
	});

	test("rejects non-object", () => {
		const S = bcs.struct("S", { a: bcs.u8() });
		expect(() => S.serialize(42 as any)).toThrow();
	});
});

// ── Enum ────────────────────────────────────────────────────────────────

describe("enum", () => {
	test("data-less variant", () => {
		const E = bcs.enum("E", {
			A: null,
			B: null,
		});
		expect(E.serialize({ A: true }).toBytes()).toEqual(
			new Uint8Array([0]),
		);
		expect(E.serialize({ B: true }).toBytes()).toEqual(
			new Uint8Array([1]),
		);
	});

	test("variant with data", () => {
		const E = bcs.enum("E", {
			Num: bcs.u8(),
			Str: bcs.string(),
			None: null,
		});
		expect(E.serialize({ Num: 42 }).toBytes()).toEqual(
			new Uint8Array([0, 42]),
		);
	});

	test("roundtrip with $kind", () => {
		const E = bcs.enum("E", {
			A: bcs.u8(),
			B: bcs.string(),
			C: null,
		});

		const a = E.parse(E.serialize({ A: 1 }).toBytes());
		expect(a.$kind).toBe("A");
		expect(a.A).toBe(1);

		const b = E.parse(E.serialize({ B: "hi" }).toBytes());
		expect(b.$kind).toBe("B");
		expect(b.B).toBe("hi");

		const c = E.parse(E.serialize({ C: true }).toBytes());
		expect(c.$kind).toBe("C");
		expect(c.C).toBe(true);
	});

	test("rejects multiple keys", () => {
		const E = bcs.enum("E", {
			A: bcs.u8(),
			B: bcs.u8(),
		});
		expect(() => E.serialize({ A: 1, B: 2 } as any)).toThrow();
	});
});

// ── Tuple ───────────────────────────────────────────────────────────────

describe("tuple", () => {
	test("serialize", () => {
		const T = bcs.tuple([bcs.u8(), bcs.bool()]);
		expect(T.serialize([1, true]).toBytes()).toEqual(
			new Uint8Array([1, 1]),
		);
	});

	test("roundtrip", () => {
		const T = bcs.tuple([bcs.u8(), bcs.string(), bcs.bool()]);
		const input: [number, string, boolean] = [42, "hello", false];
		expect(T.parse(T.serialize(input).toBytes())).toEqual(input);
	});

	test("rejects wrong length", () => {
		const T = bcs.tuple([bcs.u8(), bcs.u8()]);
		expect(() => T.serialize([1] as any)).toThrow();
	});

	test("name generation", () => {
		const T = bcs.tuple([bcs.u8(), bcs.string()]);
		expect(T.name).toBe("(u8, string)");
	});
});

// ── Map ─────────────────────────────────────────────────────────────────

describe("map", () => {
	test("serialize and sort by key bytes", () => {
		const type = bcs.map(bcs.u8(), bcs.string());
		const m = new Map([
			[2, "b"],
			[1, "a"],
		]);
		const result = type.parse(type.serialize(m).toBytes());
		expect(result.get(1)).toBe("a");
		expect(result.get(2)).toBe("b");
	});

	test("empty map", () => {
		const type = bcs.map(bcs.u8(), bcs.u8());
		const m = new Map<number, number>();
		const result = type.parse(type.serialize(m).toBytes());
		expect(result.size).toBe(0);
	});

	test("roundtrip with string keys", () => {
		const type = bcs.map(bcs.string(), bcs.u32());
		const m = new Map([
			["alice", 100],
			["bob", 200],
		]);
		const result = type.parse(type.serialize(m).toBytes());
		expect(result.get("alice")).toBe(100);
		expect(result.get("bob")).toBe(200);
	});
});

// ── Transform ──────────────────────────────────────────────────────────

describe("transform", () => {
	test("input transform", () => {
		const HexAddress = bcs.bytes(32).transform({
			input: (hex: string) => fromHex(hex),
			output: (bytes: Uint8Array) => toHex(bytes),
		});

		const hex = "ab".repeat(32);
		const result = HexAddress.parse(
			HexAddress.serialize(hex).toBytes(),
		);
		expect(result).toBe(hex);
	});

	test("output transform", () => {
		const BigU64 = bcs.u64().transform({
			output: (val: string) => BigInt(val),
		});

		const result = BigU64.parse(BigU64.serialize(42).toBytes());
		expect(result).toBe(42n);
	});
});

// ── Lazy ────────────────────────────────────────────────────────────────

describe("lazy", () => {
	test("basic lazy", () => {
		const LazyU8 = bcs.lazy(() => bcs.u8());
		expect(LazyU8.parse(LazyU8.serialize(42).toBytes())).toBe(42);
	});

	test("recursive type", () => {
		type Tree = {
			value: number;
			children: Tree[];
		};

		const TreeType: BcsType<Tree> = bcs.struct("Tree", {
			value: bcs.u32(),
			children: bcs.vector(bcs.lazy(() => TreeType)),
		}) as any;

		const tree: Tree = {
			value: 1,
			children: [
				{ value: 2, children: [] },
				{ value: 3, children: [{ value: 4, children: [] }] },
			],
		};

		const result = TreeType.parse(TreeType.serialize(tree).toBytes());
		expect(result.value).toBe(1);
		expect(result.children.length).toBe(2);
		expect(result.children[1]!.children[0]!.value).toBe(4);
	});
});

// ── SerializedBcs ──────────────────────────────────────────────────────

describe("SerializedBcs", () => {
	test("toHex", () => {
		const s = bcs.u8().serialize(255);
		expect(s.toHex()).toBe("ff");
	});

	test("toBase64", () => {
		const s = bcs.u8().serialize(255);
		expect(s.toBase64()).toBe("/w==");
	});

	test("toBase58", () => {
		const s = bcs.u8().serialize(255);
		const b58 = s.toBase58();
		expect(typeof b58).toBe("string");
		// Roundtrip through fromBase58
		expect(fromBase58(b58)).toEqual(new Uint8Array([255]));
	});

	test("parse roundtrip", () => {
		const s = bcs.string().serialize("hello");
		expect(s.parse()).toBe("hello");
	});

	test("isSerializedBcs", () => {
		const s = bcs.u8().serialize(1);
		expect(isSerializedBcs(s)).toBe(true);
		expect(isSerializedBcs({})).toBe(false);
		expect(isSerializedBcs(null)).toBe(false);
	});
});

// ── BcsWriter ──────────────────────────────────────────────────────────

describe("BcsWriter", () => {
	test("grows buffer", () => {
		const writer = new BcsWriter({ initialSize: 4 });
		for (let i = 0; i < 100; i++) {
			writer.write8(i);
		}
		expect(writer.toBytes().length).toBe(100);
	});

	test("respects maxSize", () => {
		const writer = new BcsWriter({ initialSize: 4, maxSize: 8 });
		writer.write32(1);
		writer.write32(2);
		expect(() => writer.write8(3)).toThrow();
	});

	test("writeBytes bulk copy", () => {
		const writer = new BcsWriter();
		const data = new Uint8Array(1000).fill(0xab);
		writer.writeBytes(data);
		expect(writer.toBytes()).toEqual(data);
	});

	test("toString hex", () => {
		const writer = new BcsWriter();
		writer.write8(255);
		writer.write8(0);
		expect(writer.toString("hex")).toBe("ff00");
	});

	test("iterator", () => {
		const writer = new BcsWriter();
		writer.write8(1);
		writer.write8(2);
		writer.write8(3);
		expect([...writer]).toEqual([1, 2, 3]);
	});
});

// ── BcsReader ──────────────────────────────────────────────────────────

describe("BcsReader", () => {
	test("readVec", () => {
		const data = new Uint8Array([3, 10, 20, 30]);
		const reader = new BcsReader(data);
		const result = reader.readVec((r) => r.read8());
		expect(result).toEqual([10, 20, 30]);
	});

	test("shift", () => {
		const data = new Uint8Array([1, 2, 3]);
		const reader = new BcsReader(data);
		reader.shift(1);
		expect(reader.read8()).toBe(2);
	});
});

// ── Encoding utilities ─────────────────────────────────────────────────

describe("encoding", () => {
	test("hex roundtrip", () => {
		const data = new Uint8Array([0, 1, 127, 128, 255]);
		expect(fromHex(toHex(data))).toEqual(data);
	});

	test("hex with 0x prefix", () => {
		expect(fromHex("0xff")).toEqual(new Uint8Array([255]));
	});

	test("base64 roundtrip", () => {
		const data = new Uint8Array([0, 1, 127, 128, 255]);
		expect(fromBase64(toBase64(data))).toEqual(data);
	});

	test("base58 roundtrip", () => {
		const data = new Uint8Array([0, 0, 1, 127, 128, 255]);
		expect(fromBase58(toBase58(data))).toEqual(data);
	});

	test("base58 leading zeros", () => {
		const data = new Uint8Array([0, 0, 0, 1]);
		const encoded = toBase58(data);
		expect(encoded.startsWith("111")).toBe(true);
		expect(fromBase58(encoded)).toEqual(data);
	});

	test("encodeStr / decodeStr", () => {
		const data = new Uint8Array([1, 2, 3]);
		expect(decodeStr(encodeStr(data, "hex"), "hex")).toEqual(data);
		expect(decodeStr(encodeStr(data, "base64"), "base64")).toEqual(data);
		expect(decodeStr(encodeStr(data, "base58"), "base58")).toEqual(data);
	});

	test("fromHex / parse", () => {
		const type = bcs.u8();
		expect(type.fromHex("ff")).toBe(255);
	});

	test("fromBase64 / parse", () => {
		const type = bcs.u8();
		expect(type.fromBase64(toBase64(new Uint8Array([42])))).toBe(42);
	});
});

describe("splitGenericParameters", () => {
	test("simple", () => {
		expect(splitGenericParameters("A, B, C")).toEqual(["A", "B", "C"]);
	});

	test("nested", () => {
		expect(splitGenericParameters("A<B, C>, D")).toEqual(["A<B, C>", "D"]);
	});

	test("deeply nested", () => {
		expect(splitGenericParameters("A<B<C, D>>, E")).toEqual([
			"A<B<C, D>>",
			"E",
		]);
	});
});

// ── compareBcsBytes ────────────────────────────────────────────────────

describe("compareBcsBytes", () => {
	test("equal", () => {
		expect(
			compareBcsBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])),
		).toBe(0);
	});

	test("less", () => {
		expect(
			compareBcsBytes(new Uint8Array([1, 1]), new Uint8Array([1, 2])),
		).toBeLessThan(0);
	});

	test("greater", () => {
		expect(
			compareBcsBytes(new Uint8Array([2, 1]), new Uint8Array([1, 2])),
		).toBeGreaterThan(0);
	});

	test("shorter is less", () => {
		expect(
			compareBcsBytes(new Uint8Array([1]), new Uint8Array([1, 2])),
		).toBeLessThan(0);
	});
});

// ── Cross-compatibility with @mysten/bcs byte output ───────────────────

describe("byte compatibility", () => {
	test("struct serialization matches @mysten/bcs format", () => {
		const S = bcs.struct("S", {
			a: bcs.u8(),
			b: bcs.string(),
		});
		const bytes = S.serialize({ a: 1, b: "a" }).toBytes();
		// u8(1) = [1], string("a") = ULEB(1) + [97] = [1, 97]
		expect(bytes).toEqual(new Uint8Array([1, 1, 97]));
	});

	test("enum serialization matches @mysten/bcs format", () => {
		const E = bcs.enum("E", {
			A: bcs.u8(),
			B: bcs.string(),
			C: null,
		});
		// Variant A (index 0) with value 1
		expect(E.serialize({ A: 1 }).toBytes()).toEqual(
			new Uint8Array([0, 1]),
		);
		// Variant B (index 1) with value "a"
		expect(E.serialize({ B: "a" }).toBytes()).toEqual(
			new Uint8Array([1, 1, 97]),
		);
		// Variant C (index 2) with no data
		expect(E.serialize({ C: true }).toBytes()).toEqual(
			new Uint8Array([2]),
		);
	});

	test("option matches enum-based encoding", () => {
		const opt = bcs.option(bcs.u8());
		// None = enum variant 0
		expect(opt.serialize(null).toBytes()).toEqual(new Uint8Array([0]));
		// Some(42) = enum variant 1 + u8(42)
		expect(opt.serialize(42).toBytes()).toEqual(new Uint8Array([1, 42]));
	});

	test("vector<u32> matches @mysten/bcs", () => {
		const v = bcs.vector(bcs.u32());
		const bytes = v.serialize([1, 256]).toBytes();
		// ULEB(2) = [2], u32(1) = [1,0,0,0], u32(256) = [0,1,0,0]
		expect(bytes).toEqual(
			new Uint8Array([2, 1, 0, 0, 0, 0, 1, 0, 0]),
		);
	});

	test("map sorts keys by serialized bytes", () => {
		const type = bcs.map(bcs.u8(), bcs.u8());
		const m = new Map([
			[3, 30],
			[1, 10],
			[2, 20],
		]);
		const bytes = type.serialize(m).toBytes();
		// Should be sorted: 1->10, 2->20, 3->30
		expect(bytes).toEqual(
			new Uint8Array([3, 1, 10, 2, 20, 3, 30]),
		);
	});
});

// ── WASM module ────────────────────────────────────────────────────────

describe("wasm", () => {
	test("loads synchronously", () => {
		const wasm = loadWasmSync();
		expect(wasm).toBeDefined();
		expect(wasm.getBufferPtr).toBeDefined();
		expect(wasm.encodeUleb128).toBeDefined();
	});

	test("ULEB128 encode matches TypeScript", () => {
		const wasm = loadWasmSync();
		const output = new Uint8Array(
			wasm.memory.buffer,
			wasm.getBufferPtr() + 32768,
			32768,
		);

		for (const val of [0, 1, 127, 128, 255, 300, 16384, 1000000]) {
			const wasmLen = wasm.encodeUleb128(val);
			const tsBytes = bcs.uleb128().serialize(val).toBytes();

			const wasmBytes = output.slice(0, wasmLen);
			expect(wasmBytes).toEqual(tsBytes);
		}
	});

	test("ULEB128 decode matches TypeScript", () => {
		const wasm = loadWasmSync();
		const inputView = new Uint8Array(
			wasm.memory.buffer,
			wasm.getBufferPtr(),
			32768,
		);

		for (const val of [0, 1, 127, 128, 300, 16384]) {
			// Encode with TS, decode with WASM
			const encoded = bcs.uleb128().serialize(val).toBytes();
			inputView.set(encoded, 0);

			const packed = wasm.decodeUleb128(0);
			const decoded = Number(packed >> 8n);
			const bytesRead = Number(packed & 0xffn);

			expect(decoded).toBe(val);
			expect(bytesRead).toBe(encoded.length);
		}
	});

	test("u64 encode matches TypeScript", () => {
		const wasm = loadWasmSync();
		const output = new Uint8Array(
			wasm.memory.buffer,
			wasm.getBufferPtr() + 32768,
			32768,
		);

		const val = 0xdeadbeefcafebaben;
		const lo = Number(val & 0xffffffffn);
		const hi = Number(val >> 32n);

		wasm.encodeU64(lo, hi);
		const wasmBytes = output.slice(0, 8);
		const tsBytes = bcs.u64().serialize(val).toBytes();

		expect(wasmBytes).toEqual(tsBytes);
	});

	test("serializeU64 via bcs-zig matches TypeScript", () => {
		const wasm = loadWasmSync();
		const output = new Uint8Array(
			wasm.memory.buffer,
			wasm.getBufferPtr() + 32768,
			32768,
		);

		const val = 42n;
		const lo = Number(val & 0xffffffffn);
		const hi = Number(val >> 32n);

		const len = wasm.serializeU64(lo, hi);
		const wasmBytes = output.slice(0, len);
		const tsBytes = bcs.u64().serialize(val).toBytes();

		expect(wasmBytes).toEqual(tsBytes);
	});
});

// ── Sui-specific patterns ──────────────────────────────────────────────

describe("sui patterns", () => {
	test("address (32 bytes)", () => {
		const Address = bcs.bytes(32);
		const addr = new Uint8Array(32).fill(0x42);
		expect(Address.parse(Address.serialize(addr).toBytes())).toEqual(addr);
	});

	test("ObjectRef struct", () => {
		const ObjectRef = bcs.struct("ObjectRef", {
			objectId: bcs.bytes(32),
			version: bcs.u64(),
			digest: bcs.bytes(32),
		});

		const ref = {
			objectId: new Uint8Array(32).fill(0x01),
			version: "100",
			digest: new Uint8Array(32).fill(0x02),
		};

		const result = ObjectRef.parse(ObjectRef.serialize(ref).toBytes());
		expect(result.objectId).toEqual(ref.objectId);
		expect(result.version).toBe("100");
		expect(result.digest).toEqual(ref.digest);
	});

	test("transaction-like enum", () => {
		const Command = bcs.enum("Command", {
			MoveCall: bcs.struct("MoveCall", {
				package: bcs.bytes(32),
				module: bcs.string(),
				function: bcs.string(),
			}),
			TransferObjects: bcs.struct("TransferObjects", {
				objects: bcs.vector(bcs.u16()),
				address: bcs.u16(),
			}),
			SplitCoins: null,
		});

		const cmd = {
			MoveCall: {
				package: new Uint8Array(32).fill(0x02),
				module: "coin",
				function: "transfer",
			},
		};

		const result = Command.parse(Command.serialize(cmd).toBytes());
		expect(result.$kind).toBe("MoveCall");
		expect(result.MoveCall!.module).toBe("coin");
	});
});
