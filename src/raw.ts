/**
 * @unconfirmed/bcs/raw — Zero-allocation BCS serialization.
 *
 * Same schemas as @unconfirmed/bcs, but serialize returns Uint8Array directly
 * (no SerializedBcs wrapper) and serializeInto writes into caller-provided buffers.
 *
 * ```ts
 * import { bcs } from "@unconfirmed/bcs/raw";
 *
 * const MyStruct = bcs.struct("MyStruct", { ... });
 *
 * // Returns Uint8Array directly (no .toBytes() needed)
 * const bytes = MyStruct.serialize(value);
 *
 * // Zero allocation — write into your own buffer
 * const buf = new Uint8Array(4096);
 * const offset = MyStruct.serializeInto(value, buf, 0);
 *
 * // Parse works the same
 * const parsed = MyStruct.parse(bytes);
 * ```
 */

import { bcs as baseBcs } from "./bcs.js";
import { BcsType } from "./bcs-type.js";
import type { BcsTypeOptions } from "./bcs-type.js";
import type {
	EnumInputShape,
	EnumOutputShape,
	InferBcsInput,
	InferBcsType,
	JoinString,
} from "./types.js";

// Re-export everything from the base module
export {
	BcsReader,
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
} from "./index.js";

export type {
	BcsTypeOptions,
	BcsWriterOptions,
	Encoding,
	EnumInputShape,
	EnumOutputShape,
	EnumOutputShapeWithKeys,
	InferBcsInput,
	InferBcsType,
	JoinString,
} from "./index.js";

export { BcsType, BcsStruct, BcsEnum, BcsTuple } from "./bcs-type.js";
export { loadWasm, loadWasmSync, getWasm } from "./wasm.js";
export type { BcsWasmExports } from "./wasm.js";

// The raw bcs object — identical API, same types
export const bcs = baseBcs;
