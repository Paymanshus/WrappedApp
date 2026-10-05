import { Inflate } from 'fflate'

// Random-access ZIP reader over a Blob. Reads only the central directory up front, then
// slices each entry on demand — memory is bounded by the largest single entry, never the
// whole archive. Handles zip64 (WhatsApp media exports can pass 4GB) and data descriptors
// (sizes come from the central directory, so trailing descriptors don't matter).

export interface ZipEntry {
  name: string
  method: number        // 0 = stored, 8 = deflate
  compSize: number
  size: number
  localOffset: number
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true)
const u32 = (v: DataView, o: number) => v.getUint32(o, true)
const u64 = (v: DataView, o: number) => Number(v.getBigUint64(o, true))

async function view(blob: Blob, start: number, end: number) {
  return new DataView(await blob.slice(start, end).arrayBuffer())
}

export async function readEntries(blob: Blob): Promise<ZipEntry[]> {
  // EOCD (22) + max comment (65535) + zip64 locator (20)
  const tailStart = Math.max(0, blob.size - (22 + 65535 + 20))
  const tail = await view(blob, tailStart, blob.size)
  let eocd = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('This file is not a valid zip archive.')

  let count = u16(tail, eocd + 10)
  let cdSize = u32(tail, eocd + 12)
  let cdOffset = u32(tail, eocd + 16)
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20
    if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new Error('This zip uses an unsupported zip64 layout.')
    const recOffset = u64(tail, loc + 8)
    const rec = await view(blob, recOffset, recOffset + 56)
    if (u32(rec, 0) !== 0x06064b50) throw new Error('This zip is corrupt (bad zip64 record).')
    count = u64(rec, 32)
    cdSize = u64(rec, 40)
    cdOffset = u64(rec, 48)
  }

  const cd = await view(blob, cdOffset, cdOffset + cdSize)
  const utf8 = new TextDecoder('utf-8')
  const out: ZipEntry[] = []
  let p = 0
  for (let i = 0; i < count; i++) {
    if (u32(cd, p) !== 0x02014b50) throw new Error('This zip is corrupt (bad central directory).')
    const flags = u16(cd, p + 8)
    const method = u16(cd, p + 10)
    let compSize = u32(cd, p + 20)
    let size = u32(cd, p + 24)
    const nameLen = u16(cd, p + 28)
    const extraLen = u16(cd, p + 30)
    const commentLen = u16(cd, p + 32)
    let localOffset = u32(cd, p + 42)
    const name = utf8.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen))

    // zip64 extended info: only the fields that overflowed are present, in this order
    let e = p + 46 + nameLen
    const eEnd = e + extraLen
    while (e + 4 <= eEnd) {
      const id = u16(cd, e)
      const len = u16(cd, e + 2)
      if (id === 0x0001) {
        let q = e + 4
        if (size === 0xffffffff) { size = u64(cd, q); q += 8 }
        if (compSize === 0xffffffff) { compSize = u64(cd, q); q += 8 }
        if (localOffset === 0xffffffff) { localOffset = u64(cd, q) }
      }
      e += 4 + len
    }

    if (flags & 1) throw new Error('Password-protected zips are not supported.')
    if (!name.endsWith('/')) out.push({ name, method, compSize, size, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** Stream one entry's decompressed bytes. */
export async function entryStream(blob: Blob, e: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  const lh = await view(blob, e.localOffset, e.localOffset + 30)
  if (u32(lh, 0) !== 0x04034b50) throw new Error(`This zip is corrupt (bad header for ${e.name}).`)
  const start = e.localOffset + 30 + u16(lh, 26) + u16(lh, 28)
  const raw = blob.slice(start, start + e.compSize).stream() as ReadableStream<Uint8Array>
  if (e.method === 0) return raw
  if (e.method === 8) return raw.pipeThrough(inflateRaw())
  throw new Error(`${e.name} uses an unsupported compression method (${e.method}).`)
}

export async function entryBytes(blob: Blob, e: ZipEntry): Promise<Uint8Array> {
  return new Uint8Array(await new Response(await entryStream(blob, e)).arrayBuffer())
}

function inflateRaw(): TransformStream<Uint8Array, Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      return new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>
    } catch { /* older engines: no deflate-raw, fall through */ }
  }
  let inf: Inflate
  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      inf = new Inflate()
      inf.ondata = chunk => controller.enqueue(chunk)
    },
    transform(chunk) { inf.push(chunk, false) },
    flush() { inf.push(new Uint8Array(0), true) },
  })
}
