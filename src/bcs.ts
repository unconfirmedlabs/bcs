import type { BcsTypeOptions } from "./bcs-type.js";
import {
	BcsEnum,
	BcsStruct,
	BcsTuple,
	BcsType,
	bigUIntBcsType,
	dynamicSizeBcsType,
	fixedSizeBcsType,
	lazyBcsType,
	stringLikeBcsType,
	uIntBcsType,
} from "./bcs-type.js";
import type {
	EnumInputShape,
	EnumOutputShape,
	InferBcsInput,
	InferBcsType,
	JoinString,
} from "./types.js";
import { ulebEncode } from "./uleb.js";

function fixedArray<T extends BcsType<any>, Name extends string = string>(
	size: number,
	type: T,
	options?: BcsTypeOptions<
		InferBcsType<T>[],
		Iterable<InferBcsInput<T>> & { length: number },
		Name
	>,
): BcsType<
	InferBcsType<T>[],
	Iterable<InferBcsInput<T>> & { length: number },
	Name
>;
function fixedArray<T, Input, Name extends string = string>(
	size: number,
	type: BcsType<T, Input>,
	options?: BcsTypeOptions<T[], Iterable<Input> & { length: number }, Name>,
): BcsType<T[], Iterable<Input> & { length: number }, Name>;
function fixedArray<
	T extends BcsType<any>,
	Name extends string = `${T["name"]}[${number}]`,
>(
	size: number,
	type: T,
	options?: BcsTypeOptions<
		InferBcsType<T>[],
		Iterable<InferBcsInput<T>> & { length: number },
		Name
	>,
): BcsType<
	InferBcsType<T>[],
	Iterable<InferBcsInput<T>> & { length: number },
	Name
> {
	const t = new BcsType<
		InferBcsType<T>[],
		Iterable<InferBcsInput<T>> & { length: number },
		Name
	>({
		read: (reader) => {
			const result: InferBcsType<T>[] = new Array(size);
			for (let i = 0; i < size; i++) {
				result[i] = type.read(reader);
			}
			return result;
		},
		write: (value, writer) => {
			for (const item of value) {
				type.write(item, writer);
			}
		},
		...options,
		name: (options?.name ?? `${type.name}[${size}]`) as Name,
		validate: (value) => {
			options?.validate?.(value);
			if (!value || typeof value !== "object" || !("length" in value)) {
				throw new TypeError(`Expected array, found ${typeof value}`);
			}
			if (value.length !== size) {
				throw new TypeError(
					`Expected array of length ${size}, found ${value.length}`,
				);
			}
		},
	});
	(t as any)._elementType = type;
	return t;
}

function option<T extends BcsType<any>>(
	type: T,
): BcsType<
	InferBcsType<T> | null,
	InferBcsInput<T> | null | undefined,
	`Option<${T["name"]}>`
>;
function option<T, Input, Name extends string = string>(
	type: BcsType<T, Input, Name>,
): BcsType<T | null, Input | null | undefined>;
function option<T extends BcsType<any>>(
	type: T,
): BcsType<
	InferBcsType<T> | null,
	InferBcsInput<T> | null | undefined,
	`Option<${T["name"]}>`
> {
	const t = bcs
		.enum(`Option<${type.name}>`, {
			None: null,
			Some: type,
		})
		.transform({
			input: (value: InferBcsInput<T> | null | undefined) => {
				if (value == null) {
					return { None: true };
				}
				return { Some: value };
			},
			output: (value) => {
				if (value.$kind === "Some") {
					return value.Some as InferBcsType<T>;
				}
				return null;
			},
		});
	(t as any)._optionInner = type;
	return t;
}

function vector<
	T extends BcsType<any>,
	Name extends string = `vector<${T["name"]}>`,
>(
	type: T,
	options?: BcsTypeOptions<
		InferBcsType<T>[],
		Iterable<InferBcsInput<T>> & { length: number },
		Name
	>,
): BcsType<
	InferBcsType<T>[],
	Iterable<InferBcsInput<T>> & { length: number },
	Name
>;
function vector<T, Input, Name extends string = string>(
	type: BcsType<T, Input, Name>,
	options?: BcsTypeOptions<
		T[],
		Iterable<Input> & { length: number },
		`vector<${Name}>`
	>,
): BcsType<T[], Iterable<Input> & { length: number }, `vector<${Name}>`>;
function vector<
	T extends BcsType<any>,
	Name extends string = `vector<${T["name"]}>`,
>(
	type: T,
	options?: BcsTypeOptions<
		InferBcsType<T>[],
		Iterable<InferBcsInput<T>> & { length: number },
		Name
	>,
): BcsType<
	InferBcsType<T>[],
	Iterable<InferBcsInput<T>> & { length: number },
	Name
