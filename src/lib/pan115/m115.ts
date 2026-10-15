/**
 * 115 网盘 m115 加密算法（TypeScript 版）
 *
 * 逐行翻译自 115driver 开源项目：
 *   github.com/SheltonZhu/115driver/pkg/crypto/m115/
 *   - public.go：GenerateKey / Encode / Decode
 *   - rsa.go：RSA 公钥加密（1024 位，E=0x10001）
 *   - xor.go：XOR 派生密钥 + 变换
 *   - util.go：reverseBytes
 *
 * 用途：115 离线下载接口 lixian.115.com/lixianssp 要求请求体经过
 * 该算法加密（RSA + XOR + 字节反转 + Base64），直接提交明文会
 * 返回 "decode fail!"。
 */

/** 预计算密钥数据（144 字节，来自 xor.go） */
const XOR_KEY_SEED = new Uint8Array([
  0xf0, 0xe5, 0x69, 0xae, 0xbf, 0xdc, 0xbf, 0x8a,
  0x1a, 0x45, 0xe8, 0xbe, 0x7d, 0xa6, 0x73, 0xb8,
  0xde, 0x8f, 0xe7, 0xc4, 0x45, 0xda, 0x86, 0xc4,
  0x9b, 0x64, 0x8b, 0x14, 0x6a, 0xb4, 0xf1, 0xaa,
  0x38, 0x01, 0x35, 0x9e, 0x26, 0x69, 0x2c, 0x86,
  0x00, 0x6b, 0x4f, 0xa5, 0x36, 0x34, 0x62, 0xa6,
  0x2a, 0x96, 0x68, 0x18, 0xf2, 0x4a, 0xfd, 0xbd,
  0x6b, 0x97, 0x8f, 0x4d, 0x8f, 0x89, 0x13, 0xb7,
  0x6c, 0x8e, 0x93, 0xed, 0x0e, 0x0d, 0x48, 0x3e,
  0xd7, 0x2f, 0x88, 0xd8, 0xfe, 0xfe, 0x7e, 0x86,
  0x50, 0x95, 0x4f, 0xd1, 0xeb, 0x83, 0x26, 0x34,
  0xdb, 0x66, 0x7b, 0x9c, 0x7e, 0x9d, 0x7a, 0x81,
  0x32, 0xea, 0xb6, 0x33, 0xde, 0x3a, 0xa9, 0x59,
  0x34, 0x66, 0x3b, 0xaa, 0xba, 0x81, 0x60, 0x48,
  0xb9, 0xd5, 0x81, 0x9c, 0xf8, 0x6c, 0x84, 0x77,
  0xff, 0x54, 0x78, 0x26, 0x5f, 0xbe, 0xe8, 0x1e,
  0x36, 0x9f, 0x34, 0x80, 0x5c, 0x45, 0x2c, 0x9b,
  0x76, 0xd5, 0x1b, 0x8f, 0xcc, 0xc3, 0xb8, 0xf5,
]);

/** 客户端密钥（12 字节，来自 xor.go） */
const XOR_CLIENT_KEY = new Uint8Array([
  0x78, 0x06, 0xad, 0x4c, 0x33, 0x86, 0x5d, 0x18,
  0x4c, 0x01, 0x3f, 0x46,
]);

/**
 * 固定数据 XOR 密钥（4 字节，来自 p115cipher RSA_KEY）
 * p115client / p115cipher 默认用固定密钥变体：
 *   16 字节全零前缀 + data XOR RSA_KEY(4B) → 反转 → XOR G_key_l(12B) → RSA → Base64
 * 115 服务端当前按此固定密钥解密；115driver 的随机 key 变体已被 115 弃用（返回 "decode fail!"）
 */
const RSA_KEY_4 = new Uint8Array([0x8d, 0xa5, 0xa5, 0x8d]);

/** 固定 16 字节全零前缀（p115cipher RSA_RAND_KEY） */
const ZERO_KEY_16 = new Uint8Array(16);

/** RSA 模数 N（128 字节，来自 rsa.go） */
const RSA_N_HEX =
  "8686980c0f5a24c4b9d43020cd2c22703ff3f450756529058b1cf88f09b86021" +
  "36477198a6e2683149659bd122c33592fdb5ad47944ad1ea4d36c6b172aad633" +
  "8c3bb6ac6227502d010993ac967d1aef00f0c8e038de2e4d3bc2ec368af2e9f1" +
  "0a6f1eda4f7262f136420c07c331b871bf139f74f3010e3c4fe57df3afb71683";

/** RSA 指数 E = 0x10001 */
const RSA_E = 0x10001;

/** RSA 密钥长度（字节） */
const RSA_KEY_LENGTH = 128;

const RSA_N = BigInt("0x" + RSA_N_HEX);
const RSA_E_BIG = BigInt(RSA_E);

// ---------------------------------------------------------------------------
// BigInt 辅助
// ---------------------------------------------------------------------------

