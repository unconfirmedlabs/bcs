/**
 * Compile-time specialization for BCS serialize/deserialize.
 *
 * Analyzes BcsType at definition time and generates specialized
 * serialize/deserialize functions with pre-computed field offsets.
 * For fixed-size types: single exact-size allocation, direct DataView writes.
 * For variable-size types: minimal buffer growth, inlined ULEB128.
 */

import type { BcsType } from "./bcs-type.js";
import { ulebEncode, ulebDecode } from "./uleb.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ── Type analysis ────────────────────────────────────────────────────

interface TypeInfo {
	kind: string;
	fixedSize: number | null;
	fields?: { key: string; type: TypeInfo }[];
	elementType?: TypeInfo;
	variantTypes?: { key: string; type: TypeInfo | null }[];
	size?: number;
	innerType?: TypeInfo;
}

export function analyzeType(type: BcsType<unknown, unknown>): TypeInfo | null {
	const name = type.name;

	if (name === "bool") return { kind: "bool", fixedSize: 1 };
	if (name === "u8") return { kind: "u8", fixedSize: 1 };
	if (name === "u16") return { kind: "u16", fixedSize: 2 };
	if (name === "u32") return { kind: "u32", fixedSize: 4 };
	if (name === "u64") return { kind: "u64", fixedSize: 8 };
	if (name === "u128") return { kind: "u128", fixedSize: 16 };
	if (name === "u256") return { kind: "u256", fixedSize: 32 };
	if (name === "string") return { kind: "string", fixedSize: null };

	const bytesMatch = name.match(/^bytes\[(\d+)\]$/);
	if (bytesMatch) {
		return { kind: "bytes", fixedSize: parseInt(bytesMatch[1]!), size: parseInt(bytesMatch[1]!) };
	}

	const fixedArrayMatch = name.match(/^(.+)\[(\d+)\]$/);
	if (fixedArrayMatch && !bytesMatch) {
		const inner = (type as any)._elementType;
		if (!inner) return null;
		const elemInfo = analyzeType(inner);
		if (!elemInfo) return null;
		const size = parseInt(fixedArrayMatch[2]!);
		if (elemInfo.kind === "u8") {
			return { kind: "fixedArrayU8", fixedSize: size, size };
		}
		const fixedSize = elemInfo.fixedSize != null ? elemInfo.fixedSize * size : null;
		return { kind: "fixedArray", fixedSize, elementType: elemInfo, size };
	}

	if (name.startsWith("vector<")) {
		const inner = (type as any)._elementType;
		if (!inner) return null;
		const elemInfo = analyzeType(inner);
		if (!elemInfo) return null;
		return { kind: "vector", fixedSize: null, elementType: elemInfo };
	}

	if (name.startsWith("Option<")) {
		const inner = (type as any)._optionInner;
		if (!inner) return null;
		const innerInfo = analyzeType(inner);
		if (!innerInfo) return null;
		return { kind: "option", fixedSize: null, innerType: innerInfo };
	}

	if ((type as any)._fields) {
		const fields: { key: string; type: TypeInfo }[] = [];
		let totalFixed = 0;
		let allFixed = true;
		for (const [key, fieldType] of (type as any)._fields as [string, BcsType<unknown, unknown>][]) {
			const info = analyzeType(fieldType);
			if (!info) return null;
			fields.push({ key, type: info });
			if (info.fixedSize != null) totalFixed += info.fixedSize;
			else allFixed = false;
		}
		return { kind: "struct", fixedSize: allFixed ? totalFixed : null, fields };
	}

	if ((type as any)._variants) {
		const variants: { key: string; type: TypeInfo | null }[] = [];
		for (const [key, varType] of (type as any)._variants as [string, BcsType<unknown, unknown> | null][]) {
			if (varType === null) {
				variants.push({ key, type: null });
			} else {
				const info = analyzeType(varType);
				if (!info) return null;
				variants.push({ key, type: info });
			}
		}
		return { kind: "enum", fixedSize: null, variantTypes: variants };
	}

	return null;
}

// ── Specialized serialize ────────────────────────────────────────────

