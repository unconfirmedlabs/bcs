/**
 * Schema-driven WASM serialization/deserialization.
 *
 * Compiles BcsType trees into compact schema descriptors, packs JS values
 * into flat buffers, and delegates to WASM for BCS encoding/decoding.
 */

import type { BcsType } from "./bcs-type.js";
import type { BcsWasmExports } from "./wasm.js";
import { getWasm, loadWasmSync } from "./wasm.js";

// Schema tags — must match wasm/bcs.zig exactly
const TAG_BOOL = 0x01;
const TAG_U8 = 0x02;
const TAG_U16 = 0x03;
const TAG_U32 = 0x04;
const TAG_U64 = 0x05;
const TAG_U128 = 0x06;
const TAG_U256 = 0x07;
const TAG_STRING = 0x08;
const TAG_BYTES = 0x09;
const TAG_VECTOR = 0x0a;
const TAG_OPTION = 0x0b;
const TAG_STRUCT = 0x0c;
const TAG_ENUM = 0x0d;
const TAG_UNIT = 0x00;

// ── Schema node types (internal representation) ──────────────────────

export type SchemaNode =
	| { tag: typeof TAG_BOOL }
	| { tag: typeof TAG_U8 }
	| { tag: typeof TAG_U16 }
	| { tag: typeof TAG_U32 }
	| { tag: typeof TAG_U64 }
	| { tag: typeof TAG_U128 }
	| { tag: typeof TAG_U256 }
	| { tag: typeof TAG_STRING }
	| { tag: typeof TAG_BYTES; size: number; asArray?: boolean }
	| { tag: typeof TAG_VECTOR; element: SchemaNode }
	| { tag: typeof TAG_OPTION; inner: SchemaNode }
	| {
			tag: typeof TAG_STRUCT;
			fields: { key: string; schema: SchemaNode }[];
	  }
	| {
			tag: typeof TAG_ENUM;
			variants: { key: string; schema: SchemaNode | null }[];
	  }
	| { tag: typeof TAG_UNIT };

// ── Compile schema from BcsType ──────────────────────────────────────

const schemaCache = new WeakMap<BcsType<unknown, unknown>, SchemaNode>();

export function compileSchema(type: BcsType<unknown, unknown>): SchemaNode | null {
	if (schemaCache.has(type)) return schemaCache.get(type)!;

	const node = compileSchemaInner(type);
	if (node) schemaCache.set(type, node);
	return node;
}

function compileSchemaInner(
	type: BcsType<unknown, unknown>,
): SchemaNode | null {
	const name = type.name;

	// Primitives
	if (name === "bool") return { tag: TAG_BOOL };
	if (name === "u8") return { tag: TAG_U8 };
	if (name === "u16") return { tag: TAG_U16 };
	if (name === "u32") return { tag: TAG_U32 };
	if (name === "u64") return { tag: TAG_U64 };
	if (name === "u128") return { tag: TAG_U128 };
	if (name === "u256") return { tag: TAG_U256 };

	// Fixed byte arrays: bytes[N] → returns Uint8Array
	const bytesMatch = name.match(/^bytes\[(\d+)\]$/);
	if (bytesMatch) {
		return { tag: TAG_BYTES, size: parseInt(bytesMatch[1]!) };
	}

	// Vectors: vector<T>
	const vectorMatch = name.match(/^vector<(.+)>$/);
	if (vectorMatch) {
		const inner = getInnerType(type, "vector");
		if (!inner) return null;
		const elemSchema = compileSchemaInner(inner);
		if (!elemSchema) return null;
		return { tag: TAG_VECTOR, element: elemSchema };
	}

	// Options: Option<T> — these are transformed enums
	if (name.startsWith("Option<")) {
		const inner = getOptionInnerType(type);
		if (!inner) return null;
		const innerSchema = compileSchemaInner(inner);
		if (!innerSchema) return null;
		return { tag: TAG_OPTION, inner: innerSchema };
	}

	// Structs and enums — check constructor
	const ctor = (type as any).constructor?.name;

	if (ctor === "BcsStruct" || hasStructFields(type)) {
		const fields = getStructFields(type);
		if (!fields) return null;
		const fieldSchemas: { key: string; schema: SchemaNode }[] = [];
		for (const [key, fieldType] of fields) {
			const fieldSchema = compileSchemaInner(fieldType);
			if (!fieldSchema) return null;
			fieldSchemas.push({ key, schema: fieldSchema });
		}
		return { tag: TAG_STRUCT, fields: fieldSchemas };
	}

	if (ctor === "BcsEnum" || hasEnumFields(type)) {
		const variants = getEnumFields(type);
		if (!variants) return null;
		const variantSchemas: { key: string; schema: SchemaNode | null }[] = [];
		for (const [key, varType] of variants) {
			if (varType === null) {
				variantSchemas.push({ key, schema: null });
			} else {
				const varSchema = compileSchemaInner(varType);
				if (!varSchema) return null;
				variantSchemas.push({ key, schema: varSchema });
			}
		}
		return { tag: TAG_ENUM, variants: variantSchemas };
	}

	// Fixed arrays: T[N] pattern
	const fixedArrayMatch = name.match(/^(.+)\[(\d+)\]$/);
	if (fixedArrayMatch && !bytesMatch) {
		const inner = getInnerType(type, "fixedArray");
		if (!inner) return null;
		const elemSchema = compileSchemaInner(inner);
		if (!elemSchema) return null;
		// Fixed array of u8 = bytes (but returns number[] instead of Uint8Array)
		if (elemSchema.tag === TAG_U8) {
			return { tag: TAG_BYTES, size: parseInt(fixedArrayMatch[2]!), asArray: true };
		}
		// Non-u8 fixedArray — fall back to JS for now
		return null;
	}

	// Unsupported type — fall back to JS path
	return null;
}

