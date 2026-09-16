/*
 * What is bound to the keys the E/Y swap touches, in the list you are
 * looking at.
 *
 * Read-only: it registers nothing, deregisters nothing and actions nothing.
 * Run it with Userscript/probe-run.applescript, or paste it into the console.
 *
 * Overture's registry answers to whichever handler registered last, so the
 * "wins" line is the one that decides. A ButtonView reports the shortcut
 * string it carries *now*, which is not necessarily the one it registered
 * under: the toolbar's third slot is a single contextual view that reads
 * Archive while the list is the Inbox and Remove from this label anywhere
 * else, and it only ever registers its keys on the way into the document.
 * That gap is why the mode claims e rather than inheriting y.
 *
 * Run it once in the Inbox and once inside a label. In both, e should win
 * for a plain handler; the mode's own claim; rather than for a ButtonView.
 */
(function probeShortcuts() {
    const kb = FastMail.ViewEventsController.kbShortcuts;

    const say = (target, method) => {
        if (!target) return 'null';

        const bits = [(target.constructor && target.constructor.name) || typeof target];
        bits.push('.' + method);

        if (typeof target.get !== 'function') {
            bits.push('(plain handler; the mode’s own)');
            return bits.join(' ');
        }

        try {
            bits.push('shortcut=' + JSON.stringify(String(target.get('shortcut'))));
        } catch (error) {
            bits.push('shortcut=?');
        }

        for (const property of ['label', 'text', 'tooltip']) {
            try {
                const value = target.get(property);
                if (value) {
                    bits.push(property + '=' + JSON.stringify(String(value)));
                    break;
                }
            } catch (error) {
                // Some views compute these and throw while undrawn
            }
        }

        return bits.join(' ');
    };

    const lines = [];

    for (const key of ['e', 'y', 'h', '[', ']']) {
        const list = kb._shortcuts[key] || [];
        lines.push(key + '  (' + list.length + ' registered)');
        list.forEach((entry, index) => lines.push('   ' + index + ': ' + say(entry[0], entry[1])));

        let winner = null;
        try {
            winner = kb.getHandlerForKey(key);
        } catch (error) {
            // No handler at all reads as none rather than as a failure
        }
        lines.push('   => wins: ' + (winner ? say(winner[0], winner[1]) : 'none'));
        lines.push('');
    }

    const mode = window.fastmailCustom;
    const settings = (mode && mode.settings()) || {};
    let mailbox = '(none)';
    try {
        const box = FastMail.router.getAppController('mail').get('mailbox');
        mailbox = box ? box.get('name') : '(none)';
    } catch (error) {
        mailbox = '(no mail controller)';
    }

    lines.push('list=' + mailbox +
        '  mode=' + (mode ? (mode.isOn() ? 'on' : 'off') : 'not running') +
        '  swapArchiveExpand=' + settings.swapArchiveExpand +
        '  excludedLabels=' + JSON.stringify(settings.excludedLabels) +
        '  triageLabel=' + JSON.stringify(settings.triageLabel));

    return lines.join('\n');
})()
