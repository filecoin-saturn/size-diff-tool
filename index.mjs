import { CarBlockIterator } from '@ipld/car'
import { toHex } from 'multiformats/bytes'
import { CID } from 'multiformats'
import { codecs, hashes } from './utils.js'
import { writeFile, readFile } from 'fs/promises';

const sources = ['ipfs.io', 'bifrost-gateway.ipfs.io', 'strn.pl'];

const topCids = await fetch('https://orchestrator.strn.pl/top-cids').then(res => res.json());

const results = await readFile('./results.json').then(JSON.parse);
const larger = await readFile('./diff-larger.json').then(JSON.parse);
const smaller = await readFile('./diff-smaller.json').then(JSON.parse);
const statuses = await readFile('./statuses.json').then(JSON.parse);

for (const source of sources) {
  statuses[source] = {};
}

for (const cid of topCids) {
  if (results[cid]) {
    console.log('skip')
    continue;
  }
  console.log(cid);
  results[cid] = {};
  for (const source of sources) {
    try {
      const res = await fetch(`https://${source}/ipfs/${cid}?format=car`);
      const { size, blocks } = await validateBody(res.body, cid);
      statuses[source][res.status] = (statuses[source][res.status] || 0) + 1;
      results[cid][source] = {
        status: res.status,
        cache: res.headers.get('x-proxy-cache') || res.headers.get('saturn-cache-status'),
        size,
        blockCount: Object.keys(blocks).length,
        blocks
      };
    } catch (e) {
      console.error(e.message)
      results[cid][source] = e.message;
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
  writeFile('statuses.json', JSON.stringify(statuses, null, 2));
  writeFile('diff-smaller.json', JSON.stringify(smaller, null, 2));
  writeFile('diff-larger.json', JSON.stringify(larger, null, 2));
}

async function validateBody(body, rootCid) {
  let carBlockIterator;
  try {
    carBlockIterator = await CarBlockIterator.fromIterable(body);
  } catch (err) {
    throw new Error(err.message);
  }

  const rootCidObj = CID.parse(rootCid.split("/")[0]);

  const blocks = {};
  let size = 0, blockIndex = 0;
  for await (const { cid, bytes } of carBlockIterator) {
    blocks[cid.toString()] = bytes.length;
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
      throw new Error("Hash mismatch");
    }

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