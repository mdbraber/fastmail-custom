import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

    tokens(account) {
        return Object.keys(this.devices[account] || {});
    }

    async register(account, token) {
        (this.devices[account] ??= {})[token.toLowerCase()] = { registeredAt: new Date().toISOString() };
        await this.save();
    }

    async remove(account, token) {
        const lower = token.toLowerCase();
        if (!this.devices[account]?.[lower]) return;
        delete this.devices[account][lower];
        await this.save();
    }

    async save() {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, JSON.stringify(this.devices, null, 2));
        await rename(`${this.file}.tmp`, this.file);
    }
}
