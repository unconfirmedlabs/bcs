/**
 * WASM module loader for bcs-zig.
 *
 * The WASM module is embedded as base64 and loaded lazily on first use.
 * All TypeScript hot paths use optimized pure-TS implementations;
 * the WASM module is available for validation and specialized operations.
 */

import { WASM_BASE64 } from "./wasm-binary.js";
import { fromBase64 } from "./utils.js";

export interface BcsWasmExports {
	memory: WebAssembly.Memory;
	getBufferPtr: () => number;
	encodeUleb128: (value: number) => number;
	decodeUleb128: (offset: number) => bigint;
	encodeU64: (lo: number, hi: number) => void;
	encodeU128: (a: number, b: number, c: number, d: number) => void;
	encodeU256: (
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number,
		g: number,
		h: number,
	) => void;
	serializeBool: (val: number) => number;
	serializeU64: (lo: number, hi: number) => number;
	serializeU128: (a: number, b: number, c: number, d: number) => number;
	serializeU256: (
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number,
		g: number,
		h: number,
	) => number;
	serializeBytes: (inputOffset: number, inputLen: number) => number;
}

let wasmInstance: BcsWasmExports | null = null;
let wasmLoading: Promise<BcsWasmExports> | null = null;

/**
 * Load the bcs-zig WASM module. Returns cached instance on subsequent calls.
 */
export async function loadWasm(): Promise<BcsWasmExports> {
	if (wasmInstance) return wasmInstance;
	if (wasmLoading) return wasmLoading;

	wasmLoading = (async () => {
		const bytes = fromBase64(WASM_BASE64);
		const { instance } = await WebAssembly.instantiate(bytes, {});
		wasmInstance = instance.exports as unknown as BcsWasmExports;
		return wasmInstance;
	})();

	return wasmLoading;
}

/**
 * Load WASM synchronously (Bun/Node only — uses synchronous compile).
 */
export function loadWasmSync(): BcsWasmExports {
	if (wasmInstance) return wasmInstance;

	const bytes = fromBase64(WASM_BASE64);
	const module = new WebAssembly.Module(bytes);
	const instance = new WebAssembly.Instance(module, {});
	wasmInstance = instance.exports as unknown as BcsWasmExports;
	return wasmInstance;
}

/**
 * Get the WASM instance if already loaded, or null.
 */
export function getWasm(): BcsWasmExports | null {
	return wasmInstance;
}

/**
 * Get a Uint8Array view of the WASM output area (offset 32768, length 32768).
 */
export function getOutputView(wasm: BcsWasmExports): Uint8Array {
	const bufPtr = wasm.getBufferPtr();
	return new Uint8Array(wasm.memory.buffer, bufPtr + 32768, 32768);
}

/**
 * Get a Uint8Array view of the WASM input area (offset 0, length 32768).
 */
export function getInputView(wasm: BcsWasmExports): Uint8Array {
	const bufPtr = wasm.getBufferPtr();
	return new Uint8Array(wasm.memory.buffer, bufPtr, 32768);
}
