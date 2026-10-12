/**
 * Firefox's `mozlz4` container: the 8-byte magic `mozLz40\0`, the
 * decompressed size as a 4-byte little-endian integer, then one raw LZ4 block
 * (no frame header, no checksums). Session store files use it.
 *
 * @module mozLz4
 */

const MAGIC = [0x6d, 0x6f, 0x7a, 0x4c, 0x7a, 0x34, 0x30, 0x00]; // "mozLz40\0"
const HEADER_LENGTH = MAGIC.length + 4;

export class MozLz4Error extends Error {
  override readonly name = "MozLz4Error";
}

/** Reads an LZ4 length run: the nibble, plus every following byte while they are 255. */
function readLength(input: Uint8Array, cursor: { at: number }, nibble: number): number {
  let length = nibble;
  if (nibble !== 15) return length;
  for (;;) {
    if (cursor.at >= input.length) throw new MozLz4Error("length run past end of input");
    const byte = input[cursor.at++]!;
    length += byte;
    if (byte !== 255) return length;
  }
}

/**
 * Decodes one raw LZ4 block into a buffer of exactly `size` bytes. Throws
 * `MozLz4Error` on any malformed input rather than reading or writing out of
 * bounds.
 */
export function decodeLz4Block(input: Uint8Array, size: number): Uint8Array {
  const output = new Uint8Array(size);
  const cursor = { at: 0 };
  let out = 0;
  while (cursor.at < input.length) {
    const token = input[cursor.at++]!;

    const literals = readLength(input, cursor, token >> 4);
    if (cursor.at + literals > input.length || out + literals > size) {
      throw new MozLz4Error("literal run out of bounds");
    }
    output.set(input.subarray(cursor.at, cursor.at + literals), out);
    cursor.at += literals;
    out += literals;

    // The last sequence carries literals only.
    if (cursor.at >= input.length) break;

    if (cursor.at + 2 > input.length) throw new MozLz4Error("truncated match offset");
    const offset = input[cursor.at]! | (input[cursor.at + 1]! << 8);
    cursor.at += 2;
    if (offset === 0 || offset > out) throw new MozLz4Error("match offset out of range");

    const matchLength = readLength(input, cursor, token & 15) + 4;
    if (out + matchLength > size) throw new MozLz4Error("match run out of bounds");
    // Byte by byte on purpose: a match may overlap the bytes it is producing.
    for (let from = out - offset, end = out + matchLength; out < end;) {
      output[out++] = output[from++]!;
    }
  }
  if (out !== size) throw new MozLz4Error(`decoded ${out} bytes, header promised ${size}`);
  return output;
}

/** Decodes a whole `.jsonlz4` / `.mozlz4` file. */
export function decodeMozLz4(file: Uint8Array): Uint8Array {
  if (file.length < HEADER_LENGTH || MAGIC.some((byte, index) => file[index] !== byte)) {
    throw new MozLz4Error("not a mozlz4 file");
  }
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const size = view.getUint32(MAGIC.length, true);
  return decodeLz4Block(file.subarray(HEADER_LENGTH), size);
}
