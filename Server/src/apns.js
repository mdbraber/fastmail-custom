import http2 from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';

// Apple Push Notification service over HTTP/2 with token-based auth: a short-
// lived ES256 JWT signed with the .p8 key from the developer portal.

export const HOSTS = Object.freeze({
    sandbox: 'https://api.sandbox.push.apple.com',
    production: 'https://api.push.apple.com',
});

// Apple wants the token younger than an hour and not minted more often
// than every twenty minutes; fifty minutes sits between the two.
export const TOKEN_LIFETIME_MS = 50 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 15 * 1000;
export const SESSION_TIMEOUT_MS = 60 * 1000;

const base64url = (text) => Buffer.from(text).toString('base64url');

export function mintToken({ key, keyId, teamId, now = Date.now() }) {
    const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
    const claims = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) }));
    // JWT wants the raw r||s signature, not the DER that sign() gives by default
    const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
    return `${header}.${claims}.${signature.toString('base64url')}`;
}

// After APNs answers for one device: keep it, or forget it for good.
export function deviceOutcome(status, reason) {
    if (status === 410) return 'remove';
    if (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic')) return 'remove';
    return 'keep';
}

// After APNs answers about our own credentials: mint a fresh token, or not.
export function tokenOutcome(status, reason) {
    return status === 403 && (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken') ? 'remint' : 'keep';
}

export class APNsClient {
    constructor({ key, keyId, teamId, sandbox = true, host, log = console, requestTimeoutMs = REQUEST_TIMEOUT_MS }) {
        this.privateKey = createPrivateKey(key);
        this.keyId = keyId;
        this.teamId = teamId;
        this.host = host || (sandbox ? HOSTS.sandbox : HOSTS.production);
        this.log = log;
        this.requestTimeoutMs = requestTimeoutMs;
        this.token = null;
        this.tokenAt = 0;
        this.session = null;
    }

    bearer(now = Date.now()) {
        if (!this.token || now - this.tokenAt > TOKEN_LIFETIME_MS) {
            this.token = mintToken({ key: this.privateKey, keyId: this.keyId, teamId: this.teamId, now });
            this.tokenAt = now;
        }
        return this.token;
    }

    connect() {
        if (this.session && !this.session.closed && !this.session.destroyed) return this.session;
        const session = http2.connect(this.host);
        session.on('error', (error) => this.log.warn(`apns session: ${error.message}`));
        session.on('close', () => { if (this.session === session) this.session = null; });
        // Mail is bursty; a session idle this long is likelier stale than quiet,
        // and the next push opens a new one
        session.setTimeout(SESSION_TIMEOUT_MS, () => session.close());
        this.session = session;
        return session;
    }

    close() {
        this.session?.close();
        this.session = null;
    }

    // One request. Resolves with APNs's answer whatever it is; rejects only
    // when the request never got one.
    request(deviceToken, payload, headers) {
        return new Promise((resolve, reject) => {
            // A cancelled stream can still end or error afterwards: settle once
            let done = false;
            const settle = (finish, value) => { if (!done) { done = true; finish(value); } };
            const stream = this.connect().request({
                ':method': 'POST',
                ':path': `/3/device/${deviceToken}`,
                authorization: `bearer ${this.bearer()}`,
                'content-type': 'application/json',
                ...headers,
            });
            let status = 0;
            let body = '';
            stream.setEncoding('utf8');
            stream.setTimeout(this.requestTimeoutMs, () => {
                stream.close(http2.constants.NGHTTP2_CANCEL);
                settle(reject, new Error('apns: timed out'));
            });
            stream.on('response', (responseHeaders) => { status = responseHeaders[':status']; });
            stream.on('data', (chunk) => { body += chunk; });
            stream.on('end', () => {
                let reason = null;
                try { reason = body ? (JSON.parse(body).reason ?? null) : null; } catch { reason = null; }
                settle(resolve, { status, reason });
            });
            stream.on('error', (error) => settle(reject, error));
            stream.end(JSON.stringify(payload));
        });
    }

    // An alert shows at once; a background push only wakes the app, and
    // Apple wants one sent at priority 5.
    async send(deviceToken, payload, { topic, collapseId = null, expiration = null, pushType = 'alert' }) {
        const headers = {
            'apns-topic': topic,
            'apns-push-type': pushType,
            'apns-priority': pushType === 'background' ? '5' : '10',
            'apns-expiration': String(expiration ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60),
        };
        if (collapseId) headers['apns-collapse-id'] = collapseId;
        let result = await this.request(deviceToken, payload, headers);
        if (tokenOutcome(result.status, result.reason) === 'remint') {
            this.token = null;
            result = await this.request(deviceToken, payload, headers);
        }
        return result;
    }
}
