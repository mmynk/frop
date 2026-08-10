// =============================================================================
// CRC32 (IEEE 802.3)
//
// Standalone rather than part of the archive writer: the receive path
// checksums bytes as they stream in, and should not have to know what the
// result will later be used for.
//
// Every value that crosses this boundary is a finished CRC32, never an
// intermediate register — crc32Update re-inverts on entry and exit. So a
// caller may hold a partial result, resume with more bytes, and use the value
// directly at any point, with 0 as the seed for "no bytes yet".
// =============================================================================

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

// Folds more bytes into a CRC32 over everything checksummed so far.
export function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = ~crc;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return ~c >>> 0;
}
