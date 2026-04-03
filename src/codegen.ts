/**
 * Schema-driven code generation for BCS serialize/deserialize.
 *
 * Generates straight-line JS functions via new Function() with:
 * - Pre-computed field offsets for fixed-size types
 * - Direct property access (v.fieldName)
 * - Inline ULEB128 (no array allocation)
 * - BigInt fast path (typeof branch to skip conversion)
 * - Fixed-size: direct ArrayBuffer allocation (no shared buf + slice)
 * - serializeInto: write into caller buffer (zero allocation)
 */

import type { BcsType } from "./bcs-type.js";

// ── Env passed to generated functions ────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

const _env = {
	enc,
	dec,
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
		if (elemInfo.kind === "u8")
			return { kind: "fixedArrayU8", fixedSize: size, size };
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
			if (varType === null) variants.push({ key, type: null });
			else {
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

let _vc = 0;
function nv(): string {
	return `_${_vc++}`;
}

// BigInt fast path: skip conversion if already bigint
function bigintExpr(vExpr: string): string {
	return `(typeof ${vExpr}==='bigint'?${vExpr}:BigInt(${vExpr}))`;
}

// Check if a type tree needs DataView (has u16+ integer fields)
function needsDataView(info: TypeInfo): boolean {
	switch (info.kind) {
		case "u16":
		case "u32":
		case "u64":
		case "u128":
		case "u256":
			return true;

		case "struct":
			return info.fields!.some((f) => needsDataView(f.type));
		case "fixedArray":
			return needsDataView(info.elementType!);
		case "vector":
			return needsDataView(info.elementType!);
		case "option":
			return needsDataView(info.innerType!);
		case "enum":
			return info.variantTypes!.some(
				(v) => v.type != null && needsDataView(v.type),
			);
		default:
			return false;
	}
}

function genSer(info: TypeInfo, v: string, L: string[]): void {
	switch (info.kind) {
		case "bool":
			L.push(`a[o++]=${v}?1:0;`);
			break;
		case "u8":
			L.push(`a[o++]=${v};`);
			break;
		case "u16":
			L.push(`w.setUint16(o,${v},true);o+=2;`);
			break;
		case "u32":
			L.push(`w.setUint32(o,${v},true);o+=4;`);
			break;
		case "u64":
			L.push(`w.setBigUint64(o,${bigintExpr(v)},true);o+=8;`);
			break;
		case "u128": {
			const b = nv();
			L.push(
				`var ${b}=${bigintExpr(v)};w.setBigUint64(o,${b}&0xFFFFFFFFFFFFFFFFn,true);w.setBigUint64(o+8,${b}>>64n,true);o+=16;`,
			);
			break;
		}
		case "u256": {
			const b = nv();
			L.push(
				`var ${b}=${bigintExpr(v)},M=0xFFFFFFFFFFFFFFFFn;w.setBigUint64(o,${b}&M,true);w.setBigUint64(o+8,(${b}>>64n)&M,true);w.setBigUint64(o+16,(${b}>>128n)&M,true);w.setBigUint64(o+24,${b}>>192n,true);o+=32;`,
			);
			break;
		}
		case "bytes":
		case "fixedArrayU8":
			L.push(
				`a.set(${v} instanceof Uint8Array?${v}:new Uint8Array(${v}),o);o+=${info.size};`,
			);
			break;
		case "fixedArray": {
			const i = nv();
			L.push(`for(var ${i}=0;${i}<${info.size};${i}++){`);
			genSer(info.elementType!, `${v}[${i}]`, L);
			L.push(`}`);
			break;
		}
		case "string": {
			const sb = nv();
			L.push(`var ${sb}=E.enc.encode(${v});`);
			// Inline ULEB write for string length
			L.push(`var _sl=${sb}.length;`);
			L.push(
				`while(_sl>0x7f){a[o++]=(_sl&0x7f)|0x80;_sl>>>=7;}a[o++]=_sl;`,
			);
			L.push(`a.set(${sb},o);o+=${sb}.length;`);
			break;
		}
		case "vector": {
			const ar = nv();
			const i = nv();
			L.push(`var ${ar}=Array.from(${v});`);
			// Pre-grow buffer for known element sizes
			if (info.elementType!.fixedSize != null) {
				L.push(
					`if(typeof G==='function'){var _need=o+5+${ar}.length*${info.elementType!.fixedSize};if(_need>sz)G(_need);}`,
				);
			} else {
				L.push(
					`if(typeof G==='function'){var _need=o+5+${ar}.length*8;if(_need>sz)G(_need);}`,
				);
			}
			// Inline ULEB write for vector length
			L.push(`var _vl=${ar}.length;`);
			L.push(
				`while(_vl>0x7f){a[o++]=(_vl&0x7f)|0x80;_vl>>>=7;}a[o++]=_vl;`,
			);
			L.push(`for(var ${i}=0;${i}<${ar}.length;${i}++){`);
			genSer(info.elementType!, `${ar}[${i}]`, L);
			L.push(`}`);
			break;
		}
		case "option":
			L.push(`if(${v}==null){a[o++]=0;}else{a[o++]=1;`);
			genSer(info.innerType!, v, L);
			L.push(`}`);
			break;
		case "struct":
			for (const f of info.fields!) {
				genSer(f.type, `${v}[${JSON.stringify(f.key)}]`, L);
			}
			break;
		case "enum":
			for (let i = 0; i < info.variantTypes!.length; i++) {
				const vt = info.variantTypes![i]!;
				const cond = i === 0 ? "if" : "else if";
				L.push(
					`${cond}(${JSON.stringify(vt.key)} in ${v}&&${v}[${JSON.stringify(vt.key)}]!==undefined){`,
				);
				if (i < 128) {
					L.push(`a[o++]=${i};`);
				} else {
					L.push(
						`var _ei=${i};while(_ei>0x7f){a[o++]=(_ei&0x7f)|0x80;_ei>>>=7;}a[o++]=_ei;`,
					);
				}
				if (vt.type)
					genSer(vt.type, `${v}[${JSON.stringify(vt.key)}]`, L);
				L.push(`}`);
			}
			break;
	}
}

// ── Deserialize codegen ──────────────────────────────────────────────

function genDe(info: TypeInfo, L: string[]): string {
	const id = nv();
	switch (info.kind) {
		case "bool":
			L.push(`var ${id}=d[o++]===1;`);
			return id;
		case "u8":
			L.push(`var ${id}=d[o++];`);
			return id;
		case "u16":
			L.push(`var ${id}=D.getUint16(o,true);o+=2;`);
			return id;
		case "u32":
			L.push(`var ${id}=D.getUint32(o,true);o+=4;`);
			return id;
		case "u64":
			L.push(
				`var ${id}=D.getBigUint64(o,true).toString(10);o+=8;`,
			);
			return id;
		case "u128":
			L.push(
				`var ${id}=((D.getBigUint64(o+8,true)<<64n)|D.getBigUint64(o,true)).toString(10);o+=16;`,
			);
			return id;
		case "u256":
			L.push(
				`var ${id}=((D.getBigUint64(o+24,true)<<192n)|(D.getBigUint64(o+16,true)<<128n)|(D.getBigUint64(o+8,true)<<64n)|D.getBigUint64(o,true)).toString(10);o+=32;`,
			);
			return id;
		case "bytes":
			L.push(`var ${id}=d.slice(o,o+${info.size});o+=${info.size};`);
			return id;
		case "fixedArrayU8": {
			const j = nv();
			L.push(
				`var ${id}=new Array(${info.size});for(var ${j}=0;${j}<${info.size};${j}++)${id}[${j}]=d[o+${j}];o+=${info.size};`,
			);
			return id;
		}
		case "fixedArray": {
			L.push(`var ${id}=new Array(${info.size});`);
			const i = nv();
			L.push(`for(var ${i}=0;${i}<${info.size};${i}++){`);
			const eid = genDe(info.elementType!, L);
			L.push(`${id}[${i}]=${eid};}`);
			return id;
		}
		case "string": {
			// Inline ULEB read — no object allocation
			const len = nv();
			L.push(
				`var ${len}=0,_sh=0,_b;do{_b=d[o++];${len}|=(_b&0x7f)<<_sh;_sh+=7;}while(_b&0x80);`,
			);
			L.push(
				`var ${id}=E.dec.decode(d.subarray(o,o+${len}));o+=${len};`,
			);
			return id;
		}
		case "vector": {
			// Inline ULEB read
			const cnt = nv();
			L.push(
				`var ${cnt}=0,_sh=0,_b;do{_b=d[o++];${cnt}|=(_b&0x7f)<<_sh;_sh+=7;}while(_b&0x80);`,
			);
			const i = nv();
			L.push(`var ${id}=new Array(${cnt});for(var ${i}=0;${i}<${cnt};${i}++){`);
			const eid = genDe(info.elementType!, L);
			L.push(`${id}[${i}]=${eid};}`);
			return id;
		}
		case "option": {
			L.push(`var ${id};if(d[o++]===0){${id}=null;}else{`);
			const iid = genDe(info.innerType!, L);
			L.push(`${id}=${iid};}`);
			return id;
		}
		case "struct": {
			const parts: string[] = [];
			for (const f of info.fields!) {
				const fid = genDe(f.type, L);
				parts.push(`${JSON.stringify(f.key)}:${fid}`);
			}
			L.push(`var ${id}={${parts.join(",")}};`);
			return id;
		}
		case "enum": {
			// Inline ULEB read for variant index
			const vi = nv();
			L.push(
				`var ${vi}=0,_sh=0,_b;do{_b=d[o++];${vi}|=(_b&0x7f)<<_sh;_sh+=7;}while(_b&0x80);var ${id};`,
			);
			for (let i = 0; i < info.variantTypes!.length; i++) {
				const vt = info.variantTypes![i]!;
				const cond = i === 0 ? "if" : "else if";
				L.push(`${cond}(${vi}===${i}){`);
				if (vt.type) {
					const vid = genDe(vt.type, L);
					L.push(
						`${id}={${JSON.stringify(vt.key)}:${vid},$kind:${JSON.stringify(vt.key)}};`,
					);
				} else {
					L.push(
						`${id}={${JSON.stringify(vt.key)}:true,$kind:${JSON.stringify(vt.key)}};`,
					);
				}
				L.push(`}`);
			}
			return id;
		}
	}
	return "undefined";
}

// ── Compile and cache ────────────────────────────────────────────────

export type CompiledSerializer = (value: unknown) => Uint8Array;
export type CompiledSerializeInto = (
	value: unknown,
	buf: Uint8Array,
	offset: number,
) => number;
export type CompiledDeserializer = (data: Uint8Array) => unknown;

const serializerCache = new WeakMap<
	BcsType<unknown, unknown>,
	CompiledSerializer | null
>();
const serializeIntoCache = new WeakMap<
	BcsType<unknown, unknown>,
	CompiledSerializeInto | null
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

	_vc = 0;
	const L: string[] = [];

	const hasBigInt = needsDataView(info);
	if (info.fixedSize != null) {
		// Fixed-size: allocate exact buffer directly
		if (hasBigInt) {
			L.push(
				`var b=new ArrayBuffer(${info.fixedSize}),w=new DataView(b),a=new Uint8Array(b),o=0;`,
			);
		} else {
			L.push(`var a=new Uint8Array(${info.fixedSize}),o=0;`);
		}
		genSer(info, "v", L);
		L.push(`return a;`);
	} else {
		// Variable-size: growable buffer
		if (hasBigInt) {
			L.push(`var sz=1024,b=new ArrayBuffer(sz),w=new DataView(b),a=new Uint8Array(b),o=0;`);
			L.push(`function G(n){while(sz<n)sz*=2;var nb=new ArrayBuffer(sz);new Uint8Array(nb).set(a);b=nb;w=new DataView(b);a=new Uint8Array(b);}`);
		} else {
			L.push(`var sz=1024,a=new Uint8Array(sz),o=0;`);
			L.push(`function G(n){while(sz<n)sz*=2;var na=new Uint8Array(sz);na.set(a);a=na;}`);
		}
		genSer(info, "v", L);
		L.push(`return a.slice(0,o);`);
	}

	const body = L.join("\n");
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	const fn = new Function("v", "E", body) as (
		v: unknown,
		E: typeof _env,
	) => Uint8Array;
	const serializer: CompiledSerializer = (value) => fn(value, _env);
	serializerCache.set(type, serializer);
	return serializer;
}

export function getCompiledSerializeInto(
	type: BcsType<unknown, unknown>,
): CompiledSerializeInto | null {
	if (serializeIntoCache.has(type)) return serializeIntoCache.get(type)!;
	const info = analyzeType(type);
	if (!info) {
		serializeIntoCache.set(type, null);
		return null;
	}

	_vc = 0;
	const L: string[] = [];
	const hasBigInt = needsDataView(info);
	if (hasBigInt) {
		L.push(`var w=new DataView(a.buffer,a.byteOffset,a.byteLength),o=off;`);
	} else {
		L.push(`var o=off;`);
	}
	genSer(info, "v", L);
	L.push(`return o;`);

	const body = L.join("\n");
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	const fn = new Function("v", "a", "off", "E", body) as (
		v: unknown,
		a: Uint8Array,
		off: number,
		E: typeof _env,
	) => number;
	const serializeInto: CompiledSerializeInto = (value, buf, offset) =>
		fn(value, buf, offset, _env);
	serializeIntoCache.set(type, serializeInto);
	return serializeInto;
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

	_vc = 0;
	const L: string[] = [];
	const hasBigInt = needsDataView(info);
	if (hasBigInt) {
		L.push(`var D=new DataView(d.buffer,d.byteOffset,d.byteLength),o=0;`);
	} else {
		L.push(`var o=0;`);
	}
	const rid = genDe(info, L);
	L.push(`return ${rid};`);

	const body = L.join("\n");
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	const fn = new Function("d", "E", body) as (
		d: Uint8Array,
		E: typeof _env,
	) => unknown;
	const deserializer: CompiledDeserializer = (data) => fn(data, _env);
	deserializerCache.set(type, deserializer);
	return deserializer;
}
