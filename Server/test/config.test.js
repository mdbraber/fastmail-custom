import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, BUNDLE_IDS } from '../src/config.js';

const complete = {
    FASTMAIL_TOKEN_PERSONAL: 'fmu1-personal',
    APNS_KEY_FILE: '/secrets/AuthKey.p8',
    APNS_KEY_ID: 'ABC123DEFG',
    APNS_TEAM_ID: 'ABCDE12345',
    PUBLIC_URL: 'https://push.example.net/',
    DEVICE_SECRET: 'shared-secret',
};

test('a complete environment loads with the defaults filled in', () => {
    const config = loadConfig(complete);
    assert.deepEqual(Object.keys(config.accounts), ['personal']);
    assert.equal(config.accounts.personal.topic, BUNDLE_IDS.personal);
    assert.equal(config.accounts.personal.token, 'fmu1-personal');
    assert.equal(config.publicUrl, 'https://push.example.net');
    assert.equal(config.apns.sandbox, true);
    assert.equal(config.badgeLabel, 'Triage');
    assert.deepEqual(config.holdLabels, ['Later', 'Feedbin']);
    assert.equal(config.notices, 'auto');
    assert.equal(config.dataDir, '/data');
    assert.equal(config.port, 8080);
});

test('both accounts load when both tokens are set', () => {
    const config = loadConfig({ ...complete, FASTMAIL_TOKEN_WORK: 'fmu1-work' });
    assert.deepEqual(Object.keys(config.accounts).sort(), ['personal', 'work']);
    assert.equal(config.accounts.work.topic, BUNDLE_IDS.work);
});

test('everything missing is named at once', () => {
    assert.throws(() => loadConfig({}), /FASTMAIL_TOKEN_PERSONAL or FASTMAIL_TOKEN_WORK/);
    assert.throws(() => loadConfig({}), /APNS_KEY_FILE.*APNS_KEY_ID.*APNS_TEAM_ID.*PUBLIC_URL.*DEVICE_SECRET/);
});

test('APNS_SANDBOX=0 selects production', () => {
    assert.equal(loadConfig({ ...complete, APNS_SANDBOX: '0' }).apns.sandbox, false);
});

// The same labels the app calls holds: filing destinations that hold mail
// rather than queue it, which a decision replaces and an archive leaves on.
test('HOLD_LABELS is a list, and blanks in it are not labels', () => {
    assert.deepEqual(loadConfig({ ...complete, HOLD_LABELS: 'Later, Someday ,' }).holdLabels, ['Later', 'Someday']);
    assert.deepEqual(loadConfig({ ...complete, HOLD_LABELS: '' }).holdLabels, ['Later', 'Feedbin']);
});

test('an unknown NOTICES value and a bad PORT are refused', () => {
    assert.throws(() => loadConfig({ ...complete, NOTICES: 'carrier-pigeon' }), /NOTICES/);
    assert.throws(() => loadConfig({ ...complete, PORT: 'eighty' }), /PORT/);
});
