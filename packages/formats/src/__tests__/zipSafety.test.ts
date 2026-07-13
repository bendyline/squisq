import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { getPartXml, openPackage } from '../ooxml/reader';
import type { OoxmlPackage } from '../ooxml/types';
import { openBoundedZipArchive, validateZipArchive, ZipSafetyError } from '../shared/zipSafety';
import { declaredZipEntryCount } from '../shared/zipEntryCount';

interface InstrumentedStream {
  pause(): InstrumentedStream;
}

interface StreamableEntry {
  internalStream(type: 'uint8array'): InstrumentedStream;
}

async function makeZip(
  files: Record<string, string | Uint8Array>,
  compression: 'STORE' | 'DEFLATE' = 'DEFLATE',
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, data] of Object.entries(files)) zip.file(path, data);
  return zip.generateAsync({ type: 'uint8array', compression });
}

function patchMemberMetadata(
  source: Uint8Array,
  path: string,
  patch: { uncompressedSize?: number; crc32?: number },
): Uint8Array {
  const bytes = source.slice();
  const view = new DataView(bytes.buffer);
  let patchedCentral = false;

  for (let offset = 0; offset <= bytes.byteLength - 4; offset++) {
    const signature = view.getUint32(offset, true);
    let nameOffset: number;
    let nameLengthOffset: number;
    let uncompressedSizeOffset: number;
    let crcOffset: number;
    if (signature === 0x02014b50) {
      nameOffset = offset + 46;
      nameLengthOffset = offset + 28;
      uncompressedSizeOffset = offset + 24;
      crcOffset = offset + 16;
    } else if (signature === 0x04034b50) {
      nameOffset = offset + 30;
      nameLengthOffset = offset + 26;
      uncompressedSizeOffset = offset + 22;
      crcOffset = offset + 14;
    } else {
      continue;
    }

    const nameLength = view.getUint16(nameLengthOffset, true);
    const name = new TextDecoder().decode(bytes.subarray(nameOffset, nameOffset + nameLength));
    if (name !== path) continue;
    if (patch.uncompressedSize !== undefined) {
      view.setUint32(uncompressedSizeOffset, patch.uncompressedSize, true);
    }
    if (patch.crc32 !== undefined) view.setUint32(crcOffset, patch.crc32, true);
    if (signature === 0x02014b50) patchedCentral = true;
  }

  expect(patchedCentral).toBe(true);
  return bytes;
}

function renameZipMember(source: Uint8Array, from: string, to: string): Uint8Array {
  expect(to.length).toBe(from.length);
  const bytes = source.slice();
  const view = new DataView(bytes.buffer);
  const replacement = new TextEncoder().encode(to);
  let renamedCentral = false;
  for (let offset = 0; offset <= bytes.byteLength - 4; offset++) {
    const signature = view.getUint32(offset, true);
    const isCentral = signature === 0x02014b50;
    const isLocal = signature === 0x04034b50;
    if (!isCentral && !isLocal) continue;
    const nameLengthOffset = offset + (isCentral ? 28 : 26);
    const nameOffset = offset + (isCentral ? 46 : 30);
    const nameLength = view.getUint16(nameLengthOffset, true);
    const name = new TextDecoder().decode(bytes.subarray(nameOffset, nameOffset + nameLength));
    if (name !== from) continue;
    bytes.set(replacement, nameOffset);
    if (isCentral) renamedCentral = true;
  }
  expect(renamedCentral).toBe(true);
  return bytes;
}