// ── Internal type introspection helpers ──────────────────────────────

function getStructFields(
	type: BcsType<unknown, unknown>,
): [string, BcsType<unknown, unknown>][] | null {
	// Access the internal canonicalOrder from BcsStruct constructor closure
	const proto = Object.getPrototypeOf(type);
	// Try to find fields from the type's internal state
	// BcsStruct stores fields via closure, we can detect via serializedSize behavior
	return (type as any)._fields ?? null;
}

function getEnumFields(
	type: BcsType<unknown, unknown>,
): [string, BcsType<unknown, unknown> | null][] | null {
	return (type as any)._variants ?? null;
}

function hasStructFields(type: BcsType<unknown, unknown>): boolean {
	return (type as any)._fields != null;
}

function hasEnumFields(type: BcsType<unknown, unknown>): boolean {
	return (type as any)._variants != null;
}

function getInnerType(
	type: BcsType<unknown, unknown>,
	_kind: string,
): BcsType<unknown, unknown> | null {
	return (type as any)._elementType ?? null;
}

function getOptionInnerType(
	type: BcsType<unknown, unknown>,
): BcsType<unknown, unknown> | null {
	return (type as any)._optionInner ?? null;
}

// ── Encode schema to bytes ───────────────────────────────────────────

export function encodeSchema(node: SchemaNode): Uint8Array {
	const buf: number[] = [];
	encodeSchemaNode(node, buf);
	return new Uint8Array(buf);
}

function encodeSchemaNode(node: SchemaNode, buf: number[]): void {
	buf.push(node.tag);
	switch (node.tag) {
		case TAG_BOOL:
		case TAG_U8:
		case TAG_U16:
		case TAG_U32:
		case TAG_U64:
		case TAG_U128:
		case TAG_U256:
		case TAG_STRING:
		case TAG_UNIT:
			break;
		case TAG_BYTES:
			buf.push(node.size & 0xff, (node.size >> 8) & 0xff);
			break;
		case TAG_VECTOR:
			encodeSchemaNode(node.element, buf);
			break;
		case TAG_OPTION:
			encodeSchemaNode(node.inner, buf);
			break;
		case TAG_STRUCT:
			buf.push(node.fields.length);
			for (const f of node.fields) {
				encodeSchemaNode(f.schema, buf);
			}
			break;
		case TAG_ENUM:
			buf.push(node.variants.length);
			for (const v of node.variants) {
				if (v.schema === null) {
					buf.push(TAG_UNIT);
				} else {
					encodeSchemaNode(v.schema, buf);
				}
			}
			break;
	}
}

// ── Pack JS value into flat buffer ───────────────────────────────────

const textEncoder = new TextEncoder();

