/**
 * Schema-driven code generation for BCS serialize/deserialize.
 *
 * At schema definition time, generates straight-line JS functions via
 * new Function() with:
 * - Pre-computed field offsets for fixed-size types
 * - Direct property access (v.fieldName) instead of obj[key]
 * - Inline ULEB128 writes (no array allocation)
 * - Singleton reusable buffer (no per-call allocation)
 *
 * Approach modeled on protobuf.js, avsc, and SchemaPack.
 */

import type { BcsType } from "./bcs-type.js";

// ── Shared buffer singleton ──────────────────────────────────────────
// Reused across all serialize calls. Only the final .slice() copies out.

let sharedBuf = new ArrayBuffer(4096);
let sharedDv = new DataView(sharedBuf);
let sharedArr = new Uint8Array(sharedBuf);

function ensureCapacity(needed: number) {
	if (needed <= sharedBuf.byteLength) return;
	const size = Math.max(needed, sharedBuf.byteLength * 2);
	sharedBuf = new ArrayBuffer(size);
	sharedDv = new DataView(sharedBuf);
	sharedArr = new Uint8Array(sharedBuf);
}

// Exposed to generated functions via closure
const _env = {
	dv: sharedDv,
	arr: sharedArr,
	ensure: ensureCapacity,
	refreshViews() {
		this.dv = sharedDv;
		this.arr = sharedArr;
	},
	// Inline ULEB128 write — no allocation
	writeULEB(offset: number, value: number): number {
		const a = this.arr;
		while (value > 0x7f) {
			a[offset++] = (value & 0x7f) | 0x80;
			value >>>= 7;
		}
		a[offset++] = value;
		return offset;
	},
	// Inline ULEB128 read — no allocation
	readULEB(data: Uint8Array, offset: number): { val: number; end: number } {
		let val = 0;
		let shift = 0;
		let o = offset;
		while (true) {
			const byte = data[o++]!;
			val |= (byte & 0x7f) << shift;
			if ((byte & 0x80) === 0) break;
			shift += 7;
		}
		return { val, end: o };
	},
	enc: new TextEncoder(),
	dec: new TextDecoder(),
};

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