> {
	const t = new BcsType<
		InferBcsType<T>[],
		Iterable<InferBcsInput<T>> & { length: number },
		Name
	>({
		read: (reader) => {
			const length = reader.readULEB();
			const result: InferBcsType<T>[] = new Array(length);
			for (let i = 0; i < length; i++) {
				result[i] = type.read(reader);
			}
			return result;
		},
		write: (value, writer) => {
			writer.writeULEB(value.length);
			for (const item of value) {
				type.write(item, writer);
			}
		},
		...options,
		name: (options?.name ?? `vector<${type.name}>`) as Name,
		validate: (value) => {
			options?.validate?.(value);
			if (!value || typeof value !== "object" || !("length" in value)) {
				throw new TypeError(`Expected array, found ${typeof value}`);
			}
		},
	});
	(t as any)._elementType = type;
	return t;
}

export function compareBcsBytes(a: Uint8Array, b: Uint8Array): number {
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		if (a[i] !== b[i]) {
			return a[i]! - b[i]!;
		}
	}
	return a.length - b.length;
}

function map<K extends BcsType<any>, V extends BcsType<any>>(
	keyType: K,
	valueType: V,
): BcsType<
	Map<InferBcsType<K>, InferBcsType<V>>,
	Map<InferBcsInput<K>, InferBcsInput<V>>,
	`Map<${K["name"]}, ${V["name"]}>`
>;
function map<K, V, InputK = K, InputV = V>(
	keyType: BcsType<K, InputK>,
	valueType: BcsType<V, InputV>,
): BcsType<Map<K, V>, Map<InputK, InputV>, `Map<${string}, ${string}>`>;
function map<K extends BcsType<any>, V extends BcsType<any>>(
	keyType: K,
	valueType: V,
): BcsType<
	Map<InferBcsType<K>, InferBcsType<V>>,
	Map<InferBcsInput<K>, InferBcsInput<V>>,
	`Map<${K["name"]}, ${V["name"]}>`
> {
	return new BcsType({
		name: `Map<${keyType.name}, ${valueType.name}>`,
		read: (reader) => {
			const length = reader.readULEB();
			const result = new Map<InferBcsType<K>, InferBcsType<V>>();
			for (let i = 0; i < length; i++) {
				result.set(keyType.read(reader), valueType.read(reader));
			}
			return result;
		},
		write: (value, writer) => {
			const entries = [...value.entries()].map(
				([key, val]) =>
					[keyType.serialize(key).toBytes(), val] as const,
			);
			entries.sort(([a], [b]) => compareBcsBytes(a, b));

			writer.writeULEB(entries.length);
			for (const [keyBytes, val] of entries) {
				writer.writeBytes(keyBytes);
				valueType.write(val, writer);
			}
		},
	});
}