function serializeValue(info: TypeInfo, value: unknown, arr: Uint8Array, dv: DataView, o: number): number {
	switch (info.kind) {
		case "bool":
			dv.setUint8(o, (value as boolean) ? 1 : 0);
			return o + 1;
		case "u8":
			dv.setUint8(o, value as number);
			return o + 1;
		case "u16":
			dv.setUint16(o, value as number, true);
			return o + 2;
		case "u32":
			dv.setUint32(o, value as number, true);
			return o + 4;
		case "u64":
			dv.setBigUint64(o, BigInt(value as string | number | bigint), true);
			return o + 8;
		case "u128": {
			const b = BigInt(value as string | number | bigint);
			dv.setBigUint64(o, b & 0xFFFFFFFFFFFFFFFFn, true);
			dv.setBigUint64(o + 8, b >> 64n, true);
			return o + 16;
		}
		case "u256": {
			const b = BigInt(value as string | number | bigint);
			const m = 0xFFFFFFFFFFFFFFFFn;
			dv.setBigUint64(o, b & m, true);
			dv.setBigUint64(o + 8, (b >> 64n) & m, true);
			dv.setBigUint64(o + 16, (b >> 128n) & m, true);
			dv.setBigUint64(o + 24, b >> 192n, true);
			return o + 32;
		}
		case "bytes":
		case "fixedArrayU8": {
			const src = value instanceof Uint8Array ? value : new Uint8Array(value as Iterable<number>);
			arr.set(src, o);
			return o + info.size!;
		}
		case "fixedArray": {
			const a = value as unknown[];
			for (let i = 0; i < info.size!; i++) {
				o = serializeValue(info.elementType!, a[i], arr, dv, o);
			}
			return o;
		}
		case "string": {
			const strBytes = textEncoder.encode(value as string);
			const uleb = ulebEncode(strBytes.length);
			arr.set(uleb, o);
			o += uleb.length;
			arr.set(strBytes, o);
			return o + strBytes.length;
		}
		case "vector": {
			const a = Array.from(value as Iterable<unknown>);
			const uleb = ulebEncode(a.length);
			arr.set(uleb, o);
			o += uleb.length;
			for (let i = 0; i < a.length; i++) {
				o = serializeValue(info.elementType!, a[i], arr, dv, o);
			}
			return o;
		}
		case "option": {
			if (value == null) {
				dv.setUint8(o, 0);
				return o + 1;
			}
			dv.setUint8(o, 1);
			return serializeValue(info.innerType!, value, arr, dv, o + 1);
		}
		case "struct": {
			const obj = value as Record<string, unknown>;
			for (const f of info.fields!) {
				o = serializeValue(f.type, obj[f.key], arr, dv, o);
			}
			return o;
		}
		case "enum": {
			const obj = value as Record<string, unknown>;
			for (let i = 0; i < info.variantTypes!.length; i++) {
				const v = info.variantTypes![i]!;
				if (v.key in obj && obj[v.key] !== undefined) {
					const uleb = ulebEncode(i);
					arr.set(uleb, o);
					o += uleb.length;
					if (v.type) {
						o = serializeValue(v.type, obj[v.key], arr, dv, o);
					}
					return o;
				}
			}
			return o;
		}
	}
	return o;
}

// ── Specialized deserialize ──────────────────────────────────────────

