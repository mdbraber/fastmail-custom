/*
 * Verify the `actionable` filter against a live Fastmail account.
 *
 * Paste into the console on app.fastmail.com. Read-only: it creates queries,
 * reads them, and destroys them. No message is modified.
 *
 * The check is an identity rather than a guess at your data:
 *
 *     actionable  +  excluded  ==  active
 *
 * where active   = TOPIC and (Inbox or Process)
 *       excluded = active and (Snoozed or Waiting)
 *       actionable = active and NOT (Snoozed or Waiting)
 *
 * If the NOT clause were being ignored, actionable would equal active and the
 * identity would fail whenever anything is deferred.
 */
(async function probeActionable(TOPIC = 'Personal') {
    const store = FastMail.store;
    const Message = FastMail.classes.Message;
    const MessageList = FastMail.classes.MessageList;
    const controller = FastMail.router.getAppController('mail');
    const toArray = (rl) => (rl && rl.map ? rl.map(x => x) : []);

    const mailbox = (name) => store.getAll(FastMail.classes.Mailbox)
        .filter(m => m.get('name') === name)[0];
    const mid = (name) => {
        const m = mailbox(name);
        if (!m) throw new Error('no such label: ' + name);
        return m.get('id');
    };

    const topic   = mid(TOPIC);
    const inbox   = mid('Inbox');
    const process = mid('Process');
    const snoozed = mid('Snoozed');
    const waiting = mid('Waiting');

    const live = controller.get('mailboxMessageList');
    const base = {
        accountId: controller.get('mailbox').get('accountId'),
        sort: live.get('sort'),
        collapseThreads: live.get('collapseThreads'),
        findAllInThread: live.get('findAllInThread'),
        findMatchingParts: live.get('findMatchingParts')
    };

    const active   = { operator: 'OR', conditions: [{ inMailbox: inbox }, { inMailbox: process }] };
    const deferred = [{ inMailbox: snoozed }, { inMailbox: waiting }];
    const AND = (...c) => ({ operator: 'AND', conditions: c });

    const specs = {
        topic:      { inMailbox: topic },
        active:     AND({ inMailbox: topic }, active),
        actionable: AND({ inMailbox: topic }, active, { operator: 'NOT', conditions: deferred }),
        excluded:   AND({ inMailbox: topic }, active, { operator: 'OR', conditions: deferred }),
        waiting:    AND({ inMailbox: topic }, { inMailbox: waiting }),
        snoozed:    AND({ inMailbox: topic }, { inMailbox: snoozed })
    };

    // The query id MUST come from Message.getQueryId.
    const made = {};
    for (const [name, where] of Object.entries(specs)) {
        const params = { ...base, where };
        const q = store.getQuery(Message.getQueryId(params), MessageList, params);
        if (!q.prefetch) q.prefetch = 5;
        const observer = { rangeDidChange() {} };
        // A WindowedQuery fetches nothing until something observes a range.
        q.addObserverForRange({ start: 0, end: 50 }, observer, 'rangeDidChange');
        q.getObjectAt(0);
        made[name] = { q, observer };
    }

    const settled = () => Object.values(made).every(({ q }) => q.get('length') !== null);
    for (let i = 0; i < 60 && !settled(); i++) {
        await new Promise(r => setTimeout(r, 250));
    }

    const len = (n) => made[n].q.get('length');
    const rows = (n, limit = 10) => {
        const q = made[n].q, total = q.get('length') || 0, out = [];
        for (let i = 0; i < Math.min(total, limit); i++) {
            const m = q.getObjectAt(i);
            out.push(m
                ? String(m.get('subject') || '(no subject)').slice(0, 44).padEnd(46) +
                  toArray(m.get('mailboxes')).map(x => x.get('name')).sort().join('+')
                : '(not loaded)');
        }
        return out;
    };

    console.log('%cactionable filter; ' + TOPIC, 'font-weight:bold;font-size:13px');
    console.table(Object.fromEntries(
        Object.keys(specs).map(n => [n, { count: len(n) }])));

    const ok = len('actionable') + len('excluded') === len('active');
    console.log(
        '%cidentity: actionable(%d) + excluded(%d) = active(%d)  ->  %s',
        'font-weight:bold;color:' + (ok ? 'green' : 'crimson'),
        len('actionable'), len('excluded'), len('active'), ok ? 'PASS' : 'FAIL');

    const doingWork = len('excluded') > 0;
    console.log(doingWork
        ? '%cthe NOT clause excluded ' + len('excluded') + ' message(s); filter is doing real work'
        : '%cnothing was deferred, so this run cannot prove the NOT clause bites',
        'color:' + (doingWork ? 'green' : 'darkorange'));

    if (len('excluded')) { console.log('\nexcluded from actionable:'); rows('excluded').forEach(r => console.log('  ' + r)); }
    console.log('\nwaiting in ' + TOPIC + ': ' + len('waiting') +
                '   snoozed in ' + TOPIC + ': ' + len('snoozed'));
    console.log('note: snoozed mail has no Inbox label, so it is already outside `active`;' +
                ' only the part of it still in Inbox/Process can show up in `excluded`.');

    for (const { q, observer } of Object.values(made)) {
        try { q.removeObserverForRange({ start: 0, end: 50 }, observer, 'rangeDidChange'); } catch (e) {}
        try { q.destroy(); } catch (e) {}
    }
    console.log('\ncleaned up ' + Object.keys(made).length + ' queries.');

    const result = {
        counts: Object.fromEntries(Object.keys(specs).map(n => [n, len(n)])),
        pass: ok,
        provedNotClause: doingWork
    };
    window.__actionableResult = result;   // also readable without the console
    return result;
})();
