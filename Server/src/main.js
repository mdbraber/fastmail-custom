import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { APNsClient } from './apns.js';
import { JMAPClient } from './jmap.js';
import { DeviceRegistry } from './devices.js';
import { loadState } from './state.js';
import { AccountWatcher } from './watcher.js';
import { createServer } from './http.js';

// ISO 8601 in local time (TZ) with offset; toISOString() is always UTC
const stamp = () => {
    const now = new Date();
    const offset = -now.getTimezoneOffset();
    const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
    const local = new Date(now.getTime() + offset * 60 * 1000).toISOString().slice(0, -1);
    return `${local}${offset < 0 ? '-' : '+'}${pad(offset / 60)}:${pad(offset % 60)}`;
};
const log = {
    info: (message) => console.log(`${stamp()} ${message}`),
    warn: (message) => console.warn(`${stamp()} warn: ${message}`),
    error: (message) => console.error(`${stamp()} error: ${message}`),
};

const config = loadConfig();
const apns = new APNsClient({
    key: await readFile(config.apns.keyFile, 'utf8'),
    keyId: config.apns.keyId,
    teamId: config.apns.teamId,
    sandbox: config.apns.sandbox,
    log,
});
const devices = new DeviceRegistry(path.join(config.dataDir, 'devices.json'), log);
await devices.load();

const watchers = {};
for (const account of Object.values(config.accounts)) {
    const state = await loadState(config.dataDir, account.name, log);
    const jmap = new JMAPClient({ token: account.token });
    watchers[account.name] = new AccountWatcher({ account, config, jmap, apns, devices, state, log });
}

const server = createServer({ config, watchers, devices, log });
server.listen(config.port, () => {
    log.info(`fastmail-push listening on ${config.port}, ${config.apns.sandbox ? 'sandbox' : 'production'} APNs`);
});
for (const watcher of Object.values(watchers)) watcher.start();

const shutdown = () => {
    log.info('stopping');
    for (const watcher of Object.values(watchers)) watcher.stop();
    apns.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
