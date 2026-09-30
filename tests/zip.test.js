import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, createZip } from '../js/export/zip.js';

const bytes = (s) => new TextEncoder().encode(s);

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(bytes('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

// Reads back the entries by walking local file headers.
function readZip(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const entries = [];
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLength));
    const data = zip.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    entries.push({ name, data, crc });
    at += 30 + nameLength + size;
  }
  const end = zip.length - 22;
  return { entries, endSignature: view.getUint32(end, true), count: view.getUint16(end + 10, true) };
}

test('createZip stores entries that read back byte for byte', () => {
  const image = new Uint8Array(3000).map((_, i) => (i * 37) % 256);
  const zip = createZip([
    { name: 'notes.md', data: bytes('# Notes\n\n![photo](attachments/01-1-photo.png)\n') },
    { name: 'attachments/01-1-photo.png', data: image },
  ]);
  const { entries, endSignature, count } = readZip(zip);
  assert.equal(endSignature, 0x06054b50);
  assert.equal(count, 2);
  assert.deepEqual(entries.map((e) => e.name), ['notes.md', 'attachments/01-1-photo.png']);
  assert.deepEqual([...entries[1].data], [...image]);
  assert.equal(entries[1].crc, crc32(image));
});

test('the system unzip accepts the archive (skipped if unzip is missing)', (t) => {
  if (spawnSync('unzip', ['-v']).status !== 0) return t.skip('unzip not installed');
  const dir = mkdtempSync(path.join(tmpdir(), 'kitsunai-zip-'));
  try {
    const file = path.join(dir, 'export.zip');
    writeFileSync(file, createZip([
      { name: 'a.md', data: bytes('hello') },
      { name: 'attachments/ü-image.png', data: new Uint8Array([1, 2, 3]) },
    ]));
    const result = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /No errors detected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