export function packValue(
	node: SchemaNode,
	value: unknown,
	view: DataView,
	bytes: Uint8Array,
	offset: number,
): number {
	switch (node.tag) {
		case TAG_BOOL:
			view.setUint8(offset, (value as boolean) ? 1 : 0);
			return offset + 1;
		case TAG_U8:
			view.setUint8(offset, value as number);
			return offset + 1;
		case TAG_U16:
			view.setUint16(offset, value as number, true);
			return offset + 2;
		case TAG_U32:
			view.setUint32(offset, value as number, true);
			return offset + 4;
		case TAG_U64:
			view.setBigUint64(offset, BigInt(value as string | number | bigint), true);
			return offset + 8;
		case TAG_U128: {
			const big = BigInt(value as string | number | bigint);
			view.setBigUint64(offset, big & 0xffff_ffff_ffff_ffffn, true);
			view.setBigUint64(offset + 8, big >> 64n, true);
			return offset + 16;
		}
		case TAG_U256: {
			const big = BigInt(value as string | number | bigint);
			const mask = 0xffff_ffff_ffff_ffffn;
			view.setBigUint64(offset, big & mask, true);
			view.setBigUint64(offset + 8, (big >> 64n) & mask, true);
			view.setBigUint64(offset + 16, (big >> 128n) & mask, true);
			view.setBigUint64(offset + 24, big >> 192n, true);
			return offset + 32;
		}
		case TAG_STRING: {
			let strBytes: Uint8Array;
			if (value instanceof Uint8Array) {
				// byteVector
				strBytes = value;
			} else if (typeof value === "string") {
				strBytes = textEncoder.encode(value);
			} else {
				// Iterable<number> for byteVector
				strBytes = new Uint8Array(value as Iterable<number>);
			}
			view.setUint32(offset, strBytes.length, true);
			bytes.set(strBytes, offset + 4);
			return offset + 4 + strBytes.length;
		}
		case TAG_BYTES: {
			const src =
				value instanceof Uint8Array
					? value
					: new Uint8Array(value as Iterable<number>);
			bytes.set(src, offset);
			return offset + node.size;
		}
		case TAG_VECTOR: {
			const arr = value as unknown[];
			view.setUint32(offset, arr.length, true);
			let pos = offset + 4;
			for (let i = 0; i < arr.length; i++) {
				pos = packValue(node.element, arr[i], view, bytes, pos);
			}
			return pos;
		}
		case TAG_OPTION: {
			if (value == null) {
				view.setUint8(offset, 0);
				return offset + 1;
			}
			view.setUint8(offset, 1);
			return packValue(node.inner, value, view, bytes, offset + 1);
		}
		case TAG_STRUCT: {
			const obj = value as Record<string, unknown>;
			let pos = offset;
			for (const f of node.fields) {
				pos = packValue(f.schema, obj[f.key], view, bytes, pos);
			}
			return pos;
		}
		case TAG_ENUM: {
			const obj = value as Record<string, unknown>;
			for (let i = 0; i < node.variants.length; i++) {
				const v = node.variants[i]!;
				if (v.key in obj && obj[v.key] !== undefined) {
					view.setUint32(offset, i, true);
					if (v.schema === null) {
						return offset + 4;
					}
					return packValue(v.schema, obj[v.key], view, bytes, offset + 4);
				}
			}
			return offset; // shouldn't happen if validated
		}
		case TAG_UNIT:
			return offset;
	}
}

// ── Unpack flat buffer to JS value ───────────────────────────────────

const textDecoder = new TextDecoder();

