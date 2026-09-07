import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { isDeviceToken } from './devices.js';

const BODY_LIMIT = 64 * 1024;

export function createServer({ config, watchers, devices, log = console }) {
    return http.createServer((request, response) => {
        route({ config, watchers, devices }, request, response).catch((error) => {
            log.error(`http: ${error.message}`);
            if (!response.headersSent) reply(response, 500, { error: 'internal' });
        });
    });
}

async function route({ config, watchers, devices }, request, response) {
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    if (request.method === 'GET' && url.pathname === '/healthz') {
        const accounts = Object.fromEntries(Object.entries(watchers).map(([name, watcher]) => [name, watcher.status()]));
        return reply(response, 200, { accounts });
    }

    if (request.method === 'POST' && url.pathname === '/devices') {
        if (!bearerMatches(request.headers.authorization, config.deviceSecret)) {
            return reply(response, 401, { error: 'unauthorized' });
        }
        const body = await readJSON(request);
        // An array of one name would pass hasOwn on its toString, so insist on a string
        if (!body || typeof body.account !== 'string' || !Object.hasOwn(watchers, body.account) || !isDeviceToken(body.token)) {
            return reply(response, 400, { error: 'account and token required' });
        }
        // The device's own switch: absent means on; anything else must be a real boolean
        const alerts = body.alerts === undefined ? true : body.alerts;
        if (typeof alerts !== 'boolean') return reply(response, 400, { error: 'alerts must be true or false' });
        await devices.register(body.account, body.token, { alerts });
        return reply(response, 200, { ok: true, alerts });
    }

    if (request.method === 'POST' && parts.length === 3 && parts[0] === 'jmap') {
        const watcher = watchers[parts[1]];
        // A wrong secret is not worth telling anyone about
        if (!watcher?.callbackSecret || !safeEqual(parts[2], watcher.callbackSecret)) return reply(response, 204);
        const raw = await readBody(request);
        if (!raw) return reply(response, 204);
        // With keys on the subscription Fastmail seals every callback (RFC 8291)
        const sealed = String(request.headers['content-encoding'] ?? '').toLowerCase() === 'aes128gcm';
        const body = sealed ? watcher.unseal(raw) : parseJSON(raw);
        if (!body) return reply(response, 204);
        await watcher.receive(body);
        return reply(response, 200, { ok: true });
    }

    return reply(response, 404, { error: 'not found' });
}

function bearerMatches(header, secret) {
    const prefix = 'Bearer ';
    return typeof header === 'string' && header.startsWith(prefix) && safeEqual(header.slice(prefix.length), secret);
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && timingSafeEqual(left, right);
}

// The body as bytes, or null when there is none or it is over the cap
function readBody(request) {
    return new Promise((resolve) => {
        const chunks = [];
        let size = 0;
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > BODY_LIMIT) {
                request.destroy();
                resolve(null);
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => resolve(size ? Buffer.concat(chunks) : null));
        request.on('error', () => resolve(null));
    });
}

// A JSON object (or array) from the bytes, or null
function parseJSON(raw) {
    try {
        const body = JSON.parse(raw.toString('utf8'));
        return body && typeof body === 'object' ? body : null;
    } catch {
        return null;
    }
}

async function readJSON(request) {
    const raw = await readBody(request);
    return raw ? parseJSON(raw) : null;
}

function reply(response, status, body) {
    if (body === undefined) {
        response.writeHead(status);
        response.end();
        return;
    }
    const text = JSON.stringify(body);
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    response.end(text);
}
