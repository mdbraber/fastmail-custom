// A device's choice of which new messages alert it: as the app sends it to
// POST /devices, and as the registry keeps it.

export const MODES = Object.freeze(['off', 'important', 'inbox', 'custom']);
export const SENDERS = Object.freeze(['everyone', 'contacts', 'vips']);
export const MAX_MAILBOX_IDS = 200;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The choice an app build from before `notify` meant with its one switch.
export function fromAlerts(alerts) {
    return { mode: alerts === false ? 'off' : 'inbox', senders: 'everyone', mailboxIds: [] };
}

// `notify` checked and filled in: { notify } or { error } naming the field.
// The mailbox ids are kept exactly as sent, in their order: the app compares
// what it sent with what was accepted.
export function normaliseNotify(value) {
    if (!isPlainObject(value)) return { error: 'notify must be an object' };
    if (!MODES.includes(value.mode)) return { error: `notify.mode must be one of ${MODES.join(', ')}` };
    const senders = value.senders === undefined ? 'everyone' : value.senders;
    if (!SENDERS.includes(senders)) return { error: `notify.senders must be one of ${SENDERS.join(', ')}` };
    const mailboxIds = value.mailboxIds === undefined ? [] : value.mailboxIds;
    if (!Array.isArray(mailboxIds) || mailboxIds.length > MAX_MAILBOX_IDS
        || !mailboxIds.every((id) => typeof id === 'string' && id.length > 0)) {
        return { error: `notify.mailboxIds must be an array of at most ${MAX_MAILBOX_IDS} non-empty strings` };
    }
    return { notify: { mode: value.mode, senders, mailboxIds: [...mailboxIds] } };
}

// A registration's choice: `notify` when it is there, otherwise the older
// `alerts` switch, where no value means on. A malformed `alerts` is refused
// either way.
export function registrationChoice(body) {
    if (body.alerts !== undefined && typeof body.alerts !== 'boolean') return { error: 'alerts must be true or false' };
    if (body.notify !== undefined) return normaliseNotify(body.notify);
    return { notify: fromAlerts(body.alerts) };
}

// What a registry record asks for. A record from before `notify` carries
// `alerts` and reads the way that switch did; the file is never rewritten
// for it.
export function storedChoice(record) {
    if (record?.notify !== undefined) {
        const { notify } = normaliseNotify(record.notify);
        if (notify) return notify;
    }
    return fromAlerts(record?.alerts);
}
