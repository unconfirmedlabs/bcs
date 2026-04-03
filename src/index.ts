import { toBase58, fromBase58, toBase64, fromBase64, toHex, fromHex } from "./utils.js";
import type { BcsTypeOptions } from "./bcs-type.js";
import {
	BcsType,
	BcsStruct,
	BcsEnum,
	BcsTuple,
	isSerializedBcs,
	SerializedBcs,
} from "./bcs-type.js";
import { bcs, compareBcsBytes } from "./bcs.js";
import { BcsReader } from "./reader.js";
import type {
	Encoding,
	EnumInputShape,
	EnumOutputShape,
	EnumOutputShapeWithKeys,
	InferBcsInput,
	InferBcsType,
	JoinString,
} from "./types.js";
import { decodeStr, encodeStr, splitGenericParameters } from "./utils.js";
import type { BcsWriterOptions } from "./writer.js";
import { BcsWriter } from "./writer.js";

export {
	bcs,
	BcsEnum,
	BcsReader,
	BcsStruct,
	BcsTuple,
	BcsType,
	BcsWriter,
	compareBcsBytes,
	decodeStr,
	encodeStr,
	fromBase58,
	fromBase64,
	fromHex,
	isSerializedBcs,
	SerializedBcs,
	splitGenericParameters,
	toBase58,
	toBase64,
	toHex,
	type BcsTypeOptions,
	type BcsWriterOptions,
	type Encoding,
	type EnumInputShape,
	type EnumOutputShape,
	type EnumOutputShapeWithKeys,
	type InferBcsInput,
	type InferBcsType,
	type JoinString,
};

// WASM module — load on demand
export { loadWasm, loadWasmSync, getWasm } from "./wasm.js";
export type { BcsWasmExports } from "./wasm.js";