describe('bounded JSZip reads', () => {
  it('preflights duplicate central records before JSZip collapses their names', async () => {
    const valid = await makeZip({ 'one.txt': '1', 'two.txt': '2' }, 'STORE');
    const duplicate = renameZipMember(valid, 'two.txt', 'one.txt');
    const parsed = await JSZip.loadAsync(duplicate);
    expect(Object.values(parsed.files).filter((entry) => !entry.dir)).toHaveLength(1);

    const blob = new Blob([duplicate.slice().buffer]);
    await expect(openBoundedZipArchive(blob, { maxEntries: 1 })).rejects.toMatchObject({
      code: 'too-many-entries',
      limit: 1,
      actual: 2,
    });
  });

  it('counts directory-only central records toward the entry limit', async () => {
    const zip = new JSZip();
    zip.folder('one');
    zip.folder('two');
    const data = await zip.generateAsync({ type: 'uint8array' });
    await expect(openBoundedZipArchive(data, { maxEntries: 1 })).rejects.toMatchObject({
      code: 'too-many-entries',
      actual: 2,
    });
  });

  it('finds the EOCD record with a comment containing signature-like bytes', async () => {
    const zip = new JSZip();
    zip.file('one.txt', '1');
    zip.file('two.txt', '2');
    const data = await zip.generateAsync({
      type: 'uint8array',
      comment: 'looks like PK\u0005\u0006 but is only a comment',
    });
    expect(declaredZipEntryCount(data)).toBe(2);
  });

  it('reads ZIP64 record counts and falls back when ZIP64 metadata is ambiguous', () => {
    const zip64 = new Uint8Array(98);
    const view = new DataView(zip64.buffer);
    view.setUint32(0, 0x06064b50, true);
    view.setUint32(32, 3, true);
    view.setUint32(56, 0x07064b50, true);
    view.setUint32(64, 0, true);
    view.setUint32(76, 0x06054b50, true);
    view.setUint16(86, 0xffff, true);
    expect(declaredZipEntryCount(zip64)).toBe(3);

    zip64.fill(0, 56, 76);
    expect(declaredZipEntryCount(zip64)).toBeUndefined();
  });

  it('maps Blob read failures to a structured invalid-archive error', async () => {
    const unreadable = {
      size: 10,
      slice: () => unreadable,
      arrayBuffer: () => Promise.reject(new Error('read failed')),
    } as unknown as Blob;
    await expect(openBoundedZipArchive(unreadable)).rejects.toMatchObject({
      code: 'invalid-archive',
    });
  });

  it('returns structured errors while preserving established messages', async () => {
    const data = await makeZip({ 'large.txt': '12345' }, 'STORE');
    let error: unknown;
    try {
      await openBoundedZipArchive(data, { maxEntryUncompressedBytes: 4 });
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ZipSafetyError);
    expect(error).toMatchObject({
      name: 'ZipSafetyError',
      code: 'entry-too-large',
      path: 'large.txt',
      limit: 4,
      actual: 5,
    });
    expect((error as Error).message).toMatch(/exceeds 4 byte per-entry limit/);
  });

  it('rejects a high-ratio member from central-directory metadata', async () => {
    const data = await makeZip({ 'repeated.bin': new Uint8Array(128 * 1024) });
    await expect(openBoundedZipArchive(data, { maxCompressionRatio: 2 })).rejects.toMatchObject({
      code: 'compression-ratio-exceeded',
      path: 'repeated.bin',
      limit: 2,
    });
  });

  it('enforces the default compression-ratio ceiling against a single-member bomb', async () => {
    const data = await makeZip({ 'zeros.bin': new Uint8Array(2 * 1024 * 1024) });
    await expect(openBoundedZipArchive(data)).rejects.toMatchObject({
      code: 'compression-ratio-exceeded',
      path: 'zeros.bin',
      limit: 1000,
    });
  });

  it('halts an underdeclared member on its first emitted chunk without retaining it', async () => {
    const valid = await makeZip({ 'bomb.txt': new Uint8Array(1024 * 1024) });
    const forged = patchMemberMetadata(valid, 'bomb.txt', { uncompressedSize: 1 });
    const archive = await openBoundedZipArchive(forged);

    await expect(archive.read('bomb.txt')).rejects.toMatchObject({
      code: 'size-mismatch',
      path: 'bomb.txt',
    });
    expect(archive.emittedUncompressedBytes).toBe(0);
  });

  it('pauses every concurrent JSZip stream when one read breaches its bound', async () => {
    const data = await makeZip(
      {
        'one.bin': new Uint8Array(64 * 1024),
        'two.bin': new Uint8Array(64 * 1024),
      },
      'STORE',
    );
    const archive = await openBoundedZipArchive(data);
    const pauseSpies: Array<ReturnType<typeof vi.fn>> = [];

    for (const metadata of archive.entries) {
      const entry = metadata.entry as unknown as StreamableEntry;
      const original = entry.internalStream.bind(entry);
      entry.internalStream = ((type: 'uint8array') => {
        const stream = original(type);
        const pause = vi.fn(stream.pause.bind(stream));
        stream.pause = pause;
        pauseSpies.push(pause);
        return stream;
      }) as StreamableEntry['internalStream'];
    }

    const results = await Promise.allSettled([
      archive.read('one.bin', 1),
      archive.read('two.bin', 1),
    ]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(pauseSpies).toHaveLength(2);
    expect(pauseSpies.every((pause) => pause.mock.calls.length > 0)).toBe(true);
    expect(archive.emittedUncompressedBytes).toBe(0);
  });

  it('caches successful part reads without charging the aggregate budget twice', async () => {
    const data = await makeZip({ 'part.xml': '<part />' }, 'STORE');
    const archive = await openBoundedZipArchive(data);
    const first = await archive.read('part.xml');
    const emittedAfterFirstRead = archive.emittedUncompressedBytes;
    const second = await archive.read('part.xml');

    expect(second).toBe(first);
    expect(archive.emittedUncompressedBytes).toBe(emittedAfterFirstRead);
    expect(emittedAfterFirstRead).toBe(new TextEncoder().encode('<part />').byteLength);
  });

  it('checks CRC32 while streaming instead of eagerly inflating during load', async () => {
    const valid = await makeZip({ 'content.txt': 'integrity' }, 'STORE');
    const forged = patchMemberMetadata(valid, 'content.txt', { crc32: 0 });
    const archive = await openBoundedZipArchive(forged);

    await expect(archive.read('content.txt')).rejects.toMatchObject({
      code: 'crc-mismatch',
      path: 'content.txt',
    });
  });

  it('does not reject an otherwise valid JSZip object solely for unavailable internals', async () => {
    const data = await makeZip({ 'content.txt': 'okay' }, 'STORE');
    const zip = await JSZip.loadAsync(data);
    const entry = zip.file('content.txt') as unknown as {
      _data: { uncompressedSize?: number; compressedSize?: number; crc32?: number };
    };
    delete entry._data.uncompressedSize;
    delete entry._data.compressedSize;
    delete entry._data.crc32;

    expect(() => validateZipArchive(zip)).not.toThrow();
  });

  it('rejects manually constructed OOXML packages that bypass bounded archive opening', async () => {
    const forged = {
      contentTypes: { overrides: new Map(), defaults: new Map() },
      rootRelationships: [],
    } as unknown as OoxmlPackage;

    await expect(getPartXml(forged, 'custom.xml')).rejects.toThrow(
      'Invalid OoxmlPackage: create packages with openPackage().',
    );
  });

  it('bounds mandatory OOXML metadata independently of large media allowances', async () => {
    const oversizedContentTypes = `<Types>${' '.repeat(1024 * 1024)}</Types>`;
    const data = await makeZip(
      {
        '[Content_Types].xml': oversizedContentTypes,
        'word/media/large.bin': new Uint8Array(2 * 1024 * 1024),
      },
      'STORE',
    );

    await expect(openPackage(data.slice().buffer)).rejects.toMatchObject({
      code: 'entry-too-large',
      path: '[Content_Types].xml',
      limit: 1024 * 1024,
    });
  });

  it('bounds OOXML relationship metadata before DOM parsing', async () => {
    const oversizedRelationships = `<Relationships>${' '.repeat(4 * 1024 * 1024)}</Relationships>`;
    const data = await makeZip(
      {
        '[Content_Types].xml': '<Types />',
        '_rels/.rels': oversizedRelationships,
      },
      'STORE',
    );

    await expect(openPackage(data.slice().buffer)).rejects.toMatchObject({
      code: 'entry-too-large',
      path: '_rels/.rels',
      limit: 4 * 1024 * 1024,
    });
  });
});
