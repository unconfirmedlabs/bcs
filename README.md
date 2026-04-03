# @unconfirmed/bcs

High-performance [Binary Canonical Serialization (BCS)](https://github.com/zefchain/bcs) for
TypeScript, powered by [bcs-zig](https://github.com/unconfirmedlabs/bcs-zig). Drop-in replacement
for [`@mysten/bcs`](https://www.npmjs.com/package/@mysten/bcs).

## Why this exists

The Rust `bcs` crate is the reference implementation, but it was never designed for the browser.
Its dependency on `serde` pulls in trait dispatch machinery, and `thiserror` forces
`std::error::Error`, which means WASM builds require `wasm32-wasip1` with a full WASI runtime.
The result is a **52 KB** WASM binary for a single `bcs_roundtrip()` export — too large to
embed, too slow to call per-field, and impossible to trim further without forking serde itself.

[bcs-zig](https://github.com/unconfirmedlabs/bcs-zig) is a from-scratch BCS implementation in
Zig that uses comptime generics instead of runtime trait dispatch. It compiles to
`wasm32-freestanding` with zero OS dependencies, producing a **3.3 KB** WASM binary — **10.9x
smaller** than the Rust equivalent. On native benchmarks it is 2-7x faster for serialization and
up to 37x faster for deserialization.

This package wraps bcs-zig's WASM module with a TypeScript API that is **byte-identical and
API-compatible** with `@mysten/bcs`. The TypeScript layer itself is also optimized over the
original:

| Operation | `@mysten/bcs` | `@unconfirmed/bcs` |
|-----------|---------------|---------------------|
| Write u64 | Byte-by-byte BigInt division (16 ops) | Single `DataView.setBigUint64()` call |
| Write u128 | 16 byte-by-byte BigInt divisions | 2 native `setBigUint64()` calls |
| Write u256 | 32 byte-by-byte BigInt divisions | 4 native `setBigUint64()` calls |
| Read u64 | Two `read32` + hex concat + `BigInt('0x'+...)` | Single `DataView.getBigUint64()` call |
| Read u128 | Recursive `read64` + hex concat chain | 2 native `getBigUint64()` calls |
| writeBytes | Byte-by-byte `setUint8` loop | Bulk `Uint8Array.set()` |
| Buffer growth | Fixed increment (+1024) | Doubling strategy (amortized O(1)) |
| ULEB128 encode | Always BigInt | Fast u32 path, BigInt only when >2^32 |
| WASM module | N/A (52 KB Rust, not embedded) | 3.3 KB Zig, base64-embedded |

## Install

```sh
bun add @unconfirmed/bcs
```

## Migration from @mysten/bcs

Replace the import path. The API is identical:

```diff
-import { bcs, fromHex, toHex } from '@mysten/bcs';
+import { bcs, fromHex, toHex } from '@unconfirmed/bcs';
```

All 244 tests from `@mysten/bcs`'s own test suite pass against this library with byte-identical
output. No code changes needed.

## Quickstart

```ts
import { bcs, fromHex, toHex } from '@unconfirmed/bcs';

// Define a UID type with hex string transforms
const UID = bcs.fixedArray(32, bcs.u8()).transform({
  input: (id: string) => fromHex(id),
  output: (id) => toHex(Uint8Array.from(id)),
});

const Coin = bcs.struct('Coin', {
  id: UID,
  value: bcs.u64(),
});

// Serialize
const bytes = Coin.serialize({
  id: '0000000000000000000000000000000000000000000000000000000000000001',
  value: 1000000n,
}).toBytes();

// Deserialize
const coin = Coin.parse(bytes);

// Option wrapping
const hex = bcs.option(Coin).serialize(coin).toHex();
```

## Basic types

| Method                | TS Type      | TS Input Type                | Description                                                                 |
| --------------------- | ------------ | ---------------------------- | --------------------------------------------------------------------------- |
| `bool`                | `boolean`    | `boolean`                    | Boolean type (converts to `true` / `false`)                                 |
| `u8`, `u16`, `u32`    | `number`     | `number`                     | Unsigned integer types                                                      |
| `u64`, `u128`, `u256` | `string`     | `number \| string \| bigint` | Unsigned integer types, decoded as `string` for JSON compatibility          |
| `uleb128`             | `number`     | `number`                     | Unsigned LEB128 integer type                                                |
| `string`              | `string`     | `string`                     | UTF-8 encoded string                                                        |
| `bytes(size)`         | `Uint8Array` | `Iterable<number>`           | Fixed length bytes                                                          |

```ts
import { bcs } from '@unconfirmed/bcs';

// Integers
const u8 = bcs.u8().serialize(100).toBytes();
const u64 = bcs.u64().serialize(1000000n).toBytes();
const u128 = bcs.u128().serialize('100000010000001000000').toBytes();

// Other types
const str = bcs.string().serialize('hello world').toBytes();
const bytes = bcs.bytes(4).serialize([1, 2, 3, 4]).toBytes();

// Parsing data back into original types
const parsedU8 = bcs.u8().parse(u8);
const parsedU64 = bcs.u64().parse(u64);     // returns string
const parsedStr = bcs.string().parse(str);
```

## Compound types

| Method                 | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `vector(type: T)`      | A variable length list of values of type `T`          |
| `fixedArray(size, T)`  | A fixed length array of values of type `T`            |
| `option(type: T)`      | A value of type `T` or `null`                         |
| `enum(name, values)`   | An enum value representing one of the provided values |
| `struct(name, fields)` | A struct with named fields of the provided types      |
| `tuple(types)`         | A tuple of the provided types                         |
| `map(K, V)`            | A map of keys of type `K` to values of type `V`       |

```ts
import { bcs } from '@unconfirmed/bcs';

// Vectors
const intList = bcs.vector(bcs.u8()).serialize([1, 2, 3, 4, 5]).toBytes();

// Fixed length Arrays
const intArray = bcs.fixedArray(4, bcs.u8()).serialize([1, 2, 3, 4]).toBytes();

// Option
const option = bcs.option(bcs.string()).serialize('some value').toBytes();
const nullOption = bcs.option(bcs.string()).serialize(null).toBytes();

// Enum
const MyEnum = bcs.enum('MyEnum', {
  NoType: null,
  Int: bcs.u8(),
  String: bcs.string(),
  Array: bcs.fixedArray(3, bcs.u8()),
});

const intEnum = MyEnum.serialize({ Int: 100 }).toBytes();
const parsed = MyEnum.parse(intEnum); // { $kind: 'Int', Int: 100 }

// Struct
const MyStruct = bcs.struct('MyStruct', {
  id: bcs.u8(),
  name: bcs.string(),
});

const struct = MyStruct.serialize({ id: 1, name: 'name' }).toBytes();

// Tuple
const tuple = bcs.tuple([bcs.u8(), bcs.string()]).serialize([1, 'name']).toBytes();

// Map (keys sorted by BCS bytes, matching Rust BTreeMap ordering)
const map = bcs
  .map(bcs.u8(), bcs.string())
  .serialize(
    new Map([
      [1, 'one'],
      [2, 'two'],
    ]),
  )
  .toBytes();
```

## Generics

Define generic types with TypeScript function helpers:

```ts
import { bcs, BcsType } from '@unconfirmed/bcs';

function Container<T>(T: BcsType<T>) {
  return bcs.struct('Container<T>', {
    contents: T,
  });
}

const bytes = Container(bcs.u8()).serialize({ contents: 100 }).toBytes();

// Multiple generics
function VecMap<K, V>(K: BcsType<K>, V: BcsType<V>) {
  return bcs.struct(`VecMap<${K.name}, ${V.name}>`, {
    keys: bcs.vector(K),
    values: bcs.vector(V),
  });
}

VecMap(bcs.string(), bcs.string())
  .serialize({
    keys: ['key1', 'key2'],
    values: ['value1', 'value2'],
  })
  .toBytes();
```

## Transforms

Map between application types and BCS serialization formats:

```ts
import { bcs, fromHex, toHex } from '@unconfirmed/bcs';

const Address = bcs.bytes(32).transform({
  input: (val: string) => fromHex(val),
  output: (val) => toHex(val),
});

const serialized = Address.serialize('0x000000...').toBytes();
const parsed = Address.parse(serialized); // returns hex string
```

## Serialized bytes formats

`serialize` returns a `SerializedBcs` instance with multiple output formats:

```ts
import { bcs, fromBase58, fromBase64, fromHex } from '@unconfirmed/bcs';

const serialized = bcs.string().serialize('this is a string');

const bytes: Uint8Array = serialized.toBytes();
const hex: string = serialized.toHex();
const base64: string = serialized.toBase64();
const base58: string = serialized.toBase58();

// Parse from any encoding
const str1 = bcs.string().parse(bytes);
const str2 = bcs.string().parse(fromHex(hex));
const str3 = bcs.string().parse(fromBase64(base64));
const str4 = bcs.string().parse(fromBase58(base58));
```

## Type inference

```ts
import { bcs, type InferBcsType, type InferBcsInput } from '@unconfirmed/bcs';

const MyStruct = bcs.struct('MyStruct', {
  id: bcs.u64(),
  name: bcs.string(),
});

// Using $inferType and $inferInput properties
type MyStructType = typeof MyStruct.$inferType;  // { id: string; name: string; }
type MyStructInput = typeof MyStruct.$inferInput; // { id: number | string | bigint; name: string; }

// Using type helpers
type MyStructType2 = InferBcsType<typeof MyStruct>;
type MyStructInput2 = InferBcsInput<typeof MyStruct>;
```

## WASM module

The bcs-zig WASM module is embedded in the package and can be loaded on demand for validation
or specialized operations:

```ts
import { loadWasmSync, loadWasm } from '@unconfirmed/bcs';

// Synchronous (Bun/Node)
const wasm = loadWasmSync();

// Async (browser-compatible)
const wasm = await loadWasm();

// WASM exports ULEB128, integer encoding, and full BCS serialize functions
const len = wasm.encodeUleb128(300);
```

## Building the WASM module

To rebuild the WASM from source (requires Zig >= 0.14 and bcs-zig as a sibling directory):

```sh
bun run build:wasm
```

## License

Apache-2.0