/** 字节数组 → BigInt（大端） */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (let i = 0; i < bytes.length; i++) {
    v = (v << 8n) | BigInt(bytes[i]);
  }
  return v;
}

/** BigInt → 字节数组（大端，去前导零；可指定最小长度补零） */
function bigIntToBytes(n: bigint, minLen = 0): Uint8Array {
  let hex = n.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  if (bytes.length < minLen) {
    const padded = new Uint8Array(minLen);
    padded.set(bytes, minLen - bytes.length);
    return padded;
  }
  return bytes;
}

/** 模幂运算（平方-乘算法） */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % mod;
    }
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

// ---------------------------------------------------------------------------
// XOR 变换（来自 xor.go）
// ---------------------------------------------------------------------------

/** 派生 XOR 密钥：key[i] = (seed[i] + XOR_KEY_SEED[size*i]) & 0xff; key[i] ^= XOR_KEY_SEED[size*(size-i-1)] */
function xorDeriveKey(seed: Uint8Array, size: number): Uint8Array {
  const key = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    key[i] = (seed[i] + XOR_KEY_SEED[size * i]) & 0xff;
    key[i] ^= XOR_KEY_SEED[size * (size - i - 1)];
  }
  return key;
}

/**
 * 查表派生 XOR 密钥（对应 p115cipher util.rsa_gen_key）：
 *   length = skLen*(skLen-1), index = 0
 *   for i: x = (randKey[i] + G_kts[index]) & 0xff
 *          xorKey[i] = G_kts[length] ^ x
 *          length -= skLen; index += skLen
 * 与 xorDeriveKey 数学等价（同 144 字节表），用于固定变体的响应解密。
 */
function rsaGenKey(randKey: Uint8Array, skLen: number): Uint8Array {
  const xorKey = new Uint8Array(skLen);
  let length = skLen * (skLen - 1);
  let index = 0;
  for (let i = 0; i < skLen; i++) {
    const x = (randKey[i] + XOR_KEY_SEED[index]) & 0xff;
    xorKey[i] = XOR_KEY_SEED[length] ^ x;
    length -= skLen;
    index += skLen;
  }
  return xorKey;
}

/** XOR 变换：先处理前 dataSize%4 个字节，再循环处理剩余 */
function xorTransform(data: Uint8Array, key: Uint8Array): void {
  const dataSize = data.length;
  const keySize = key.length;
  const mod = dataSize % 4;
  if (mod > 0) {
    for (let i = 0; i < mod; i++) {
      data[i] ^= key[i % keySize];
    }
  }
  for (let i = mod; i < dataSize; i++) {
    data[i] ^= key[(i - mod) % keySize];
  }
}

/** 原地反转字节 */
function reverseBytes(data: Uint8Array): void {
  for (let i = 0, j = data.length - 1; i < j; i++, j--) {
    const tmp = data[i];
    data[i] = data[j];
    data[j] = tmp;
  }
}

// ---------------------------------------------------------------------------
// RSA（来自 rsa.go）
// ---------------------------------------------------------------------------

/** 生成 1..255 的随机字节（对应 Go 的 rand.Read + b%0xff+1） */
function randomPadBytes(count: number): Uint8Array {
  const raw = new Uint8Array(count);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(raw);
  } else {
    for (let i = 0; i < count; i++) {
      raw[i] = Math.floor(Math.random() * 256);
    }
  }
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = (raw[i] % 0xff) + 1;
  }
  return out;
}

/**
 * PKCS#1 v1.5 固定填充（对应 p115cipher pad_pkcs1_v1_5）：
 *   \x00 + \x02*(size-2-len) + \x00 + message
 * 固定 0x02 重复（无随机性），p115client 当前使用；服务端可正常解密。
 */
function fixedPadBytes(size: number, inputLen: number): Uint8Array {
  const padSize = size - 2 - inputLen;
  const pad = new Uint8Array(padSize);
  pad.fill(0x02);
  return pad;
}

/** RSA 加密一块（≤117 字节），输出固定 128 字节；paddingMode: "fixed" 或 "random" */
function rsaEncryptSlice(input: Uint8Array, out: Uint8Array[], paddingMode: "fixed" | "random" = "random"): void {
  const keyLength = RSA_KEY_LENGTH;
  const padSize = keyLength - input.length - 3;
  const buf = new Uint8Array(keyLength);
  buf[0] = 0;
  buf[1] = 2;
  if (paddingMode === "fixed") {
    for (let i = 0; i < padSize; i++) {
      buf[2 + i] = 0x02;
    }
  } else {
    const padData = randomPadBytes(padSize);
    for (let i = 0; i < padSize; i++) {
      buf[2 + i] = padData[i];
    }
  }
  buf[padSize + 2] = 0;
  buf.set(input, padSize + 3);

  const msg = bytesToBigInt(buf);
  const ret = modPow(msg, RSA_E_BIG, RSA_N);
  out.push(bigIntToBytes(ret, keyLength));
}

