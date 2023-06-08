import { CarBlockIterator } from '@ipld/car'
import { toHex } from 'multiformats/bytes'
import { CID } from 'multiformats'
import { codecs, hashes } from './utils.js'
import { writeFile, readFile } from 'fs/promises';

const format = "raw" // "car" or "raw"
const sources = ['ipfs.io', 'bifrost-gateway.ipfs.io', 'strn.pl'];

const topCids = await fetch('https://orchestrator.strn.pl/top-cids').then(res => res.json());

const results = await readFile('./results.json').then(JSON.parse).catch(() => ({}));
const errors = await readFile('./errors.json').then(JSON.parse).catch(() => ({}));
const larger = await readFile('./diff-larger.json').then(JSON.parse).catch(() => ({}));
const smaller = await readFile('./diff-smaller.json').then(JSON.parse).catch(() => ({}));
const statuses = await readFile('./statuses.json').then(JSON.parse).catch(() => ({}));

for (const source of sources) {
  if (!statuses[source]) {
    statuses[source] = {};
  }
}

const cidList = format === 'raw' ? topCids.filter(cid => !cid.includes('/')) : topCids;
for (const cid of cidList) {
  if (results[cid] && Object.keys(results[cid]).length === sources.length) {
    console.log('skip')
    continue;
  }
  console.log(cid);
  results[cid] = {};
  for (const source of sources) {
    if (results[cid][source]?.status) {
      continue;
    }
    results[cid][source] = {};
    try {
      const res = await fetch(`https://${source}/ipfs/${cid}?format=${format}`);
      statuses[source][res.status] = (statuses[source][res.status] || 0) + 1;
      results[cid][source] = {
        status: res.status,
        cache: res.headers.get('x-proxy-cache') || res.headers.get('saturn-cache-status'),
      };
      if (!res.ok) {
        continue;
      }
      const { size, blocks } = await validateBody(res, cid, format);
      results[cid][source].size = size;
      if (format === 'car') {
        results[cid][source].blocks = blocks;
        results[cid][source].blockCount = Object.keys(blocks).length;
      }
    } catch (e) {
      console.error(e)
      results[cid][source].error = e.message;
      if (!errors[cid]) {
        errors[cid] = {};
      }
      errors[cid][source] = e.message;
    }
  }
  if (results[cid][sources[0]] && results[cid][sources[2]]) {
    if(results[cid][sources[0]].size < results[cid][sources[2]].size) {
      smaller[cid] = { ...results[cid], reason: "ipfs.io response smaller than strn.pl" };
      console.log("smaller", smaller[cid]);
    } else if (results[cid][sources[0]].size > results[cid][sources[2]].size) {
      larger[cid] = { ...results[cid], reason: "ipfs.io response larger than strn.pl" };
      console.log("larger", larger[cid]);
    }
  }
  writeFile('results.json', JSON.stringify(results, null, 2));
  writeFile('errors.json', JSON.stringify(errors, null, 2));
  writeFile('statuses.json', JSON.stringify(statuses, null, 2));
  if (format === 'car') {
    writeFile('diff-smaller.json', JSON.stringify(smaller, null, 2));
    writeFile('diff-larger.json', JSON.stringify(larger, null, 2));
  }
}

async function validateBody (res, cid, format) {
  const rootCidObj = CID.parse(cid.split("/")[0]);

  if (format === 'car') {
    return await validateCarBody(res.body, rootCidObj);
  } else if (format === 'raw') {
    const bytes = new Uint8Array(await res.arrayBuffer());
    await validateBytes(rootCidObj, bytes);
    return { size: bytes.length };
  }

  throw new Error(`Unexpected format: ${format}`);
}

async function validateCarBody(body, rootCidObj) {
  let carBlockIterator;
  try {
    carBlockIterator = await CarBlockIterator.fromIterable(body);
  } catch (err) {
    throw new Error(err.message);
  }

  const blocks = {};
  let size = 0, blockIndex = 0;
  for await (const { cid, bytes } of carBlockIterator) {
    blocks[cid.toString()] = bytes.length;

    await validateBytes(cid, bytes);

    if (blockIndex === 0 && rootCid.includes("/")) {
      console.log("rootCid content", Buffer.from(bytes).toString('utf-8'));
    }

    if (!rootCid.includes("/") && blockIndex === 0 && !rootCidObj.equals(cid)) {
      throw new Error(`block cid (${cid}) does not match root cid (${rootCid})`);
    }
    size += bytes.length;
    blockIndex++;
  }

  return { size, blocks }
}

async function validateBytes(cid, bytes) {
  if (!codecs[cid.code]) {
    throw new Error(`Unexpected codec: 0x${cid.code.toString(16)}`);
  }
  if (!hashes[cid.multihash.code]) {
    throw new Error(`Unexpected multihash code: 0x${cid.multihash.code.toString(16)}`);
  }

  // Verify step 2: if we hash the bytes, do we get the same digest as reported by the CID?
  // Note that this step is sufficient if you just want to safely verify the CAR's reported CIDs
  const hash = await hashes[cid.multihash.code].digest(bytes);
  if (toHex(hash.digest) !== toHex(cid.multihash.digest)) {
    throw new Error(
      `Mismatch: digest of bytes (${toHex(hash.digest)}) does not match digest in CID (${toHex(cid.multihash.digest)})`
    );
  }
}