export function unpackValue(
	node: SchemaNode,
	view: DataView,
	bytes: Uint8Array,
	offset: number,
): { value: unknown; offset: number } {
	switch (node.tag) {
		case TAG_BOOL:
			return { value: view.getUint8(offset) === 1, offset: offset + 1 };
		case TAG_U8:
			return { value: view.getUint8(offset), offset: offset + 1 };
		case TAG_U16:
			return { value: view.getUint16(offset, true), offset: offset + 2 };
		case TAG_U32:
			return { value: view.getUint32(offset, true), offset: offset + 4 };
		case TAG_U64:
			return {
				value: view.getBigUint64(offset, true).toString(10),
				offset: offset + 8,
			};
		case TAG_U128: {
			const lo = view.getBigUint64(offset, true);
			const hi = view.getBigUint64(offset + 8, true);
			return { value: ((hi << 64n) | lo).toString(10), offset: offset + 16 };
		}
		case TAG_U256: {
			const a = view.getBigUint64(offset, true);
			const b = view.getBigUint64(offset + 8, true);
			const c = view.getBigUint64(offset + 16, true);
			const d = view.getBigUint64(offset + 24, true);
			return {
				value: ((d << 192n) | (c << 128n) | (b << 64n) | a).toString(10),
				offset: offset + 32,
			};
		}
		case TAG_STRING: {
			const len = view.getUint32(offset, true);
			const strBytes = bytes.subarray(offset + 4, offset + 4 + len);
			return {
				value: textDecoder.decode(strBytes),
				offset: offset + 4 + len,
			};
		}
		case TAG_BYTES: {
			if (node.asArray) {
				return { value: Array.from(bytes.subarray(offset, offset + node.size)), offset: offset + node.size };
			}
			return { value: bytes.slice(offset, offset + node.size), offset: offset + node.size };
		}
		case TAG_VECTOR: {
			const count = view.getUint32(offset, true);
			let pos = offset + 4;
			const result: unknown[] = new Array(count);
			for (let i = 0; i < count; i++) {
				const r = unpackValue(node.element, view, bytes, pos);
				result[i] = r.value;
				pos = r.offset;
			}
			return { value: result, offset: pos };
		}
		case TAG_OPTION: {
			const present = view.getUint8(offset);
			if (present === 0) {
				return { value: null, offset: offset + 1 };
			}
			const r = unpackValue(node.inner, view, bytes, offset + 1);
			return { value: r.value, offset: r.offset };
		}
		case TAG_STRUCT: {
			const obj: Record<string, unknown> = {};
			let pos = offset;
			for (const f of node.fields) {
				const r = unpackValue(f.schema, view, bytes, pos);
				obj[f.key] = r.value;
				pos = r.offset;
			}
			return { value: obj, offset: pos };
		}
		case TAG_ENUM: {
			const variantIdx = view.getUint32(offset, true);
			const variant = node.variants[variantIdx]!;
			if (variant.schema === null) {
				return {
					value: { [variant.key]: true, $kind: variant.key },
					offset: offset + 4,
				};
			}
			const r = unpackValue(variant.schema, view, bytes, offset + 4);
			return {
				value: { [variant.key]: r.value, $kind: variant.key },
				offset: r.offset,
			};
		}
		case TAG_UNIT:
			return { value: undefined, offset };
	}
}

// ── High-level WASM serialize/deserialize ────────────────────────────

let wasmReady = false;
let wasm: BcsWasmExports | null = null;
let bufferPtr = 0;

function ensureWasm(): BcsWasmExports | null {
	if (wasmReady) return wasm;
	wasmReady = true;
	try {
		wasm = getWasm() ?? loadWasmSync();
		bufferPtr = (wasm.getBufferPtr as unknown as () => number)();
	} catch {
		wasm = null;
	}
	return wasm;
}

// Cached schema bytes per SchemaNode
const encodedSchemaCache = new WeakMap<SchemaNode, Uint8Array>();

function getCachedSchemaBytes(node: SchemaNode): Uint8Array {
	let bytes = encodedSchemaCache.get(node);
	if (!bytes) {
		bytes = encodeSchema(node);
		encodedSchemaCache.set(node, bytes);
	}
	return bytes;
}

export function wasmSerialize(
	schema: SchemaNode,
	value: unknown,
): Uint8Array | null {
	const w = ensureWasm();
	if (!w) return null;

	const schemaBytes = getCachedSchemaBytes(schema);
	const inputArea = new Uint8Array(w.memory.buffer, bufferPtr, 32768);
	const inputView = new DataView(w.memory.buffer, bufferPtr, 32768);

	// Write schema
	inputArea.set(schemaBytes, 0);

	// Pack value after schema
	const dataStart = schemaBytes.length;
	const dataEnd = packValue(schema, value, inputView, inputArea, dataStart);
	const dataLen = dataEnd - dataStart;

	// Call WASM
	const resultLen = w.serializePacked(schemaBytes.length, dataLen);
	if (resultLen === 0) return null;

	// Read result from output area
	return new Uint8Array(w.memory.buffer, bufferPtr + 32768, resultLen).slice();
}

export function wasmDeserialize(
	schema: SchemaNode,
	bcsBytes: Uint8Array,
): unknown | null {
	const w = ensureWasm();
	if (!w) return null;

	const schemaBytes = getCachedSchemaBytes(schema);
	const inputArea = new Uint8Array(w.memory.buffer, bufferPtr, 32768);

	// Write schema + BCS data
	inputArea.set(schemaBytes, 0);
	inputArea.set(bcsBytes, schemaBytes.length);

	// Call WASM
	const resultLen = w.deserializeBcs(schemaBytes.length, bcsBytes.length);
	if (resultLen === 0) return null;

	// Read packed data from output area
	const outputArea = new Uint8Array(w.memory.buffer, bufferPtr + 32768, resultLen);
	const outputView = new DataView(w.memory.buffer, bufferPtr + 32768, resultLen);

	const { value } = unpackValue(schema, outputView, outputArea, 0);
	return value;
}
