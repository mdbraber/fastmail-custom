import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fromAlerts, storedChoice } from './choice.js';

// Apple says not to assume a device token's length, only that it is hex.
const TOKEN = /^[0-9a-f]{32,512}$/i;

export function isDeviceToken(value) {
    return typeof value === 'string' && TOKEN.test(value);
}

// Every phone and tablet that asked for pushes, by account, on disk.
export class DeviceRegistry {
    constructor(file, log = console) {
        this.file = file;
        this.log = log;
        this.devices = {};
        this.saving = Promise.resolve();
    }

    async load() {
        try {
            const parsed = JSON.parse(await readFile(this.file, 'utf8'));
            this.devices = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (error) {
            if (error.code !== 'ENOENT') this.log.warn(`devices unreadable (${error.message}); starting empty`);
            this.devices = {};
        }
    }

    // Every device of the account with the choice it registered. A record
    // from before `notify` reads through its `alerts`.
    entries(account) {
        const records = this.devices[account] || {};
        return Object.keys(records).map((token) => ({ token, notify: storedChoice(records[token]) }));
    }

    // Every token for the account
    tokens(account) {
        return Object.keys(this.devices[account] || {});
    }

    // Registering again is how a device changes its mind
    async register(account, token, { notify = fromAlerts(true) } = {}) {
        (this.devices[account] ??= {})[token.toLowerCase()] = { registeredAt: new Date().toISOString(), notify };
        await this.save();
    }

    async remove(account, token) {
        const lower = token.toLowerCase();
        if (!this.devices[account]?.[lower]) return;
        delete this.devices[account][lower];
        await this.save();
    }

    // One write at a time: a registration and a prune arriving together would
    // otherwise share the one .tmp file, and the loser renames a file that is
    // already gone.
    save() {
        this.saving = this.saving.catch(() => {}).then(() => this.write());
        return this.saving;
    }

    async write() {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, JSON.stringify(this.devices, null, 2));
        await rename(`${this.file}.tmp`, this.file);
    }
}
