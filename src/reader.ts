import { ulebDecode } from "./uleb.js";

export class BcsReader {
	private dataView: DataView;
	private bytePosition: number = 0;

	constructor(data: Uint8Array) {
		this.dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
	}

	shift(bytes: number) {
		this.bytePosition += bytes;
		return this;
	}

	read8(): number {
		const value = this.dataView.getUint8(this.bytePosition);
		this.shift(1);
		return value;
	}

	read16(): number {
		const value = this.dataView.getUint16(this.bytePosition, true);
		this.shift(2);
		return value;
	}

	read32(): number {
		const value = this.dataView.getUint32(this.bytePosition, true);
		this.shift(4);
		return value;
	}

	/**
	 * Read u64 using native DataView.getBigUint64 — single call instead of
	 * two read32 + hex string concatenation + BigInt parsing in @mysten/bcs.
	 */
	read64(): string {
		const value = this.dataView.getBigUint64(this.bytePosition, true);
		this.shift(8);
		return value.toString(10);
	}

	/**
	 * Read u128 as two native u64 reads — 2 BigInt ops vs string concat chain.
	 */
	read128(): string {
		const lo = this.dataView.getBigUint64(this.bytePosition, true);
		const hi = this.dataView.getBigUint64(this.bytePosition + 8, true);
		this.shift(16);
		return ((hi << 64n) | lo).toString(10);
	}

	/**
	 * Read u256 as four native u64 reads.
	 */
	read256(): string {
		const a = this.dataView.getBigUint64(this.bytePosition, true);
		const b = this.dataView.getBigUint64(this.bytePosition + 8, true);
		const c = this.dataView.getBigUint64(this.bytePosition + 16, true);
		const d = this.dataView.getBigUint64(this.bytePosition + 24, true);
		this.shift(32);
		return ((d << 192n) | (c << 128n) | (b << 64n) | a).toString(10);
	}

	readBytes(num: number): Uint8Array {
		const start = this.bytePosition + this.dataView.byteOffset;
		const value = new Uint8Array(this.dataView.buffer, start, num);
		this.shift(num);
		return value;
	}

	/**
	 * Read ULEB128 — uses plain number ops, no BigInt.
	 */
	readULEB(): number {
		const start = this.bytePosition + this.dataView.byteOffset;
		const buffer = new Uint8Array(this.dataView.buffer, start);
		const { value, length } = ulebDecode(buffer);
		this.shift(length);
		return value;
	}

	readVec(cb: (reader: BcsReader, i: number, length: number) => any): any[] {
		const length = this.readULEB();
		const result = [];
		for (let i = 0; i < length; i++) {
			result.push(cb(this, i, length));
		}
		return result;
	}
}
