/*
 * Labels on the selected conversation, and the one invariant that matters:
 * a project label implies the Inbox. Read-only. Paste into the console on
 * app.beta.fastmail.com, or run with:  osascript probe-run.applescript probe-labels.js
 */
(function () {
    try {
        const S = FastMail.store, C = FastMail.classes;
        const ctrl = FastMail.router.getAppController('mail');
        const names = (message) => {
            const boxes = message.get('mailboxes');
            const out = [];
            for (let i = 0; i < (boxes.get('length') || 0); i += 1) {
                out.push(boxes.getObjectAt(i).get('name'));
            }
            return out;
        };
        const keys = ctrl.actions.getSelectedStoreKeys() || [];
        const selected = keys.map(k => S.getRecordFromStoreKey(k))
            .filter(m => m instanceof C.Message);
        const threads = selected.map((message) => {
            const thread = message.get('thread');
            const list = thread ? thread.get('messages').map(x => x) : [message];
            return {
                subject: message.get('subject'),
                messages: list.map(m => ({ from: (m.get('fromName') || ''), labels: names(m) }))
            };
        });

        // Invariant over what is loaded: project label ⇒ Inbox
        const visible = S.getAll(C.Mailbox).filter(m => !m.get('role') && !(Number(m.get('hidden')) & 1))
            .map(m => m.get('name'));
        const settings = (window.customInboxMode && window.customInboxMode.settings()) || {};
        const excluded = String(settings.excludedLabels || 'Later').split(',').map(s => s.trim().toLowerCase());
        const triage = String(settings.triageLabel || 'Triage').toLowerCase();
        const projects = visible.filter(n => excluded.indexOf(n.toLowerCase()) === -1 && n.toLowerCase() !== triage);
        let orphans = 0;
        S.getAll(C.Message).forEach((m) => {
            const labels = names(m);
            if (labels.some(n => projects.indexOf(n) !== -1) && labels.indexOf('Inbox') === -1) orphans += 1;
        });

        return JSON.stringify({ selected: threads, projects, orphansLoaded: orphans }, null, 1);
    } catch (error) {
        return 'ERR ' + error.message;
    }
})()
