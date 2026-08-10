// =============================================================================
// ZIP writer (store-only)
//
// Packs received files into one archive so a batch saves in a single gesture.
// Two constraints make this the only way to save many files at once: mobile
// browsers accept roughly one download per user gesture, and an anchor's
// `download` attribute cannot express a path — so the directory structure Frop
// preserves over the wire would otherwise flatten into underscored names.
//
// Entries are stored, never deflated. The payload is already-transferred bytes
// of unknown compressibility, and storing lets the archive reference the
// existing blobs instead of copying them: building it costs headers and nothing
// else, so it stays synchronous and inside the click that asked for it. Each
// entry arrives with its CRC32 already computed, so no pass over the data
// happens here at all.
//
// Sizes and offsets are 32-bit: this writer emits no ZIP64 records, so it
// refuses an archive that would overflow them rather than emit a corrupt one.
// =============================================================================

// Largest value the 32-bit size and offset fields can hold.
const ZIP32_LIMIT = 0xffffffff;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const VERSION = 20; // 2.0 — the floor for stored entries, accepted everywhere
const FLAG_UTF8 = 0x0800; // filenames are UTF-8, not the legacy code page
const METHOD_STORE = 0;

// Unix (3) in the high byte of "version made by". Not cosmetic: extractors read
// this to decide how to interpret filenames, and under the MS-DOS host (0) some
// apply legacy code-page translation that corrupts non-ASCII names even with
// FLAG_UTF8 set.
const HOST_UNIX = 3;
const VERSION_MADE_BY = (HOST_UNIX << 8) | VERSION;

// Declaring the Unix host means external attributes are read as a st_mode, so
// they must describe a readable regular file — left zero, extractors can
// materialize entries with no permission bits at all.
const UNIX_MODE_REGULAR_FILE = 0o100644;
const EXTERNAL_ATTRS = UNIX_MODE_REGULAR_FILE << 16;

const UTF8 = new TextEncoder();

// A received file, ready to be packed.
export interface ZipEntry {
  // Relative path as it arrived from the peer; '/' separated.
  name: string;
  blob: Blob;
  // CRC32 of the blob's bytes.
  crc: number;
}

// MS-DOS packed modification stamp, shared by both records of an entry.
interface DosStamp {
  time: number;
  date: number;
}

// =============================================================================
// Archive assembly
// =============================================================================

/**
 * Assemble entries into a ZIP archive.
 *
 * The returned Blob references each entry's blob rather than copying it, so the
 * call allocates only headers regardless of how much data it covers.
 *
 * Throws RangeError if the archive would exceed the 32-bit size and offset
 * fields this writer emits.
 */
export function buildZip(entries: ZipEntry[]): Blob {
  const parts: BlobPart[] = [];
  // ArrayBuffer-backed specifically: Blob rejects SharedArrayBuffer views.
  const centralHeaders: Uint8Array<ArrayBuffer>[] = [];
  const stamp = dosDateTime(new Date());
  const taken = new Set<string>();
  let offset = 0;

  for (const entry of entries) {
    const name = uniqueName(sanitizeEntryName(entry.name), taken);
    const nameBytes = UTF8.encode(name);
    const size = entry.blob.size;

    // Sited with the writes it constrains: this entry's size goes in a u32
    // field, and this offset goes in the central header's u32 field.
    if (size > ZIP32_LIMIT || offset > ZIP32_LIMIT) {
      throw new RangeError("archive exceeds 32-bit ZIP limits");
    }

    parts.push(localHeader(nameBytes, entry.crc, size, stamp), entry.blob);
    centralHeaders.push(
      centralHeader(nameBytes, entry.crc, size, stamp, offset),
    );
    offset += LOCAL_HEADER_SIZE + nameBytes.length + size;
  }

  const centralSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);
  // The end record points at the central directory, so its start must also fit.
  if (offset + centralSize > ZIP32_LIMIT) {
    throw new RangeError("archive exceeds 32-bit ZIP limits");
  }

  parts.push(...centralHeaders, eocd(entries.length, centralSize, offset));
  return new Blob(parts, { type: "application/zip" });
}

function localHeader(
  nameBytes: Uint8Array,
  crc: number,
  size: number,
  stamp: DosStamp,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(LOCAL_HEADER_SIZE + nameBytes.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, LOCAL_SIG, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, FLAG_UTF8, true);
  view.setUint16(8, METHOD_STORE, true);
  view.setUint16(10, stamp.time, true);
  view.setUint16(12, stamp.date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true); // compressed — equal to uncompressed when stored
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true); // no extra field
  bytes.set(nameBytes, LOCAL_HEADER_SIZE);
  return bytes;
}

function centralHeader(
  nameBytes: Uint8Array,
  crc: number,
  size: number,
  stamp: DosStamp,
  localOffset: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(CENTRAL_HEADER_SIZE + nameBytes.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, CENTRAL_SIG, true);
  view.setUint16(4, VERSION_MADE_BY, true);
  view.setUint16(6, VERSION, true); // version needed
  view.setUint16(8, FLAG_UTF8, true);
  view.setUint16(10, METHOD_STORE, true);
  view.setUint16(12, stamp.time, true);
  view.setUint16(14, stamp.date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true); // no extra field
  view.setUint16(32, 0, true); // no comment
  view.setUint16(34, 0, true); // single-disk archive
  view.setUint16(36, 0, true); // internal attributes
  view.setUint32(38, EXTERNAL_ATTRS, true);
  view.setUint32(42, localOffset, true);
  bytes.set(nameBytes, CENTRAL_HEADER_SIZE);
  return bytes;
}

function eocd(
  count: number,
  centralSize: number,
  centralOffset: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(EOCD_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, EOCD_SIG, true);
  view.setUint16(4, 0, true); // this disk
  view.setUint16(6, 0, true); // disk holding the central directory
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true); // no comment
  return bytes;
}

// MS-DOS packed date and time: two-second resolution, epoch 1980.
function dosDateTime(d: Date): DosStamp {
  return {
    time:
      (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >>> 1),
    date:
      ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// Reduce a peer-supplied path to something safe to extract. Names arrive from
// the other device, so they cannot be trusted to stay inside the archive root:
// absolute prefixes and '..' segments are dropped rather than escaped, which is
// what keeps extraction from writing outside the destination directory.
function sanitizeEntryName(name: string): string {
  const segments = name
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== "." && s !== "..");
  return segments.join("/") || "file";
}

// Two entries with the same path would silently overwrite each other on
// extraction, so later collisions get a numbered suffix ahead of the extension.
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const slash = name.lastIndexOf("/");
  // A dot immediately after the last separator starts a dotfile, not an
  // extension, so only a later dot splits the name.
  const dot = name.lastIndexOf(".");
  const split = dot > slash + 1 ? dot : name.length;
  const stem = name.slice(0, split);
  const ext = name.slice(split);
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
