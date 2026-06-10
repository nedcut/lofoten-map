const CHUNK_SIZE = 4 * 1024 * 1024;
const SMALL_FILE_BYTES = CHUNK_SIZE * 2;

const SHA256_K = new Uint32Array([
  1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
  3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
  3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
  2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895,
  666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037,
  2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
  430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
  1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298,
]);

function rotr(value: number, shift: number) {
  return (value >>> shift) | (value << (32 - shift));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

class Sha256Stream {
  private readonly state = new Uint32Array([
    1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225,
  ]);
  private readonly buffer = new Uint8Array(64);
  private bufferLength = 0;
  private bytesHashed = 0;
  private finished = false;

  update(chunk: Uint8Array) {
    if (this.finished) throw new Error("SHA-256: cannot update after digest");
    this.bytesHashed += chunk.length;
    let offset = 0;
    while (offset < chunk.length) {
      const take = Math.min(64 - this.bufferLength, chunk.length - offset);
      this.buffer.set(chunk.subarray(offset, offset + take), this.bufferLength);
      this.bufferLength += take;
      offset += take;
      if (this.bufferLength === 64) {
        this.compress(this.buffer);
        this.bufferLength = 0;
      }
    }
  }

  private compress(block: Uint8Array) {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index += 1) {
      const base = index * 4;
      words[index] = ((block[base] << 24) | (block[base + 1] << 16) | (block[base + 2] << 8) | block[base + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(words[index - 15], 7) ^ rotr(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotr(words[index - 2], 17) ^ rotr(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let a = this.state[0];
    let b = this.state[1];
    let c = this.state[2];
    let d = this.state[3];
    let e = this.state[4];
    let f = this.state[5];
    let g = this.state[6];
    let h = this.state[7];

    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[index] + words[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }

  digest(): Uint8Array {
    if (this.finished) throw new Error("SHA-256: digest already called");
    this.finished = true;

    const bitLengthHi = Math.floor(this.bytesHashed / 0x20000000);
    const bitLengthLo = (this.bytesHashed << 3) >>> 0;
    this.buffer[this.bufferLength] = 0x80;
    if (this.bufferLength < 56) {
      this.buffer.fill(0, this.bufferLength + 1, 56);
    } else {
      this.buffer.fill(0, this.bufferLength + 1, 64);
      this.compress(this.buffer);
      this.buffer.fill(0, 0, 56);
    }
    this.buffer[56] = (bitLengthHi >>> 24) & 0xff;
    this.buffer[57] = (bitLengthHi >>> 16) & 0xff;
    this.buffer[58] = (bitLengthHi >>> 8) & 0xff;
    this.buffer[59] = bitLengthHi & 0xff;
    this.buffer[60] = (bitLengthLo >>> 24) & 0xff;
    this.buffer[61] = (bitLengthLo >>> 16) & 0xff;
    this.buffer[62] = (bitLengthLo >>> 8) & 0xff;
    this.buffer[63] = bitLengthLo & 0xff;
    this.compress(this.buffer);

    const output = new Uint8Array(32);
    for (let index = 0; index < 8; index += 1) {
      output[index * 4] = (this.state[index] >>> 24) & 0xff;
      output[index * 4 + 1] = (this.state[index] >>> 16) & 0xff;
      output[index * 4 + 2] = (this.state[index] >>> 8) & 0xff;
      output[index * 4 + 3] = this.state[index] & 0xff;
    }
    return output;
  }
}

async function hashLargeFile(file: File) {
  const hasher = new Sha256Stream();
  let offset = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    hasher.update(new Uint8Array(await chunk.arrayBuffer()));
    offset += CHUNK_SIZE;
  }
  return bytesToHex(hasher.digest());
}

/** SHA-256 fingerprint of a file. Large files are hashed in chunks to limit memory use. */
export async function fileContentHash(file: File): Promise<string> {
  if (file.size <= SMALL_FILE_BYTES) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return bytesToHex(new Uint8Array(digest));
  }
  return hashLargeFile(file);
}
