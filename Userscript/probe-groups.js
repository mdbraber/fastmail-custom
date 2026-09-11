/*
 * The groupings the mode adds to Fastmail's Group menu: what the settings
 * text parses to, what Labels makes of the current mailbox, and what
 * Fastmail's own parser turns each search into. Read-only. Run with:
 *   osascript -e 'tell application "nexthealth.nl" to do JavaScript (read POSIX file "<abs path>/probe-groups.js" as «class utf8»)'
 */
(function () {
    try {
        const mode = window.customMode;
        if (!mode || !mode.parseGroupings) return 'ERR no customMode.parseGroupings';

        const parsed = mode.parseGroupings(mode.settings().groupings);
        const controller = FastMail.router.getAppController('mail');
        const mailbox = controller.get('mailbox');
        const labels = mode.labelsGrouping(mailbox);

        // What the categories become once Fastmail's own parser has them
        const splits = controller.calculateSplits();

        return JSON.stringify({
            current: mode.currentGroupingId(),
            mailbox: mailbox && mailbox.get('name'),
            parsed: parsed.map(one => ({
                id: one.id,
                name: one.name,
                otherName: one.otherName,
                groups: one.categories.map(c => c.name + ' = ' + c.query)
            })),
            labels: labels && {
                names: labels.categories.map(c => c.name),
                otherName: labels.otherName
            },
            splits: splits && {
                names: splits.categories.map(c => c.name),
                otherName: splits.otherName
            }
        }, null, 1);
    } catch (error) {
        return 'ERR ' + error.message + '\n' + error.stack;
    }
})()