export function analyzeType(
	type: BcsType<unknown, unknown>,
): TypeInfo | null {
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
		const size = parseInt(bytesMatch[1]!);
		return { kind: "bytes", fixedSize: size, size };
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
		const fixedSize =
			elemInfo.fixedSize != null ? elemInfo.fixedSize * size : null;
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
		for (const [key, fieldType] of (type as any)._fields as [
			string,
			BcsType<unknown, unknown>,
		][]) {
			const info = analyzeType(fieldType);
			if (!info) return null;
			fields.push({ key, type: info });
			if (info.fixedSize != null) totalFixed += info.fixedSize;
			else allFixed = false;
		}
		return {
			kind: "struct",
			fixedSize: allFixed ? totalFixed : null,
			fields,
		};
	}

	if ((type as any)._variants) {
		const variants: { key: string; type: TypeInfo | null }[] = [];
		for (const [key, varType] of (type as any)._variants as [
			string,
			BcsType<unknown, unknown> | null,
		][]) {
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

// ── Serialize codegen ────────────────────────────────────────────────

let _varCounter = 0;
function nextVar(): string {
	return `_${_varCounter++}`;
}

function genSerialize(info: TypeInfo, vExpr: string, lines: string[]): void {
	switch (info.kind) {
		case "bool":
			lines.push(`E.dv.setUint8(o,${vExpr}?1:0);o+=1;`);
			break;
		case "u8":
			lines.push(`E.dv.setUint8(o,${vExpr});o+=1;`);
			break;
		case "u16":
			lines.push(`E.dv.setUint16(o,${vExpr},true);o+=2;`);
			break;
		case "u32":
			lines.push(`E.dv.setUint32(o,${vExpr},true);o+=4;`);
			break;
		case "u64":
			lines.push(`E.dv.setBigUint64(o,BigInt(${vExpr}),true);o+=8;`);
			break;
		case "u128": {
			const b = nextVar();
			lines.push(
				`var ${b}=BigInt(${vExpr});E.dv.setBigUint64(o,${b}&0xFFFFFFFFFFFFFFFFn,true);E.dv.setBigUint64(o+8,${b}>>64n,true);o+=16;`,
			);
			break;
		}
		case "u256": {
			const b = nextVar();
			lines.push(
				`var ${b}=BigInt(${vExpr}),M=0xFFFFFFFFFFFFFFFFn;E.dv.setBigUint64(o,${b}&M,true);E.dv.setBigUint64(o+8,(${b}>>64n)&M,true);E.dv.setBigUint64(o+16,(${b}>>128n)&M,true);E.dv.setBigUint64(o+24,${b}>>192n,true);o+=32;`,
			);
			break;
		}
		case "bytes":
		case "fixedArrayU8":
			lines.push(
				`E.arr.set(${vExpr} instanceof Uint8Array?${vExpr}:new Uint8Array(${vExpr}),o);o+=${info.size};`,
			);
			break;
		case "fixedArray": {
			const i = nextVar();
			lines.push(`for(var ${i}=0;${i}<${info.size};${i}++){`);
			genSerialize(info.elementType!, `${vExpr}[${i}]`, lines);
			lines.push(`}`);
			break;
		}
		case "string": {
			const sb = nextVar();
			lines.push(
				`var ${sb}=E.enc.encode(${vExpr});o=E.writeULEB(o,${sb}.length);E.arr.set(${sb},o);o+=${sb}.length;`,
			);
			break;
		}
		case "vector": {
			const a = nextVar();
			const i = nextVar();
			lines.push(
				`var ${a}=Array.from(${vExpr});o=E.writeULEB(o,${a}.length);for(var ${i}=0;${i}<${a}.length;${i}++){`,
			);
			genSerialize(info.elementType!, `${a}[${i}]`, lines);
			lines.push(`}`);
			break;
		}
		case "option":
			lines.push(`if(${vExpr}==null){E.dv.setUint8(o++,0);}else{E.dv.setUint8(o++,1);`);
			genSerialize(info.innerType!, vExpr, lines);
			lines.push(`}`);
			break;
		case "struct":
			for (const f of info.fields!) {
				genSerialize(f.type, `${vExpr}[${JSON.stringify(f.key)}]`, lines);
			}
			break;
		case "enum":
			for (let i = 0; i < info.variantTypes!.length; i++) {
				const v = info.variantTypes![i]!;
				const cond = i === 0 ? "if" : "else if";
				lines.push(
					`${cond}(${JSON.stringify(v.key)} in ${vExpr}&&${vExpr}[${JSON.stringify(v.key)}]!==undefined){`,
				);
				// Inline ULEB for small variant indices (0-127 = single byte)
				if (i < 128) {
					lines.push(`E.arr[o++]=${i};`);
				} else {
					lines.push(`o=E.writeULEB(o,${i});`);
				}
				if (v.type) {
					genSerialize(v.type, `${vExpr}[${JSON.stringify(v.key)}]`, lines);
				}
				lines.push(`}`);
			}
			break;
	}
}

// ── Deserialize codegen ──────────────────────────────────────────────

function genDeserialize(info: TypeInfo, lines: string[]): string {
	const id = nextVar();
	switch (info.kind) {
		case "bool":
			lines.push(`var ${id}=D.getUint8(o++)===1;`);
			return id;
		case "u8":
			lines.push(`var ${id}=D.getUint8(o++);`);
			return id;
		case "u16":
			lines.push(`var ${id}=D.getUint16(o,true);o+=2;`);
			return id;
		case "u32":
			lines.push(`var ${id}=D.getUint32(o,true);o+=4;`);
			return id;
		case "u64":
			lines.push(`var ${id}=D.getBigUint64(o,true).toString(10);o+=8;`);
			return id;
		case "u128":
			lines.push(
				`var ${id}=((D.getBigUint64(o+8,true)<<64n)|D.getBigUint64(o,true)).toString(10);o+=16;`,
			);
			return id;
		case "u256":
			lines.push(
				`var ${id}=((D.getBigUint64(o+24,true)<<192n)|(D.getBigUint64(o+16,true)<<128n)|(D.getBigUint64(o+8,true)<<64n)|D.getBigUint64(o,true)).toString(10);o+=32;`,
			);
			return id;
		case "bytes":
			lines.push(`var ${id}=d.slice(o,o+${info.size});o+=${info.size};`);
			return id;
		case "fixedArrayU8": {
			const j = nextVar();
			lines.push(
				`var ${id}=new Array(${info.size});for(var ${j}=0;${j}<${info.size};${j}++)${id}[${j}]=d[o+${j}];o+=${info.size};`,
			);
			return id;
		}
		case "fixedArray": {
			lines.push(`var ${id}=new Array(${info.size});`);
			const i = nextVar();
			lines.push(`for(var ${i}=0;${i}<${info.size};${i}++){`);
			const elemId = genDeserialize(info.elementType!, lines);
			lines.push(`${id}[${i}]=${elemId};}`);
			return id;
		}
		case "string": {
			const u = nextVar();
			lines.push(
				`var ${u}=E.readULEB(d,o);o=${u}.end;var ${id}=E.dec.decode(d.subarray(o,o+${u}.val));o+=${u}.val;`,
			);
			return id;
		}
		case "vector": {
			const u = nextVar();
			const i = nextVar();
			lines.push(
				`var ${u}=E.readULEB(d,o);o=${u}.end;var ${id}=new Array(${u}.val);for(var ${i}=0;${i}<${u}.val;${i}++){`,
			);
			const elemId = genDeserialize(info.elementType!, lines);
			lines.push(`${id}[${i}]=${elemId};}`);
			return id;
		}
		case "option": {
			lines.push(`var ${id};if(d[o++]===0){${id}=null;}else{`);
			const innerId = genDeserialize(info.innerType!, lines);
			lines.push(`${id}=${innerId};}`);
			return id;
		}
		case "struct": {
			const fieldParts: string[] = [];
			for (const f of info.fields!) {
				const fid = genDeserialize(f.type, lines);
				fieldParts.push(`${JSON.stringify(f.key)}:${fid}`);
			}
			lines.push(`var ${id}={${fieldParts.join(",")}};`);
			return id;
		}
		case "enum": {
			const u = nextVar();
			lines.push(`var ${u}=E.readULEB(d,o);o=${u}.end;var ${id};`);
			for (let i = 0; i < info.variantTypes!.length; i++) {
				const v = info.variantTypes![i]!;
				const cond = i === 0 ? "if" : "else if";
				lines.push(`${cond}(${u}.val===${i}){`);
				if (v.type) {
					const vid = genDeserialize(v.type, lines);
					lines.push(
						`${id}={${JSON.stringify(v.key)}:${vid},$kind:${JSON.stringify(v.key)}};`,
					);
				} else {
					lines.push(
						`${id}={${JSON.stringify(v.key)}:true,$kind:${JSON.stringify(v.key)}};`,
					);
				}
				lines.push(`}`);
			}
			return id;
		}
	}
	return "undefined";
}

// ── Compile and cache ────────────────────────────────────────────────

export type CompiledSerializer = (value: unknown) => Uint8Array;
export type CompiledDeserializer = (data: Uint8Array) => unknown;

const serializerCache = new WeakMap<
	BcsType<unknown, unknown>,
	CompiledSerializer | null
>();
const deserializerCache = new WeakMap<
	BcsType<unknown, unknown>,
	CompiledDeserializer | null
>();

export function getCompiledSerializer(
	type: BcsType<unknown, unknown>,
): CompiledSerializer | null {
	if (serializerCache.has(type)) return serializerCache.get(type)!;
	const info = analyzeType(type);
	if (!info) {
		serializerCache.set(type, null);
		return null;
	}

	_varCounter = 0;
	const lines: string[] = [];

	if (info.fixedSize != null) {
		// Fixed size: ensure capacity once, write at known offsets
		lines.push(`E.ensure(${info.fixedSize});E.refreshViews();var o=0;`);
		genSerialize(info, "v", lines);
		lines.push(`return E.arr.slice(0,${info.fixedSize});`);
	} else {
		// Variable size: ensure generous capacity, grow if needed
		lines.push(
			`E.ensure(512);E.refreshViews();var o=0;`,
		);
		genSerialize(info, "v", lines);
		lines.push(`return E.arr.slice(0,o);`);
	}

	const body = lines.join("\n");
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	const fn = new Function("v", "E", body) as (
		v: unknown,
		E: typeof _env,
	) => Uint8Array;
	const serializer: CompiledSerializer = (value) => fn(value, _env);
	serializerCache.set(type, serializer);
	return serializer;
}

export function getCompiledDeserializer(
	type: BcsType<unknown, unknown>,
): CompiledDeserializer | null {
	if (deserializerCache.has(type)) return deserializerCache.get(type)!;
	const info = analyzeType(type);
	if (!info) {
		deserializerCache.set(type, null);
		return null;
	}

	_varCounter = 0;
	const lines: string[] = [];
	lines.push(
		`var D=new DataView(d.buffer,d.byteOffset,d.byteLength);var o=0;`,
	);
	const resultId = genDeserialize(info, lines);
	lines.push(`return ${resultId};`);

	const body = lines.join("\n");
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	const fn = new Function("d", "E", body) as (
		d: Uint8Array,
		E: typeof _env,
	) => unknown;
	const deserializer: CompiledDeserializer = (data) => fn(data, _env);
	deserializerCache.set(type, deserializer);
	return deserializer;
}
