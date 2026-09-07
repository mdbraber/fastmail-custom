import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

// Web Push message encryption (RFC 8291) over the aes128gcm content
// encoding (RFC 8188): what Fastmail applies to every callback once a push
// subscription carries keys. We are the "user agent" of those RFCs; Fastmail
// is the "application server", and puts its own ephemeral public key in the
// keyid field of each message.

const CURVE = 'prime256v1';
const PUBLIC_KEY_LENGTH = 65; // uncompressed P-256 point
const AUTH_LENGTH = 16;
const SALT_LENGTH = 16;
const HEADER_LENGTH = SALT_LENGTH + 4 + 1;
const TAG_LENGTH = 16;
const MIN_RECORD_SIZE = 18; // RFC 8188 §2.1: room for the tag and the delimiter
const DELIMITER_MORE = 1;
const DELIMITER_LAST = 2;

// The receiving half of a subscription: kept in memory for its lifetime.
export function generateKeys() {
    const ecdh = createECDH(CURVE);
    const publicKey = ecdh.generateKeys();
    return { privateKey: ecdh.getPrivateKey(), publicKey, auth: randomBytes(AUTH_LENGTH) };
}

// The `keys` object of PushSubscription/set (RFC 8620 §7.2).
export function subscriptionKeys({ publicKey, auth }) {
    return { p256dh: publicKey.toString('base64url'), auth: auth.toString('base64url') };
}

export function decrypt(body, keys) {
    if (body.length < HEADER_LENGTH + PUBLIC_KEY_LENGTH) throw new Error('webpush: body too short');
    const salt = body.subarray(0, SALT_LENGTH);
    const recordSize = body.readUInt32BE(SALT_LENGTH);
    const idLength = body[HEADER_LENGTH - 1];
    if (idLength !== PUBLIC_KEY_LENGTH) throw new Error(`webpush: keyid is not a P-256 public key (${idLength} bytes)`);
    if (recordSize < MIN_RECORD_SIZE) throw new Error(`webpush: record size ${recordSize} is too small`);
    const senderPublic = body.subarray(HEADER_LENGTH, HEADER_LENGTH + PUBLIC_KEY_LENGTH);

    const { key, nonceBase } = deriveKeys(keys, senderPublic, salt);
    const chunks = [];
    let offset = HEADER_LENGTH + PUBLIC_KEY_LENGTH;
    for (let sequence = 0; offset < body.length; sequence++) {
        const end = Math.min(offset + recordSize, body.length);
        const record = body.subarray(offset, end);
        if (record.length < TAG_LENGTH + 1) throw new Error('webpush: truncated record');
        const plain = decryptRecord(record, key, nonceFor(nonceBase, sequence));
        chunks.push(unpad(plain, end === body.length));
        offset = end;
    }
    if (chunks.length === 0) throw new Error('webpush: no records');
    return Buffer.concat(chunks);
}

function deriveKeys({ privateKey, publicKey, auth }, senderPublic, salt) {
    const ecdh = createECDH(CURVE);
    ecdh.setPrivateKey(privateKey);
    let shared;
    try {
        shared = ecdh.computeSecret(senderPublic);
    } catch {
        throw new Error('webpush: keyid is not a point on the curve');
    }
    // RFC 8291 §3.3–3.4: the auth secret keys the first extraction, the
    // two public keys bind the result to this pair; then RFC 8188 §2.2.
    const info = Buffer.concat([Buffer.from('WebPush: info\0'), publicKey, senderPublic]);
    const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
    return {
        key: Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16)),
        nonceBase: Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12)),
    };
}

function nonceFor(base, sequence) {
    const nonce = Buffer.from(base);
    nonce.writeUInt32BE((nonce.readUInt32BE(8) ^ sequence) >>> 0, 8);
    return nonce;
}

function decryptRecord(record, key, nonce) {
    const decipher = createDecipheriv('aes-128-gcm', key, nonce);
    decipher.setAuthTag(record.subarray(record.length - TAG_LENGTH));
    try {
        return Buffer.concat([decipher.update(record.subarray(0, record.length - TAG_LENGTH)), decipher.final()]);
    } catch {
        throw new Error('webpush: authentication failed');
    }
}

// RFC 8188 §2: the plaintext of a record ends with a delimiter octet and
// any number of zero octets; the delimiter says whether more records follow.
function unpad(plain, last) {
    let end = plain.length;
    while (end > 0 && plain[end - 1] === 0) end--;
    if (end === 0) throw new Error('webpush: record without a delimiter');
    const delimiter = plain[end - 1];
    if (delimiter !== (last ? DELIMITER_LAST : DELIMITER_MORE)) throw new Error('webpush: bad padding delimiter');
    return plain.subarray(0, end - 1);
}
