// @unconfirmed/bcs WASM module — powered by bcs-zig
//
// Provides low-level BCS operations for the TypeScript wrapper.
// Used for ULEB128 encoding (avoids BigInt overhead in JS) and
// as a validation oracle to ensure byte-identical output with bcs-zig.
//
// Build (from repo root):
//   zig build-exe -target wasm32-freestanding -OReleaseSmall --dep bcs \
//     -Mroot=wasm/bcs.zig -Mbcs=../bcs-zig/src/bcs.zig -rdynamic \
//     --cache-dir /tmp/zig-cache --global-cache-dir /tmp/zig-global-cache

const bcs = @import("bcs");
const std = @import("std");

// ── Memory layout ──────────────────────────────────────────────────────
// [0..32768]:     Input area — JS writes data here for WASM to process
// [32768..65536]: Output area — WASM writes results here for JS to read

var work_buf: [65536]u8 = undefined;
var alloc_buf: [65536]u8 = undefined;
var fba = std.heap.FixedBufferAllocator.init(&alloc_buf);

/// Pointer to the start of the work buffer (input area).
export fn getBufferPtr() [*]u8 {
    return &work_buf;
}

// ── ULEB128 ────────────────────────────────────────────────────────────

/// Encode ULEB128 into output area (work_buf[32768..]).
/// Returns number of bytes written.
export fn encodeUleb128(value: u32) u32 {
    var v = value;
    var i: u32 = 0;
    const out = work_buf[32768..];
    while (true) {
        var byte: u8 = @truncate(v & 0x7f);
        v >>= 7;
        if (v != 0) byte |= 0x80;
        out[i] = byte;
        i += 1;
        if (v == 0) break;
    }
    return i;
}

/// Decode ULEB128 from work_buf at offset.
/// Returns packed u64: (value << 8) | bytes_read
export fn decodeUleb128(offset: u32) u64 {
    var total: u32 = 0;
    var shift: u5 = 0;
    var len: u32 = 0;
    const data = work_buf[offset..];

    while (true) {
        if (len >= 5) return 0; // overflow guard
        const byte = data[len];
        len += 1;
        total |= @as(u32, byte & 0x7f) << shift;
        if ((byte & 0x80) == 0) break;
        if (shift >= 28) return 0; // would overflow u32
        shift += 7;
    }

    return (@as(u64, total) << 8) | @as(u64, len);
}

// ── Integer serialization (write LE bytes to output area) ──────────────

/// Encode u64 from two u32 halves. Result in output area [32768..32776].
export fn encodeU64(lo: u32, hi: u32) void {
    const val: u64 = (@as(u64, hi) << 32) | @as(u64, lo);
    std.mem.writeInt(u64, work_buf[32768..32776], val, .little);
}

/// Encode u128 from four u32 parts. Result in output area [32768..32784].
export fn encodeU128(a: u32, b: u32, c: u32, d: u32) void {
    const val: u128 = (@as(u128, d) << 96) | (@as(u128, c) << 64) |
        (@as(u128, b) << 32) | @as(u128, a);
    std.mem.writeInt(u128, work_buf[32768..32784], val, .little);
}

/// Encode u256 from eight u32 parts. Result in output area [32768..32800].
export fn encodeU256(
    a: u32,
    b: u32,
    c: u32,
    d: u32,
    e: u32,
    f: u32,
    g: u32,
    h: u32,
) void {
    const val: u256 = (@as(u256, h) << 224) | (@as(u256, g) << 192) |
        (@as(u256, f) << 160) | (@as(u256, e) << 128) |
        (@as(u256, d) << 96) | (@as(u256, c) << 64) |
        (@as(u256, b) << 32) | @as(u256, a);
    std.mem.writeInt(u256, work_buf[32768..32800], val, .little);
}

// ── Full BCS serialize via bcs-zig (for validation) ────────────────────

/// Serialize arbitrary bytes from input area using bcs-zig.
/// Writes ULEB128 length prefix + bytes to output area.
/// Returns total bytes written, or 0 on error.
export fn serializeBytes(input_offset: u32, input_len: u32) u32 {
    fba.reset();
    const data = work_buf[input_offset .. input_offset + input_len];
    const bytes = bcs.serialize(fba.allocator(), data) catch return 0;
    const out_start: usize = 32768;
    if (bytes.len > 32768) return 0; // too large for output area
    @memcpy(work_buf[out_start .. out_start + bytes.len], bytes);
    return @intCast(bytes.len);
}

/// Serialize a single bool value. Result in output area.
export fn serializeBool(val: u32) u32 {
    fba.reset();
    const bytes = bcs.serialize(fba.allocator(), val != 0) catch return 0;
    @memcpy(work_buf[32768 .. 32768 + bytes.len], bytes);
    return @intCast(bytes.len);
}

/// Serialize a u64 value. Result in output area.
export fn serializeU64(lo: u32, hi: u32) u32 {
    fba.reset();
    const val: u64 = (@as(u64, hi) << 32) | @as(u64, lo);
    const bytes = bcs.serialize(fba.allocator(), val) catch return 0;
    @memcpy(work_buf[32768 .. 32768 + bytes.len], bytes);
    return @intCast(bytes.len);
}

/// Serialize a u128 value. Result in output area.
export fn serializeU128(a: u32, b: u32, c: u32, d: u32) u32 {
    fba.reset();
    const val: u128 = (@as(u128, d) << 96) | (@as(u128, c) << 64) |
        (@as(u128, b) << 32) | @as(u128, a);
    const bytes = bcs.serialize(fba.allocator(), val) catch return 0;
    @memcpy(work_buf[32768 .. 32768 + bytes.len], bytes);
    return @intCast(bytes.len);
}

/// Serialize a u256 value. Result in output area.
export fn serializeU256(
    a: u32,
    b: u32,
    c: u32,
    d: u32,
    e: u32,
    f: u32,
    g: u32,
    h: u32,
) u32 {
    fba.reset();
    const val: u256 = (@as(u256, h) << 224) | (@as(u256, g) << 192) |
        (@as(u256, f) << 160) | (@as(u256, e) << 128) |
        (@as(u256, d) << 96) | (@as(u256, c) << 64) |
        (@as(u256, b) << 32) | @as(u256, a);
    const bytes = bcs.serialize(fba.allocator(), val) catch return 0;
    @memcpy(work_buf[32768 .. 32768 + bytes.len], bytes);
    return @intCast(bytes.len);
}

// Required for wasm32-freestanding build-exe target
pub fn main() void {}
