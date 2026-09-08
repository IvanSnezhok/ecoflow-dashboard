#!/usr/bin/env python3
"""Train a zstd dictionary from length-prefixed samples.

Called by server/scripts/trainDictionary.mjs; not meant to be run by hand.
Node has no dictionary trainer, only a dictionary *user*, so this one step
shells out to python3 with the `zstandard` package (pip install zstandard).

    python3 train_dictionary.py <samples-file> <output-dict> <dict-size-bytes>

The samples file is a concatenation of 4-byte little-endian lengths, each
followed by that many bytes of sample.
"""
import struct
import sys

import zstandard


def read_samples(path):
    samples = []
    with open(path, "rb") as handle:
        while True:
            header = handle.read(4)
            if len(header) < 4:
                return samples
            (length,) = struct.unpack("<I", header)
            payload = handle.read(length)
            if len(payload) < length:
                raise SystemExit(f"truncated sample: wanted {length} bytes, got {len(payload)}")
            samples.append(payload)


def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    samples_path, out_path, dict_size = sys.argv[1], sys.argv[2], int(sys.argv[3])

    samples = read_samples(samples_path)
    if not samples:
        raise SystemExit("no samples to train on")

    dictionary = zstandard.train_dictionary(dict_size, samples)
    data = dictionary.as_bytes()
    with open(out_path, "wb") as handle:
        handle.write(data)

    total = sum(len(s) for s in samples)
    print(
        f"Trained on {len(samples)} samples ({total / 1024 ** 2:.1f} MiB) "
        f"-> {out_path} ({len(data)} bytes)"
    )


if __name__ == "__main__":
    main()
