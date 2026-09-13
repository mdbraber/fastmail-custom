// Contact cards (JSContact, RFC 9553, as JMAP serves them in RFC 9610) into
// the two sets of addresses the rules ask about. Pure.

// Fastmail keeps VIPs as a group card with this uid; its `members` name
// cards by uid, not by id. The sets below are built per contacts account:
// the watcher reads every account the token can see and unions them.
export const VIPS_UID = 'vips';

const addressesOn = (card) => Object.values(card?.emails ?? {})
    .map((entry) => (typeof entry?.address === 'string' ? entry.address.trim().toLowerCase() : ''))
    .filter(Boolean);

// `contacts`: every address on a card that is not a group. `vips`: every
// address on a card the VIPs group names.
export function addressSets(cards) {
    const group = cards.find((card) => card?.kind === 'group' && card.uid === VIPS_UID);
    const members = new Set(Object.entries(group?.members ?? {}).filter(([, on]) => on === true).map(([uid]) => uid));
    const contacts = new Set();
    const vips = new Set();
    for (const card of cards) {
        const addresses = addressesOn(card);
        if (card?.kind !== 'group') for (const address of addresses) contacts.add(address);
        if (typeof card?.uid === 'string' && members.has(card.uid)) for (const address of addresses) vips.add(address);
    }
    return { contacts, vips };
}
