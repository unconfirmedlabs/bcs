# @unconfirmed/bcs

High-performance [Binary Canonical Serialization (BCS)](https://github.com/zefchain/bcs) for
TypeScript, powered by [bcs-zig](https://github.com/unconfirmedlabs/bcs-zig). Drop-in replacement
for [`@mysten/bcs`](https://www.npmjs.com/package/@mysten/bcs) — **5x faster** on average.

## Benchmarks

Roundtrip (serialize + deserialize) vs `@mysten/bcs`, 300K iterations on Bun:

| Payload | @mysten/bcs | @unconfirmed/bcs | Speedup |
|---------|-------------|-----------------|---------|
| SimpleStruct (41B) | 1.3M ops/s | 10.7M ops/s | **7.9x** |
| NestedStruct (65B) | 608K ops/s | 4.3M ops/s | **7.1x** |
| Enum variant (33B) | 1.3M ops/s | 9.6M ops/s | **7.3x** |
| u64 (8B) | 1.3M ops/s | 7.0M ops/s | **5.5x** |
| u128 (16B) | 604K ops/s | 3.1M ops/s | **5.1x** |
| u256 (32B) | 263K ops/s | 1.5M ops/s | **5.8x** |
| Option\<Struct\> (42B) | 921K ops/s | 7.7M ops/s | **8.3x** |
| Vec\<u32\> (1000) (4002B) | 91K ops/s | 410K ops/s | **4.5x** |
| Address [32]u8 (32B) | 1.9M ops/s | 12.9M ops/s | **6.8x** |
| **Average** | | | **5.2x** |

[Live benchmark](https://bcs-benchmark.vercel.app) — run it in your browser.

### `@unconfirmed/bcs/raw`

For hot paths, use the `raw` entrypoint with `serializeInto()` for zero-allocation serialization:

| Payload | @mysten/bcs serialize | serializeInto | Speedup |
|---------|-----------------------|---------------|---------|
| SimpleStruct | 728ns | 66ns | **11x** |
| u64 | 612ns | 36ns | **17x** |
| u256 | 1,718ns | 100ns | **17x** |
| Vec\<u32\> (1000) | 9,275ns | 884ns | **10x** |
| **Average** | | | **10x+** |

## Install

```sh
bun add @unconfirmed/bcs
# or
npm install @unconfirmed/bcs
```

## Migration from @mysten/bcs

Replace the import. The API is identical:

```diff
-import { bcs, fromHex, toHex } from '@mysten/bcs';
+import { bcs, fromHex, toHex } from '@unconfirmed/bcs';
```

All 244 tests from `@mysten/bcs`'s own test suite pass with byte-identical output. No code changes needed.

## Usage

```ts
import { bcs, fromHex, toHex } from '@unconfirmed/bcs';

const Coin = bcs.struct('Coin', {
  id: bcs.fixedArray(32, bcs.u8()).transform({
    input: (id: string) => fromHex(id),
    output: (id) => toHex(Uint8Array.from(id)),
  }),
  value: bcs.u64(),
});

// Serialize
const bytes = Coin.serialize({
  id: '0000000000000000000000000000000000000000000000000000000000000001',
  value: 1000000n,
}).toBytes();

// Deserialize
const coin = Coin.parse(bytes);
```

## `@unconfirmed/bcs/raw`

For performance-critical code, the `raw` entrypoint exposes `serializeInto()` which writes directly into a caller-provided buffer with zero allocation per call:

```ts
import { bcs } from '@unconfirmed/bcs/raw';

const MyStruct = bcs.struct('MyStruct', {
  sender: bcs.fixedArray(32, bcs.u8()),
  amount: bcs.u64(),
  active: bcs.bool(),
});

// Zero-allocation serialize into your own buffer
const buffer = new Uint8Array(4096);
let offset = 0;

for (const tx of transactions) {
  offset = MyStruct.serializeInto(tx, buffer, offset);
}

// Standard API still works
const bytes = MyStruct.serialize(value).toBytes();
const parsed = MyStruct.parse(bytes);
```

Same schemas, same types — `serializeInto` is just an additional method.

## How it works

Instead of interpreting type trees at runtime like `@mysten/bcs`, this library compiles specialized serialize/deserialize functions at schema definition time via `new Function()`:

- **Pre-computed field offsets** for fixed-size types
- **Direct byte writes** — no DataView allocation, no bounds checking
- **Inline ULEB128** — writes length prefixes directly into the buffer (no intermediate array)
- **Shared buffer** for variable-size types (no per-call ArrayBuffer allocation)
- **BigInt fast path** — `typeof` branch skips conversion when input is already bigint
- **ASCII fast path** — `String.fromCharCode` for short ASCII strings (skips TextDecoder)

## API

### Primitives

| Method | Output Type | Input Type | 
|--------|------------|------------|
| `bcs.bool()` | `boolean` | `boolean` |
| `bcs.u8()`, `bcs.u16()`, `bcs.u32()` | `number` | `number` |
| `bcs.u64()`, `bcs.u128()`, `bcs.u256()` | `string` | `number \| string \| bigint` |
| `bcs.string()` | `string` | `string` |
| `bcs.bytes(size)` | `Uint8Array` | `Iterable<number>` |

### Compound types

| Method | Description |
|--------|-------------|
| `bcs.vector(type)` | Variable-length array |
| `bcs.fixedArray(size, type)` | Fixed-length array |
| `bcs.option(type)` | Nullable value |
| `bcs.struct(name, fields)` | Named struct |
| `bcs.enum(name, variants)` | Tagged enum |
| `bcs.tuple(types)` | Ordered tuple |
| `bcs.map(keyType, valueType)` | Sorted map (BTreeMap ordering) |

### Methods on BcsType

| Method | Description |
|--------|-------------|
| `.serialize(value)` | Returns `SerializedBcs` with `.toBytes()`, `.toHex()`, `.toBase64()`, `.toBase58()` |
| `.serializeInto(value, buffer, offset)` | Zero-alloc write into caller buffer, returns new offset |
| `.parse(bytes)` | Deserialize from `Uint8Array` |
| `.fromHex(hex)` | Parse from hex string |
| `.fromBase64(b64)` | Parse from base64 |
| `.fromBase58(b58)` | Parse from base58 |
| `.transform({ input, output })` | Map between application and BCS types |

## License

Apache-2.0
