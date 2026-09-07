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
        await devices.register(body.account, body.token);
        return reply(response, 200, { ok: true });
    }

    if (request.method === 'POST' && parts.length === 3 && parts[0] === 'jmap') {
        const watcher = watchers[parts[1]];
        // A wrong secret is not worth telling anyone about
        if (!watcher?.callbackSecret || !safeEqual(parts[2], watcher.callbackSecret)) return reply(response, 204);
        const body = await readJSON(request);
        if (body) await watcher.receive(body);
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

function readJSON(request) {
    return new Promise((resolve) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            body += chunk;
            if (body.length > BODY_LIMIT) {
                request.destroy();
                resolve(null);
            }
        });
        request.on('end', () => {
            try { resolve(body ? JSON.parse(body) : null); } catch { resolve(null); }
        });
        request.on('error', () => resolve(null));
    });
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
