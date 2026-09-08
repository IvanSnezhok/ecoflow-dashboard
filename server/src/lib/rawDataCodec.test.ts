import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RAW_DATA_ZSTD_FLAG,
  compressRawData,
  decompressRawData,
  loadDictionary,
  parseRawData,
} from './rawDataCodec.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.resolve(__dirname, '../../test/fixtures/rawSample.json')

loadDictionary()

// Roundtrip on a real 5.8 KB / 242-key quota snapshot sampled from the live database.
const sample = fs.readFileSync(fixturePath, 'utf8')
assert.equal(Object.keys(JSON.parse(sample)).length, 242)

const blob = compressRawData(sample)
assert.equal(blob[0], RAW_DATA_ZSTD_FLAG)
assert.equal(decompressRawData(blob), sample, 'roundtrip must be byte-identical')
assert.ok(blob.length < sample.length / 10, `expected >10x compression, got ${sample.length}/${blob.length}`)

// Unicode and empty-object payloads survive the utf8 boundary.
for (const text of ['{}', '{"a":"тест ✅","b":null,"c":[1,2,3]}']) {
  assert.equal(decompressRawData(compressRawData(text)), text)
}

// A wrong format flag is rejected rather than silently mis-decoded.
const wrongFlag = Buffer.from(blob)
wrongFlag[0] = 0x02
assert.throws(() => decompressRawData(wrongFlag), /unsupported raw_data_z format flag 0x02/)

// Truncated / corrupt frames throw instead of returning garbage.
assert.throws(() => decompressRawData(Buffer.from([RAW_DATA_ZSTD_FLAG])), /too short/)
const corrupt = Buffer.from(blob)
corrupt[corrupt.length - 1] ^= 0xff
corrupt[Math.floor(corrupt.length / 2)] ^= 0xff
assert.throws(() => decompressRawData(corrupt))

// parseRawData prefers the compressed column...
assert.deepEqual(parseRawData({ raw_data: '{"stale":true}', raw_data_z: blob }), JSON.parse(sample))
// ...falls back to legacy TEXT when the blob is absent or unreadable...
assert.deepEqual(parseRawData({ raw_data: '{"legacy":1}', raw_data_z: null }), { legacy: 1 })
assert.deepEqual(parseRawData({ raw_data: '{"legacy":1}', raw_data_z: corrupt }), { legacy: 1 })
// ...and reports "no payload" when neither column is usable.
assert.equal(parseRawData({ raw_data: null, raw_data_z: null }), null)
assert.equal(parseRawData({ raw_data: 'not json', raw_data_z: null }), null)

console.log('rawData codec fixtures passed')
