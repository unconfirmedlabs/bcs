// @unconfirmed/bcs WASM module — powered by bcs-zig
//
// Provides schema-driven BCS serialization/deserialization.
// JS compiles a type schema once, then passes packed values for fast encoding.
//
// Build (from repo root):
//   zig build-exe -target wasm32-freestanding -OReleaseSmall --dep bcs \
//     -Mroot=wasm/bcs.zig -Mbcs=../bcs-zig/src/bcs.zig -rdynamic \
//     --cache-dir /tmp/zig-cache --global-cache-dir /tmp/zig-global-cache

const bcs = @import("bcs");
const std = @import("std");

// ── Memory layout ──────────────────────────────────────────────────────
// [0..32768]:     Input area — JS writes schema + packed data here
// [32768..65536]: Output area — WASM writes BCS result here

var work_buf: [65536]u8 = undefined;
var alloc_buf: [65536]u8 = undefined;
var fba = std.heap.FixedBufferAllocator.init(&alloc_buf);

export fn getBufferPtr() [*]u8 {
    return &work_buf;
}

// ── Schema tags ──────────────────────────────────────────────────────
// These must match the TypeScript SchemaTag enum exactly.

const TAG_BOOL: u8 = 0x01;
const TAG_U8: u8 = 0x02;
const TAG_U16: u8 = 0x03;
const TAG_U32: u8 = 0x04;
const TAG_U64: u8 = 0x05;
const TAG_U128: u8 = 0x06;
const TAG_U256: u8 = 0x07;
const TAG_STRING: u8 = 0x08;
const TAG_BYTES: u8 = 0x09; // followed by u16 len
const TAG_VECTOR: u8 = 0x0A; // followed by element schema
const TAG_OPTION: u8 = 0x0B; // followed by inner schema
const TAG_STRUCT: u8 = 0x0C; // followed by u8 field count, then field schemas
const TAG_ENUM: u8 = 0x0D; // followed by u8 variant count, then variant schemas
const TAG_UNIT: u8 = 0x00; // null enum variant (0 bytes)

// ── ULEB128 helpers ──────────────────────────────────────────────────

