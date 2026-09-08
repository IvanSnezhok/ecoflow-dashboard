import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * `device_states.raw_data` is a flat EcoFlow quota snapshot: ~242 keys that repeat
 * verbatim on every row. A zstd dictionary trained on real rows turns each ~7.4 KB
 * payload into a few hundred bytes, so the column is stored compressed in
 * `raw_data_z` while the legacy `raw_data` TEXT column is kept for rollback.
 *
 * Blob layout: [0] = format flag, [1..] = zstd frame compressed with the dictionary.
 */
export const RAW_DATA_ZSTD_FLAG = 0x01

/** zstd level 3 — the ratio measured on live data (0.078x); higher levels barely help here. */
const COMPRESSION_LEVEL = 3

/** Baked into the image next to the database; overridable for containers that mount `data/` as a volume. */
const DICTIONARY_CANDIDATES = [
  path.resolve(__dirname, '../../data/zstd.dict'),
  path.resolve(__dirname, '../../dict/zstd.dict'),
]

let dictionary: Buffer | null = null

/** Where `loadDictionary()` looks, in order. First existing file wins. */
export function dictionarySearchPaths(): string[] {
  const override = process.env.ECOFLOW_ZSTD_DICT
  return override ? [path.resolve(override), ...DICTIONARY_CANDIDATES] : DICTIONARY_CANDIDATES
}

/**
 * Read the dictionary once and memoise it. Throws when no candidate exists — the
 * server must fail fast, because without it every `raw_data_z` row is unreadable.
 */
export function loadDictionary(dictPath?: string): Buffer {
  if (dictionary && !dictPath) return dictionary

  const candidates = dictPath ? [path.resolve(dictPath)] : dictionarySearchPaths()
  for (const candidate of candidates) {
    let bytes: Buffer
    try {
      bytes = fs.readFileSync(candidate)
    } catch {
      continue
    }
    if (bytes.length === 0) {
      throw new Error(`zstd dictionary at ${candidate} is empty`)
    }
    dictionary = bytes
    return dictionary
  }

  throw new Error(
    `raw_data zstd dictionary not found. Looked in: ${candidates.join(', ')}. ` +
      'Restore server/data/zstd.dict from the repository or set ECOFLOW_ZSTD_DICT.'
  )
}

function getDictionary(): Buffer {
  return dictionary ?? loadDictionary()
}

/** JSON text -> flag byte + dictionary-compressed zstd frame. */
export function compressRawData(jsonText: string): Buffer {
  const frame = zlib.zstdCompressSync(Buffer.from(jsonText, 'utf8'), {
    params: { [zlib.constants.ZSTD_c_compressionLevel]: COMPRESSION_LEVEL },
    dictionary: getDictionary(),
  })
  return Buffer.concat([Buffer.from([RAW_DATA_ZSTD_FLAG]), frame])
}

/** Inverse of {@link compressRawData}. Throws on an unknown flag or a damaged frame. */
export function decompressRawData(blob: Buffer): string {
  if (!Buffer.isBuffer(blob) || blob.length < 2) {
    throw new Error(`raw_data_z blob is too short (${Buffer.isBuffer(blob) ? blob.length : typeof blob})`)
  }
  if (blob[0] !== RAW_DATA_ZSTD_FLAG) {
    throw new Error(`unsupported raw_data_z format flag 0x${blob[0].toString(16).padStart(2, '0')}`)
  }
  return zlib.zstdDecompressSync(blob.subarray(1), { dictionary: getDictionary() }).toString('utf8')
}

/** Shape of a `device_states` row as far as the raw payload is concerned. */
export interface RawDataRow {
  raw_data?: string | null
  raw_data_z?: Buffer | Uint8Array | null
}

let decodeFailureWarned = false

/**
 * Read the raw payload of a state row, preferring the compressed column and
 * falling back to the legacy TEXT column while the migration is in flight.
 * Returns null when neither column holds usable JSON — callers already treat a
 * missing payload as "no data" rather than an error.
 */
export function parseRawData(state: RawDataRow): Record<string, unknown> | null {
  const compressed = state.raw_data_z
  if (compressed && compressed.length > 0) {
    try {
      const buf = Buffer.isBuffer(compressed) ? compressed : Buffer.from(compressed)
      return JSON.parse(decompressRawData(buf)) as Record<string, unknown>
    } catch (err) {
      if (!decodeFailureWarned) {
        decodeFailureWarned = true
        console.warn('[rawDataCodec] falling back to raw_data:', err instanceof Error ? err.message : err)
      }
    }
  }

  if (!state.raw_data) return null
  try {
    return JSON.parse(state.raw_data) as Record<string, unknown>
  } catch {
    return null
  }
}
