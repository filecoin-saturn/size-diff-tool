import * as dagCbor from "@ipld/dag-cbor";
import * as dagJson from "@ipld/dag-json";
import * as dagPb from "@ipld/dag-pb";
import { blake2b256 } from "@multiformats/blake2/blake2b";
import * as json from "multiformats/codecs/json";
import * as raw from "multiformats/codecs/raw";
import { from as hasher } from "multiformats/hashes/hasher";
import { sha256 } from "multiformats/hashes/sha2";

export const codecs = {
  [dagCbor.code]: dagCbor,
  [dagPb.code]: dagPb,
  [dagJson.code]: dagJson,
  [raw.code]: raw,
  [json.code]: json,
};

export const hashes = {
  [sha256.code]: sha256,
  [blake2b256.code]: hasher(blake2b256),
};