export const bcs = {
	u8(options?: BcsTypeOptions<number>) {
		return uIntBcsType({
			readMethod: "read8",
			writeMethod: "write8",
			size: 1,
			maxValue: 2 ** 8 - 1,
			...options,
			name: (options?.name ?? "u8") as "u8",
		});
	},

	u16(options?: BcsTypeOptions<number>) {
		return uIntBcsType({
			readMethod: "read16",
			writeMethod: "write16",
			size: 2,
			maxValue: 2 ** 16 - 1,
			...options,
			name: (options?.name ?? "u16") as "u16",
		});
	},

	u32(options?: BcsTypeOptions<number>) {
		return uIntBcsType({
			readMethod: "read32",
			writeMethod: "write32",
			size: 4,
			maxValue: 2 ** 32 - 1,
			...options,
			name: (options?.name ?? "u32") as "u32",
		});
	},

	u64(options?: BcsTypeOptions<string, number | bigint | string>) {
		return bigUIntBcsType({
			readMethod: "read64",
			writeMethod: "write64",
			size: 8,
			maxValue: 2n ** 64n - 1n,
			...options,
			name: (options?.name ?? "u64") as "u64",
		});
	},

	u128(options?: BcsTypeOptions<string, number | bigint | string>) {
		return bigUIntBcsType({
			readMethod: "read128",
			writeMethod: "write128",
			size: 16,
			maxValue: 2n ** 128n - 1n,
			...options,
			name: (options?.name ?? "u128") as "u128",
		});
	},

	u256(options?: BcsTypeOptions<string, number | bigint | string>) {
		return bigUIntBcsType({
			readMethod: "read256",
			writeMethod: "write256",
			size: 32,
			maxValue: 2n ** 256n - 1n,
			...options,
			name: (options?.name ?? "u256") as "u256",
		});
	},

	bool(options?: BcsTypeOptions<boolean>) {
		return fixedSizeBcsType({
			size: 1,
			read: (reader) => reader.read8() === 1,
			write: (value, writer) => writer.write8(value ? 1 : 0),
			...options,
			name: (options?.name ?? "bool") as "bool",
			validate: (value) => {
				options?.validate?.(value);
				if (typeof value !== "boolean") {
					throw new TypeError(
						`Expected boolean, found ${typeof value}`,
					);
				}
			},
		});
	},

	uleb128(options?: BcsTypeOptions<number>) {
		return dynamicSizeBcsType({
			read: (reader) => reader.readULEB(),
			serialize: (value) => {
				return Uint8Array.from(ulebEncode(value));
			},
			...options,
			name: (options?.name ?? "uleb128") as "uleb128",
		});
	},

	bytes<T extends number>(
		size: T,
		options?: BcsTypeOptions<Uint8Array, Iterable<number>>,
	) {
		return fixedSizeBcsType<Uint8Array, Iterable<number>, `bytes[${T}]`>({
			size,
			read: (reader) => reader.readBytes(size),
			write: (value, writer) => {
				writer.writeBytes(new Uint8Array(value));
			},
			...options,
			name: (options?.name ?? `bytes[${size}]`) as `bytes[${T}]`,
			validate: (value) => {
				options?.validate?.(value);
				if (!value || typeof value !== "object" || !("length" in value)) {
					throw new TypeError(`Expected array, found ${typeof value}`);
				}
				if (value.length !== size) {
					throw new TypeError(
						`Expected array of length ${size}, found ${value.length}`,
					);
				}
			},
		});
	},

	byteVector(options?: BcsTypeOptions<Uint8Array, Iterable<number>>) {
		return new BcsType<Uint8Array, Iterable<number>, "vector<u8>">({
			read: (reader) => {
				const length = reader.readULEB();
				return reader.readBytes(length);
			},
			write: (value, writer) => {
				const array = new Uint8Array(value);
				writer.writeULEB(array.length);
				writer.writeBytes(array);
			},
			...options,
			name: (options?.name ?? "vector<u8>") as "vector<u8>",
			serializedSize: (value) => {
				const length =
					"length" in value ? (value.length as number) : null;
				return length == null
					? null
					: ulebEncode(length).length + length;
			},
			validate: (value) => {
				options?.validate?.(value);
				if (!value || typeof value !== "object" || !("length" in value)) {
					throw new TypeError(`Expected array, found ${typeof value}`);
				}
			},
		});
	},

	string(options?: BcsTypeOptions<string>) {
		return stringLikeBcsType({
			toBytes: (value) => new TextEncoder().encode(value),
			fromBytes: (bytes) => new TextDecoder().decode(bytes),
			...options,
			name: (options?.name ?? "string") as "string",
		});
	},

	fixedArray,
	option,
	vector,

	tuple<
		const T extends readonly BcsType<any, any>[],
		const Name extends string = `(${JoinString<{ [K in keyof T]: T[K] extends BcsType<any, any, infer T> ? T : never }, ", ">})`,
	>(
		fields: T,
		options?: BcsTypeOptions<
			{
				-readonly [K in keyof T]: T[K] extends BcsType<infer T, any>
					? T
					: never;
			},
			{
				[K in keyof T]: T[K] extends BcsType<any, infer T> ? T : never;
			},
			Name
		>,
	) {
		return new BcsTuple<T, Name>({
			fields,
			...options,
		});
	},

	struct<
		T extends Record<string, BcsType<any>>,
		const Name extends string = string,
	>(
		name: Name,
		fields: T,
		options?: Omit<
			BcsTypeOptions<
				{
					[K in keyof T]: T[K] extends BcsType<infer U, any>
						? U
						: never;
				},
				{
					[K in keyof T]: T[K] extends BcsType<any, infer U>
						? U
						: never;
				}
			>,
			"name"
		>,
	) {
		return new BcsStruct<T>({
			name,
			fields,
			...options,
		});
	},

	enum<
		T extends Record<string, BcsType<any> | null>,
		const Name extends string = string,
	>(
		name: Name,
		fields: T,
		options?: Omit<
			BcsTypeOptions<
				EnumOutputShape<{
					[K in keyof T]: T[K] extends BcsType<infer U, any, any>
						? U
						: true;
				}>,
				EnumInputShape<{
					[K in keyof T]: T[K] extends BcsType<any, infer U, any>
						? U
						: boolean | object | null;
				}>,
				Name
			>,
			"name"
		>,
	) {
		return new BcsEnum<T, Name>({
			name,
			fields,
			...options,
		});
	},

	map,

	lazy<T extends BcsType<any>>(cb: () => T): T {
		return lazyBcsType(cb) as T;
	},
};
