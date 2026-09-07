import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

// The sending half of RFC 8291 + RFC 8188, as Fastmail runs it: encrypts a
// message to a subscription's keys. Test-only; the server never encrypts.
// `senderPrivate` and `salt` pin the output for the RFC's worked example.
export function encrypt(plaintext, { publicKey, auth }, { senderPrivate, salt = randomBytes(16), recordSize = 4096 } = {}) {
    const sender = createECDH('prime256v1');
    if (senderPrivate) sender.setPrivateKey(senderPrivate); else sender.generateKeys();
    const senderPublic = sender.getPublicKey();
    const shared = sender.computeSecret(publicKey);
    const info = Buffer.concat([Buffer.from('WebPush: info\0'), publicKey, senderPublic]);
    const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
    const key = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
    const nonceBase = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));

    const header = Buffer.alloc(21);
    salt.copy(header, 0);
    header.writeUInt32BE(recordSize, 16);
    header[20] = senderPublic.length;

    const text = Buffer.from(plaintext);
    const perRecord = recordSize - 17; // minus the tag and the delimiter
    const records = [];
    for (let offset = 0, seq = 0; ; offset += perRecord, seq++) {
        const last = offset + perRecord >= text.length;
        const chunk = text.subarray(offset, last ? text.length : offset + perRecord);
        const padded = Buffer.concat([chunk, Buffer.from([last ? 2 : 1])]);
        const nonce = Buffer.from(nonceBase);
        nonce.writeUInt32BE((nonce.readUInt32BE(8) ^ seq) >>> 0, 8);
        const cipher = createCipheriv('aes-128-gcm', key, nonce);
        records.push(cipher.update(padded), cipher.final(), cipher.getAuthTag());
        if (last) break;
    }
    return Buffer.concat([header, senderPublic, ...records]);
}

// A subscription's `keys` object, as sent to Fastmail, back to the buffers encrypt() wants.
export function keysFromSubscription({ p256dh, auth }) {
    return { publicKey: Buffer.from(p256dh, 'base64url'), auth: Buffer.from(auth, 'base64url') };
}