fn writeUleb128(out: []u8, value: u32) u32 {
    var v = value;
    var i: u32 = 0;
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

fn readUleb128(data: []const u8) struct { value: u32, len: u32 } {
    var total: u32 = 0;
    var shift: u5 = 0;
    var len: u32 = 0;
    while (true) {
        if (len >= data.len or len >= 5) return .{ .value = 0, .len = 0 };
        const byte = data[len];
        len += 1;
        total |= @as(u32, byte & 0x7f) << shift;
        if ((byte & 0x80) == 0) break;
        if (shift >= 28) return .{ .value = 0, .len = 0 };
        shift += 7;
    }
    return .{ .value = total, .len = len };
}

// ── Schema-driven BCS serialization ──────────────────────────────────
//
// Input memory layout:
//   [0..schema_len]:                          Schema descriptor
//   [schema_len..schema_len+data_len]:        Packed value data
//
// Packed format:
//   bool:       1 byte
//   u8:         1 byte
//   u16:        2 bytes LE
//   u32:        4 bytes LE
//   u64:        8 bytes LE
//   u128:       16 bytes LE
//   u256:       32 bytes LE
//   string:     u32 len + bytes
//   bytes(N):   N bytes (size from schema)
//   vector<T>:  u32 count + packed elements
//   option<T>:  u8 tag (0=none, 1=some) + packed value if some
//   struct:     packed fields concatenated
//   enum:       u32 variant_index + packed variant data

/// Serialize packed data to BCS using schema descriptor.
/// Returns byte count written to output area, or 0 on error.
export fn serializePacked(schema_len: u32, data_len: u32) u32 {
    const schema = work_buf[0..schema_len];
    const data = work_buf[schema_len .. schema_len + data_len];
    const out = work_buf[32768..];

    var ctx = SerCtx{
        .schema = schema,
        .data = data,
        .out = out,
        .s_pos = 0,
        .d_pos = 0,
        .o_pos = 0,
    };

    serializeValue(&ctx) catch return 0;
    return ctx.o_pos;
}

const SerCtx = struct {
    schema: []const u8,
    data: []const u8,
    out: []u8,
    s_pos: u32,
    d_pos: u32,
    o_pos: u32,

    fn readSchemaU8(self: *SerCtx) !u8 {
        if (self.s_pos >= self.schema.len) return error.SchemaOverflow;
        const v = self.schema[self.s_pos];
        self.s_pos += 1;
        return v;
    }

    fn readSchemaU16(self: *SerCtx) !u16 {
        if (self.s_pos + 2 > self.schema.len) return error.SchemaOverflow;
        const v = std.mem.readInt(u16, self.schema[self.s_pos..][0..2], .little);
        self.s_pos += 2;
        return v;
    }

    fn readDataBytes(self: *SerCtx, n: u32) ![]const u8 {
        if (self.d_pos + n > self.data.len) return error.DataOverflow;
        const slice = self.data[self.d_pos .. self.d_pos + n];
        self.d_pos += n;
        return slice;
    }

    fn readDataU8(self: *SerCtx) !u8 {
        return (try self.readDataBytes(1))[0];
    }

    fn readDataU32(self: *SerCtx) !u32 {
        const bytes = try self.readDataBytes(4);
        return std.mem.readInt(u32, bytes[0..4], .little);
    }

    fn writeOut(self: *SerCtx, bytes: []const u8) !void {
        if (self.o_pos + bytes.len > 32768) return error.OutputOverflow;
        @memcpy(self.out[self.o_pos .. self.o_pos + bytes.len], bytes);
        self.o_pos += @intCast(bytes.len);
    }

    fn writeOutByte(self: *SerCtx, byte: u8) !void {
        if (self.o_pos >= 32768) return error.OutputOverflow;
        self.out[self.o_pos] = byte;
        self.o_pos += 1;
    }

    fn writeOutUleb(self: *SerCtx, value: u32) !void {
        var tmp: [5]u8 = undefined;
        const n = writeUleb128(&tmp, value);
        try self.writeOut(tmp[0..n]);
    }
};

fn serializeValue(ctx: *SerCtx) !void {
    const tag = try ctx.readSchemaU8();

    switch (tag) {
        TAG_BOOL => {
            const v = try ctx.readDataU8();
            try ctx.writeOutByte(if (v != 0) 1 else 0);
        },
        TAG_U8 => {
            const v = try ctx.readDataU8();
            try ctx.writeOutByte(v);
        },
        TAG_U16 => {
            const bytes = try ctx.readDataBytes(2);
            try ctx.writeOut(bytes);
        },
        TAG_U32 => {
            const bytes = try ctx.readDataBytes(4);
            try ctx.writeOut(bytes);
        },
        TAG_U64 => {
            const bytes = try ctx.readDataBytes(8);
            try ctx.writeOut(bytes);
        },
        TAG_U128 => {
            const bytes = try ctx.readDataBytes(16);
            try ctx.writeOut(bytes);
        },
        TAG_U256 => {
            const bytes = try ctx.readDataBytes(32);
            try ctx.writeOut(bytes);
        },
        TAG_STRING => {
            const len = try ctx.readDataU32();
            try ctx.writeOutUleb(len);
            const bytes = try ctx.readDataBytes(len);
            try ctx.writeOut(bytes);
        },
        TAG_BYTES => {
            const size = try ctx.readSchemaU16();
            const bytes = try ctx.readDataBytes(size);
            try ctx.writeOut(bytes);
        },
        TAG_VECTOR => {
            const count = try ctx.readDataU32();
            try ctx.writeOutUleb(count);
            // Save schema position — element schema repeats for each element
            const elem_schema_start = ctx.s_pos;
            for (0..count) |_| {
                ctx.s_pos = elem_schema_start;
                try serializeValue(ctx);
            }
            // Advance past element schema once
            if (count == 0) {
                try skipSchema(ctx);
            }
        },
        TAG_OPTION => {
            const present = try ctx.readDataU8();
            if (present != 0) {
                try ctx.writeOutByte(1);
                try serializeValue(ctx);
            } else {
                try ctx.writeOutByte(0);
                try skipSchema(ctx);
            }
        },
        TAG_STRUCT => {
            const field_count = try ctx.readSchemaU8();
            for (0..field_count) |_| {
                try serializeValue(ctx);
            }
        },
        TAG_ENUM => {
            const variant_count = try ctx.readSchemaU8();
            const variant_idx = try ctx.readDataU32();
            try ctx.writeOutUleb(variant_idx);
            // Skip to the correct variant schema
            for (0..variant_count) |i| {
                if (i == variant_idx) {
                    try serializeValue(ctx);
                } else {
                    try skipSchema(ctx);
                }
            }
        },
        TAG_UNIT => {},
        else => return error.UnknownTag,
    }
}

/// Skip over a schema descriptor without processing data.
fn skipSchema(ctx: *SerCtx) !void {
    const tag = try ctx.readSchemaU8();
    switch (tag) {
        TAG_BOOL, TAG_U8, TAG_U16, TAG_U32, TAG_U64, TAG_U128, TAG_U256, TAG_UNIT => {},
        TAG_STRING => {},
        TAG_BYTES => {
            ctx.s_pos += 2; // skip u16 size
        },
        TAG_VECTOR => try skipSchema(ctx),
        TAG_OPTION => try skipSchema(ctx),
        TAG_STRUCT => {
            const field_count = try ctx.readSchemaU8();
            for (0..field_count) |_| {
                try skipSchema(ctx);
            }
        },
        TAG_ENUM => {
            const variant_count = try ctx.readSchemaU8();
            for (0..variant_count) |_| {
                try skipSchema(ctx);
            }
        },
        else => return error.UnknownTag,
    }
}

// ── Schema-driven BCS deserialization ────────────────────────────────
//
// Reads BCS bytes from input and writes packed format to output.

export fn deserializeBcs(schema_len: u32, bcs_len: u32) u32 {
    const schema = work_buf[0..schema_len];
    const bcs_data = work_buf[schema_len .. schema_len + bcs_len];
    const out = work_buf[32768..];

    var ctx = DeCtx{
        .schema = schema,
        .bcs_data = bcs_data,
        .out = out,
        .s_pos = 0,
        .b_pos = 0,
        .o_pos = 0,
    };

    deserializeValue(&ctx) catch return 0;
    return ctx.o_pos;
}

const DeCtx = struct {
    schema: []const u8,
    bcs_data: []const u8,
    out: []u8,
    s_pos: u32,
    b_pos: u32,
    o_pos: u32,

    fn readSchemaU8(self: *DeCtx) !u8 {
        if (self.s_pos >= self.schema.len) return error.SchemaOverflow;
        const v = self.schema[self.s_pos];
        self.s_pos += 1;
        return v;
    }

    fn readSchemaU16(self: *DeCtx) !u16 {
        if (self.s_pos + 2 > self.schema.len) return error.SchemaOverflow;
        const v = std.mem.readInt(u16, self.schema[self.s_pos..][0..2], .little);
        self.s_pos += 2;
        return v;
    }

    fn readBcsBytes(self: *DeCtx, n: u32) ![]const u8 {
        if (self.b_pos + n > self.bcs_data.len) return error.BcsOverflow;
        const slice = self.bcs_data[self.b_pos .. self.b_pos + n];
        self.b_pos += n;
        return slice;
    }

    fn readBcsUleb(self: *DeCtx) !u32 {
        const remaining = self.bcs_data[self.b_pos..];
        const result = readUleb128(remaining);
        if (result.len == 0) return error.InvalidUleb;
        self.b_pos += result.len;
        return result.value;
    }

    fn writeOut(self: *DeCtx, bytes: []const u8) !void {
        if (self.o_pos + bytes.len > 32768) return error.OutputOverflow;
        @memcpy(self.out[self.o_pos .. self.o_pos + bytes.len], bytes);
        self.o_pos += @intCast(bytes.len);
    }

    fn writeOutByte(self: *DeCtx, byte: u8) !void {
        if (self.o_pos >= 32768) return error.OutputOverflow;
        self.out[self.o_pos] = byte;
        self.o_pos += 1;
    }

    fn writeOutU32(self: *DeCtx, value: u32) !void {
        var tmp: [4]u8 = undefined;
        std.mem.writeInt(u32, &tmp, value, .little);
        try self.writeOut(&tmp);
    }
};

fn deserializeValue(ctx: *DeCtx) !void {
    const tag = try ctx.readSchemaU8();

    switch (tag) {
        TAG_BOOL => {
            const bytes = try ctx.readBcsBytes(1);
            try ctx.writeOutByte(bytes[0]);
        },
        TAG_U8 => {
            const bytes = try ctx.readBcsBytes(1);
            try ctx.writeOutByte(bytes[0]);
        },
        TAG_U16 => {
            const bytes = try ctx.readBcsBytes(2);
            try ctx.writeOut(bytes);
        },
        TAG_U32 => {
            const bytes = try ctx.readBcsBytes(4);
            try ctx.writeOut(bytes);
        },
        TAG_U64 => {
            const bytes = try ctx.readBcsBytes(8);
            try ctx.writeOut(bytes);
        },
        TAG_U128 => {
            const bytes = try ctx.readBcsBytes(16);
            try ctx.writeOut(bytes);
        },
        TAG_U256 => {
            const bytes = try ctx.readBcsBytes(32);
            try ctx.writeOut(bytes);
        },
        TAG_STRING => {
            const len = try ctx.readBcsUleb();
            try ctx.writeOutU32(len);
            const bytes = try ctx.readBcsBytes(len);
            try ctx.writeOut(bytes);
        },
        TAG_BYTES => {
            const size = try ctx.readSchemaU16();
            const bytes = try ctx.readBcsBytes(size);
            try ctx.writeOut(bytes);
        },
        TAG_VECTOR => {
            const count = try ctx.readBcsUleb();
            try ctx.writeOutU32(count);
            const elem_schema_start = ctx.s_pos;
            for (0..count) |_| {
                ctx.s_pos = elem_schema_start;
                try deserializeValue(ctx);
            }
            if (count == 0) {
                try skipSchemaDeser(ctx);
            }
        },
        TAG_OPTION => {
            const bcs_tag = (try ctx.readBcsBytes(1))[0];
            try ctx.writeOutByte(bcs_tag);
            if (bcs_tag != 0) {
                try deserializeValue(ctx);
            } else {
                try skipSchemaDeser(ctx);
            }
        },
        TAG_STRUCT => {
            const field_count = try ctx.readSchemaU8();
            for (0..field_count) |_| {
                try deserializeValue(ctx);
            }
        },
        TAG_ENUM => {
            const variant_count = try ctx.readSchemaU8();
            const variant_idx = try ctx.readBcsUleb();
            try ctx.writeOutU32(variant_idx);
            for (0..variant_count) |i| {
                if (i == variant_idx) {
                    try deserializeValue(ctx);
                } else {
                    try skipSchemaDeser(ctx);
                }
            }
        },
        TAG_UNIT => {},
        else => return error.UnknownTag,
    }
}

fn skipSchemaDeser(ctx: *DeCtx) !void {
    const tag = try ctx.readSchemaU8();
    switch (tag) {
        TAG_BOOL, TAG_U8, TAG_U16, TAG_U32, TAG_U64, TAG_U128, TAG_U256, TAG_UNIT => {},
        TAG_STRING => {},
        TAG_BYTES => {
            ctx.s_pos += 2;
        },
        TAG_VECTOR => try skipSchemaDeser(ctx),
        TAG_OPTION => try skipSchemaDeser(ctx),
        TAG_STRUCT => {
            const field_count = try ctx.readSchemaU8();
            for (0..field_count) |_| {
                try skipSchemaDeser(ctx);
            }
        },
        TAG_ENUM => {
            const variant_count = try ctx.readSchemaU8();
            for (0..variant_count) |_| {
                try skipSchemaDeser(ctx);
            }
        },
        else => return error.UnknownTag,
    }
}

// ── Legacy exports (kept for backward compat) ────────────────────────

export fn encodeUleb128(value: u32) u32 {
    return writeUleb128(work_buf[32768..], value);
}

export fn decodeUleb128(offset: u32) u64 {
    const result = readUleb128(work_buf[offset..]);
    return (@as(u64, result.value) << 8) | @as(u64, result.len);
}

export fn encodeU64(lo: u32, hi: u32) void {
    const val: u64 = (@as(u64, hi) << 32) | @as(u64, lo);
    std.mem.writeInt(u64, work_buf[32768..32776], val, .little);
}

export fn encodeU128(a: u32, b: u32, c: u32, d: u32) void {
    const val: u128 = (@as(u128, d) << 96) | (@as(u128, c) << 64) |
        (@as(u128, b) << 32) | @as(u128, a);
    std.mem.writeInt(u128, work_buf[32768..32784], val, .little);
}

export fn encodeU256(a: u32, b: u32, c: u32, d: u32, e: u32, f: u32, g: u32, h: u32) void {
    const val: u256 = (@as(u256, h) << 224) | (@as(u256, g) << 192) |
        (@as(u256, f) << 160) | (@as(u256, e) << 128) |
        (@as(u256, d) << 96) | (@as(u256, c) << 64) |
        (@as(u256, b) << 32) | @as(u256, a);
    std.mem.writeInt(u256, work_buf[32768..32800], val, .little);
}

export fn serializeBytes(input_offset: u32, input_len: u32) u32 {
    fba.reset();
    const data = work_buf[input_offset .. input_offset + input_len];
    const bytes = bcs.serialize(fba.allocator(), data) catch return 0;
    const out_start: usize = 32768;
    if (bytes.len > 32768) return 0;
    @memcpy(work_buf[out_start .. out_start + bytes.len], bytes);
    return @intCast(bytes.len);
}

export fn serializeBool(val: u32) u32 {
    fba.reset();
    const bytes = bcs.serialize(fba.allocator(), val != 0) catch return 0;
    @memcpy(work_buf[32768 .. 32768 + bytes.len], bytes);
    return @intCast(bytes.len);
}

export fn serializeU64(lo: u32, hi: u32) u32 {
    fba.reset();
    const val: u64 = (@as(u64, hi) << 32) | @as(u64, lo);
    const bytes = bcs.serialize(fba.allocator(), val) catch return 0;
    @memcpy(work_buf[32768 .. 32768 + bytes.len], bytes);
    return @intCast(bytes.len);
}

export fn serializeU128(a: u32, b: u32, c: u32, d: u32) u32 {
    fba.reset();
    const val: u128 = (@as(u128, d) << 96) | (@as(u128, c) << 64) |
        (@as(u128, b) << 32) | @as(u128, a);
    const bytes = bcs.serialize(fba.allocator(), val) catch return 0;
    @memcpy(work_buf[32768 .. 32768 + bytes.len], bytes);
    return @intCast(bytes.len);
}

export fn serializeU256(a: u32, b: u32, c: u32, d: u32, e: u32, f: u32, g: u32, h: u32) u32 {
    fba.reset();
    const val: u256 = (@as(u256, h) << 224) | (@as(u256, g) << 192) |
        (@as(u256, f) << 160) | (@as(u256, e) << 128) |
        (@as(u256, d) << 96) | (@as(u256, c) << 64) |
        (@as(u256, b) << 32) | @as(u256, a);
    const bytes = bcs.serialize(fba.allocator(), val) catch return 0;
    @memcpy(work_buf[32768 .. 32768 + bytes.len], bytes);
    return @intCast(bytes.len);
}

pub fn main() void {}
