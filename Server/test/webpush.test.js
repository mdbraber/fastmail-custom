import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { decrypt, generateKeys, subscriptionKeys } from '../src/webpush.js';
import { encrypt } from './helpers/webpush-encrypt.js';

// RFC 8291, Appendix A: the one worked example with fixed keys and salt.
const rfc = {
    plaintext: 'When I grow up, I want to be a watermelon',
    receiverPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    receiverPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};
const b64 = (text) => Buffer.from(text, 'base64url');
const rfcKeys = () => ({ privateKey: b64(rfc.receiverPrivate), publicKey: b64(rfc.receiverPublic), auth: b64(rfc.auth) });

test('the RFC 8291 example decrypts to its plaintext', () => {
    const plain = decrypt(b64(rfc.body), rfcKeys());
    assert.equal(plain.toString(), rfc.plaintext);
});

test('the test encryptor reproduces the RFC 8291 example, so round trips mean something', () => {
    const body = encrypt(rfc.plaintext, rfcKeys(), { senderPrivate: b64(rfc.senderPrivate), salt: b64(rfc.salt) });
    assert.equal(body.toString('base64url'), rfc.body);
});

test('generated keys are what the JMAP subscription wants', () => {
    const keys = generateKeys();
    assert.equal(keys.privateKey.length, 32);
    assert.equal(keys.publicKey.length, 65);
    assert.equal(keys.publicKey[0], 0x04);
    assert.equal(keys.auth.length, 16);

    const sub = subscriptionKeys(keys);
    assert.deepEqual(Object.keys(sub), ['p256dh', 'auth']);
    assert.match(sub.p256dh, /^[A-Za-z0-9_-]+$/);
    assert.match(sub.auth, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(b64(sub.p256dh), keys.publicKey);
    assert.deepEqual(b64(sub.auth), keys.auth);
    assert.notDeepEqual(generateKeys().publicKey, keys.publicKey);
});

test('a message encrypted to generated keys comes back, in one record or several', () => {
    const keys = generateKeys();
    const notice = JSON.stringify({ '@type': 'StateChange', changed: { a1: { Email: 's2', Mailbox: 's9' } } });
    assert.equal(decrypt(encrypt(notice, keys), keys).toString(), notice);
    const small = encrypt(notice, keys, { recordSize: 40 });
    assert.ok(small.length > 21 + 65 + 40 * 2, 'the small record size really splits the message');
    assert.equal(decrypt(small, keys).toString(), notice);
    assert.equal(decrypt(encrypt('', keys), keys).length, 0);
});

test('a body that is not for these keys, or was touched, is refused', () => {
    const keys = generateKeys();
    const body = encrypt('hello', keys);

    const tampered = Buffer.from(body);
    tampered[tampered.length - 3] ^= 0x01;
    assert.throws(() => decrypt(tampered, keys), /webpush/);

    assert.throws(() => decrypt(body, generateKeys()), /webpush/);
    assert.throws(() => decrypt(body, { ...keys, auth: randomBytes(16) }), /webpush/);

    const wrongId = Buffer.from(body);
    wrongId[20] = 64;
    assert.throws(() => decrypt(wrongId, keys), /webpush: .*key/);

    assert.throws(() => decrypt(body.subarray(0, 60), keys), /webpush/);
    assert.throws(() => decrypt(Buffer.alloc(0), keys), /webpush/);

    const badRecordSize = Buffer.from(body);
    badRecordSize.writeUInt32BE(17, 16);
    assert.throws(() => decrypt(badRecordSize, keys), /webpush: .*record/);
});

test('a message cut off after a whole non-final record is refused, not silently shortened', () => {
    // RFC 8188's delimiter exists for this: the first record decrypts fine on
    // its own, but its delimiter says more was coming
    const keys = generateKeys();
    const body = encrypt('a message long enough to need more than one record', keys, { recordSize: 40 });
    const afterFirstRecord = 21 + 65 + 40;
    assert.ok(body.length > afterFirstRecord + 40, 'the message spans at least three records');
    assert.throws(() => decrypt(body.subarray(0, afterFirstRecord), keys), /webpush: bad padding delimiter/);
    assert.throws(() => decrypt(body.subarray(0, afterFirstRecord + 40), keys), /webpush: bad padding delimiter/);
});