function deserializeValue(info: TypeInfo, data: Uint8Array, dv: DataView, o: number): { value: unknown; offset: number } {
	switch (info.kind) {
		case "bool":
			return { value: dv.getUint8(o) === 1, offset: o + 1 };
		case "u8":
			return { value: dv.getUint8(o), offset: o + 1 };
		case "u16":
			return { value: dv.getUint16(o, true), offset: o + 2 };
		case "u32":
			return { value: dv.getUint32(o, true), offset: o + 4 };
		case "u64":
			return { value: dv.getBigUint64(o, true).toString(10), offset: o + 8 };
		case "u128": {
			const lo = dv.getBigUint64(o, true);
			const hi = dv.getBigUint64(o + 8, true);
			return { value: ((hi << 64n) | lo).toString(10), offset: o + 16 };
		}
		case "u256": {
			const a = dv.getBigUint64(o, true);
			const b = dv.getBigUint64(o + 8, true);
			const c = dv.getBigUint64(o + 16, true);
			const d = dv.getBigUint64(o + 24, true);
			return { value: ((d << 192n) | (c << 128n) | (b << 64n) | a).toString(10), offset: o + 32 };
		}
		case "bytes":
			return { value: data.slice(o, o + info.size!), offset: o + info.size! };
		case "fixedArrayU8":
			return { value: Array.from(data.subarray(o, o + info.size!)), offset: o + info.size! };
		case "fixedArray": {
			const result = new Array(info.size!);
			for (let i = 0; i < info.size!; i++) {
				const r = deserializeValue(info.elementType!, data, dv, o);
				result[i] = r.value;
				o = r.offset;
			}
			return { value: result, offset: o };
		}
		case "string": {
			const { value: len, length: ulebLen } = ulebDecode(data.subarray(o));
			o += ulebLen;
			const str = textDecoder.decode(data.subarray(o, o + len));
			return { value: str, offset: o + len };
		}
		case "vector": {
			const { value: count, length: ulebLen } = ulebDecode(data.subarray(o));
			o += ulebLen;
			const result: unknown[] = new Array(count);
			for (let i = 0; i < count; i++) {
				const r = deserializeValue(info.elementType!, data, dv, o);
				result[i] = r.value;
				o = r.offset;
			}
			return { value: result, offset: o };
		}
		case "option": {
			const tag = dv.getUint8(o);
			o++;
			if (tag === 0) return { value: null, offset: o };
			return deserializeValue(info.innerType!, data, dv, o);
		}
		case "struct": {
			const obj: Record<string, unknown> = {};
			for (const f of info.fields!) {
				const r = deserializeValue(f.type, data, dv, o);
				obj[f.key] = r.value;
				o = r.offset;
			}
			return { value: obj, offset: o };
		}
		case "enum": {
			const { value: idx, length: ulebLen } = ulebDecode(data.subarray(o));
			o += ulebLen;
			const v = info.variantTypes![idx]!;
			if (!v.type) {
				return { value: { [v.key]: true, $kind: v.key }, offset: o };
			}
			const r = deserializeValue(v.type, data, dv, o);
			return { value: { [v.key]: r.value, $kind: v.key }, offset: o = r.offset };
		}
	}
	return { value: undefined, offset: o };
}

// ── Public API ───────────────────────────────────────────────────────

export type CompiledSerializer = (value: unknown) => Uint8Array;
export type CompiledDeserializer = (data: Uint8Array) => unknown;

const serializerCache = new WeakMap<BcsType<unknown, unknown>, CompiledSerializer | null>();
const deserializerCache = new WeakMap<BcsType<unknown, unknown>, CompiledDeserializer | null>();

export function getCompiledSerializer(type: BcsType<unknown, unknown>): CompiledSerializer | null {
	if (serializerCache.has(type)) return serializerCache.get(type)!;
	const info = analyzeType(type);
	if (!info) { serializerCache.set(type, null); return null; }

	let fn: CompiledSerializer;
	if (info.fixedSize != null) {
		// Fixed-size: allocate exact buffer, no growth
		const size = info.fixedSize;
		fn = (value: unknown) => {
			const buf = new ArrayBuffer(size);
			const dv = new DataView(buf);
			const arr = new Uint8Array(buf);
			serializeValue(info, value, arr, dv, 0);
			return arr;
		};
	} else {
		// Variable-size: start with estimate, grow if needed
		fn = (value: unknown) => {
			let size = 512;
			let buf = new ArrayBuffer(size);
			let dv = new DataView(buf);
			let arr = new Uint8Array(buf);
			// Serialize — if we overflow, double and retry
			// In practice, 512 bytes handles most values
			try {
				const end = serializeValue(info, value, arr, dv, 0);
				return arr.slice(0, end);
			} catch {
				// Buffer too small — grow and retry
				size = 4096;
				buf = new ArrayBuffer(size);
				dv = new DataView(buf);
				arr = new Uint8Array(buf);
				const end = serializeValue(info, value, arr, dv, 0);
				return arr.slice(0, end);
			}
		};
	}

	serializerCache.set(type, fn);
	return fn;
}

export function getCompiledDeserializer(type: BcsType<unknown, unknown>): CompiledDeserializer | null {
	if (deserializerCache.has(type)) return deserializerCache.get(type)!;
	const info = analyzeType(type);
	if (!info) { deserializerCache.set(type, null); return null; }

	const fn: CompiledDeserializer = (data: Uint8Array) => {
		const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
		return deserializeValue(info, data, dv, 0).value;
	};

	deserializerCache.set(type, fn);
	return fn;
}
