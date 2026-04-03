import type { Encoding } from "./types.js";
import { ulebEncode } from "./uleb.js";
import { encodeStr } from "./utils.js";

export interface BcsWriterOptions {
	/** The initial size (in bytes) of the buffer that will be allocated */
	initialSize?: number;
	/** The maximum size (in bytes) that the buffer is allowed to grow to */
	maxSize?: number;
	/** The amount of bytes that will be allocated whenever additional memory is required */
	allocateSize?: number;
}

export class BcsWriter {
	private dataView: DataView<ArrayBuffer>;
	private bytePosition: number = 0;
	private size: number;
	private maxSize: number;
	private allocateSize: number;

	constructor({
		initialSize = 1024,
		maxSize = Infinity,
		allocateSize = 1024,
	}: BcsWriterOptions = {}) {
		this.size = initialSize;
		this.maxSize = maxSize;
		this.allocateSize = allocateSize;
		this.dataView = new DataView(new ArrayBuffer(initialSize));
	}

	private ensureSizeOrGrow(bytes: number) {
		const requiredSize = this.bytePosition + bytes;
		if (requiredSize > this.size) {
			// Double-growth strategy for amortized O(1)
			const nextSize = Math.min(
				this.maxSize,
				Math.max(requiredSize, this.size * 2, this.size + this.allocateSize),
			);
			if (requiredSize > nextSize) {
				throw new Error(
					`Attempting to serialize to BCS, but buffer does not have enough size. Allocated size: ${this.size}, Max size: ${this.maxSize}, Required size: ${requiredSize}`,
				);
			}

			this.size = nextSize;
			const nextBuffer = new ArrayBuffer(this.size);
			new Uint8Array(nextBuffer).set(new Uint8Array(this.dataView.buffer));
			this.dataView = new DataView(nextBuffer);
		}
	}

	shift(bytes: number): this {
		this.bytePosition += bytes;
		return this;
	}

	write8(value: number | bigint): this {
		this.ensureSizeOrGrow(1);
		this.dataView.setUint8(this.bytePosition, Number(value));
		return this.shift(1);
	}

	write16(value: number | bigint): this {
		this.ensureSizeOrGrow(2);
		this.dataView.setUint16(this.bytePosition, Number(value), true);
		return this.shift(2);
	}

	write32(value: number | bigint): this {
		this.ensureSizeOrGrow(4);
		this.dataView.setUint32(this.bytePosition, Number(value), true);
		return this.shift(4);
	}

	/**
	 * Write u64 using native DataView.setBigUint64 — single call instead of
	 * byte-by-byte BigInt division used by @mysten/bcs.
	 */
	write64(value: number | bigint): this {
		this.ensureSizeOrGrow(8);
		this.dataView.setBigUint64(this.bytePosition, BigInt(value), true);
		return this.shift(8);
	}

	/**
	 * Write u128 as two native u64 writes — 2 BigInt ops vs 16 in @mysten/bcs.
	 */
	write128(value: number | bigint): this {
		this.ensureSizeOrGrow(16);
		const big = BigInt(value);
		this.dataView.setBigUint64(
			this.bytePosition,
			big & 0xffff_ffff_ffff_ffffn,
			true,
		);
		this.dataView.setBigUint64(this.bytePosition + 8, big >> 64n, true);
		return this.shift(16);
	}

	/**
	 * Write u256 as four native u64 writes — 4 BigInt ops vs 32 in @mysten/bcs.
	 */
	write256(value: number | bigint): this {
		this.ensureSizeOrGrow(32);
		const big = BigInt(value);
		const mask = 0xffff_ffff_ffff_ffffn;
		this.dataView.setBigUint64(this.bytePosition, big & mask, true);
		this.dataView.setBigUint64(
			this.bytePosition + 8,
			(big >> 64n) & mask,
			true,
		);
		this.dataView.setBigUint64(
			this.bytePosition + 16,
			(big >> 128n) & mask,
			true,
		);
		this.dataView.setBigUint64(this.bytePosition + 24, big >> 192n, true);
		return this.shift(32);
	}

	/**
	 * Write ULEB128 — uses plain number ops, no BigInt.
	 */
	writeULEB(value: number): this {
		const encoded = ulebEncode(value);
		this.ensureSizeOrGrow(encoded.length);
		for (let i = 0; i < encoded.length; i++) {
			this.dataView.setUint8(this.bytePosition + i, encoded[i]);
		}
		return this.shift(encoded.length);
	}

	/**
	 * Write raw bytes using Uint8Array.set — bulk copy instead of byte-by-byte.
	 */
	writeBytes(bytes: Uint8Array): this {
		this.ensureSizeOrGrow(bytes.length);
		new Uint8Array(this.dataView.buffer).set(bytes, this.bytePosition);
		return this.shift(bytes.length);
	}

	writeVec(
		vector: any[],
		cb: (writer: BcsWriter, el: any, i: number, len: number) => void,
	): this {
		this.writeULEB(vector.length);
		Array.from(vector).forEach((el, i) => cb(this, el, i, vector.length));
		return this;
	}

	// oxlint-disable-next-line require-yields
	*[Symbol.iterator](): Iterator<number, Iterable<number>> {
		for (let i = 0; i < this.bytePosition; i++) {
			yield this.dataView.getUint8(i);
		}
		return this.toBytes();
	}

	toBytes(): Uint8Array<ArrayBuffer> {
		return new Uint8Array(this.dataView.buffer.slice(0, this.bytePosition));
	}

	toString(encoding: Encoding): string {
		return encodeStr(this.toBytes(), encoding);
	}
}
