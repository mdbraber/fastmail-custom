// The environment, read once into one frozen object. Anything that cannot
// be defaulted stops the start: a server missing its key or its secret
// would otherwise come up and sit there quietly doing nothing.

export const BUNDLE_IDS = Object.freeze({
    personal: 'com.mdbraber.fastmail-custom.personal',
    work: 'com.mdbraber.fastmail-custom.work',
});

export const NOTICE_MODES = ['auto', 'push', 'eventsource'];

// Comma-separated label names, the same spelling the app's settings use.
// Nothing between two commas is not a label named "".
function labelList(value, fallback) {
    const names = String(value ?? '').split(',').map((name) => name.trim()).filter(Boolean);
    return names.length ? names : fallback;
}

export function loadConfig(env = process.env) {
    const missing = [];
    const required = (key) => {
        const value = (env[key] || '').trim();
        if (!value) missing.push(key);
        return value;
    };

    const accounts = {};
    for (const [name, topic] of Object.entries(BUNDLE_IDS)) {
        const token = (env[`FASTMAIL_TOKEN_${name.toUpperCase()}`] || '').trim();
        if (token) accounts[name] = Object.freeze({ name, token, topic });
    }
    if (!Object.keys(accounts).length) missing.push('FASTMAIL_TOKEN_PERSONAL or FASTMAIL_TOKEN_WORK');

    const config = {
        accounts: Object.freeze(accounts),
        apns: Object.freeze({
            keyFile: required('APNS_KEY_FILE'),
            keyId: required('APNS_KEY_ID'),
            teamId: required('APNS_TEAM_ID'),
            sandbox: (env.APNS_SANDBOX ?? '1').trim() !== '0',
        }),
        publicUrl: required('PUBLIC_URL').replace(/\/+$/, ''),
        deviceSecret: required('DEVICE_SECRET'),
        badgeLabel: (env.BADGE_LABEL || 'Triage').trim(),
        // Holds, in the app's sense: filing destinations that hold mail rather
        // than queue it. A decision replaces them, an archive leaves them on,
        // and the first of them is where the notification's Later button files.
        holdLabels: Object.freeze(labelList(env.HOLD_LABELS, ['Later'])),
        notices: (env.NOTICES || 'auto').trim(),
        dataDir: (env.DATA_DIR || '/data').trim(),
        port: Number(env.PORT || 8080),
    };

    if (!NOTICE_MODES.includes(config.notices)) {
        throw new Error(`NOTICES must be one of ${NOTICE_MODES.join(', ')}, not "${config.notices}"`);
    }
    if (!Number.isInteger(config.port) || config.port <= 0) {
        throw new Error(`PORT must be a positive integer, not "${env.PORT}"`);
    }
    if (missing.length) throw new Error(`missing configuration: ${missing.join(', ')}`);
    return Object.freeze(config);
}