/** RSA 加密（分块，每块 117 字节） */
function rsaEncrypt(input: Uint8Array, paddingMode: "fixed" | "random" = "random"): Uint8Array {
  const parts: Uint8Array[] = [];
  let remain = input;
  while (remain.length > 0) {
    const sliceSize = Math.min(RSA_KEY_LENGTH - 11, remain.length);
    rsaEncryptSlice(remain.subarray(0, sliceSize), parts, paddingMode);
    remain = remain.subarray(sliceSize);
  }
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** RSA 解密一块（128 字节），输出去掉 padding 后的明文 */
function rsaDecryptSlice(input: Uint8Array, out: Uint8Array[]): void {
  const msg = bytesToBigInt(input);
  const ret = modPow(msg, RSA_E_BIG, RSA_N);
  const retBytes = bigIntToBytes(ret);
  for (let i = 1; i < retBytes.length; i++) {
    if (retBytes[i] === 0) {
      out.push(retBytes.subarray(i + 1));
      return;
    }
  }
  out.push(retBytes);
}

/** RSA 解密（分块，每块 128 字节） */
function rsaDecrypt(input: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let remain = input;
  while (remain.length > 0) {
    const sliceSize = Math.min(RSA_KEY_LENGTH, remain.length);
    rsaDecryptSlice(remain.subarray(0, sliceSize), parts);
    remain = remain.subarray(sliceSize);
  }
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Base64（标准 Base64，兼容 atob/btoa）
// ---------------------------------------------------------------------------

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/[\s\r\n]+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// 对外 API（来自 public.go）
// ---------------------------------------------------------------------------

/** 生成 16 字节随机密钥 */
export function generateKey(): Uint8Array {
  const key = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(key);
  } else {
    for (let i = 0; i < 16; i++) {
      key[i] = Math.floor(Math.random() * 256);
    }
  }
  return key;
}

/**
 * 加密（对应 Go Encode）：
 * buf = key(16) + input
 * XOR(key派生4字节) → 反转 → XOR(clientKey) → RSA → Base64
 */
export function m115Encode(input: Uint8Array, key: Uint8Array): string {
  const buf = new Uint8Array(16 + input.length);
  buf.set(key, 0);
  buf.set(input, 16);

  const dataPart = buf.subarray(16);
  xorTransform(dataPart, xorDeriveKey(key, 4));
  reverseBytes(dataPart);
  xorTransform(dataPart, XOR_CLIENT_KEY);

  return bytesToBase64(rsaEncrypt(buf));
}

/**
 * 解密（对应 Go Decode）：
 * Base64 解码 → RSA 解密 → 取 [16:] → XOR(key前16字节派生12字节) → 反转 → XOR(外部key派生4字节)
 */
export function m115Decode(input: string, key: Uint8Array): Uint8Array {
  let data = base64ToBytes(input);
  data = rsaDecrypt(data);

  const output = new Uint8Array(data.length - 16);
  output.set(data.subarray(16));

  xorTransform(output, xorDeriveKey(data.subarray(0, 16), 12));
  reverseBytes(output);
  xorTransform(output, xorDeriveKey(key, 4));

  return output;
}

// ---------------------------------------------------------------------------
// 固定密钥变体（对齐 p115cipher rsa_encrypt / rsa_decrypt 默认参数）
// 115 服务端当前按此变体解密；115driver 的随机 key 变体已被弃用。
// ---------------------------------------------------------------------------

/**
 * 固定变体加密（对应 p115cipher rsa_encrypt 默认参数）：
 *   buf = 16字节全零 + input
 *   input 部分: XOR RSA_KEY_4(4B) → 反转 → XOR XOR_CLIENT_KEY(12B)
 *   RSA 加密（固定 0x02 padding）→ Base64
 * 完全确定性：同输入同输出。
 */
export function m115EncodeFixed(input: Uint8Array): string {
  const buf = new Uint8Array(16 + input.length);
  buf.set(ZERO_KEY_16, 0);
  buf.set(input, 16);

  const dataPart = buf.subarray(16);
  xorTransform(dataPart, RSA_KEY_4);
  reverseBytes(dataPart);
  xorTransform(dataPart, XOR_CLIENT_KEY);

  return bytesToBase64(rsaEncrypt(buf, "fixed"));
}

/**
 * 固定变体解密（对应 p115cipher rsa_decrypt 默认参数）：
 *   Base64 解码 → RSA 解密 → randkey = [0:16] → key_l = rsaGenKey(randkey, 12)
 *   data: XOR key_l → 反转 → XOR RSA_KEY_4
 */
export function m115DecodeFixed(input: string): Uint8Array {
  let data = base64ToBytes(input);
  data = rsaDecrypt(data);

  const randKey = data.subarray(0, 16);
  const keyL = rsaGenKey(randKey, 12);

  const output = new Uint8Array(data.length - 16);
  output.set(data.subarray(16));

  xorTransform(output, keyL);
  reverseBytes(output);
  xorTransform(output, RSA_KEY_4);

  return output;
}
