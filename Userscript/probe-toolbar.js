/*
 * What every toolbar on screen calls its buttons.
 *
 * Read-only: it reads the registry and the configs and changes nothing.
 * Run it with Userscript/probe-run.applescript, or paste it into the console.
 *
 * The point of it. A ToolbarView draws itself from `_configs[config].left`,
 * an array of *names*, each looked up in `_views`. So a name the registry
 * does not know is a button that cannot be drawn, cannot be found and cannot
 * be put back — and the mode asks for six of them by name. Those names were
 * guessed rather than read, and this is the reading.
 *
 * `actionsConfig` — which the conversation bar uses as its left config — is
 * the account's own list from Settings > Actions, so the vocabulary is the
 * server's rather than the bundle's and cannot be grepped out of the source.
 */
(function probeToolbar() {
    const lines = [];

    const labelOf = (view) => {
        try {
            const text = view.get('label');
            return typeof text === 'string' ? text : '';
        } catch (error) {
            return '';
        }
    };

    const actionOf = (view) => {
        try {
            return String(view.get('action') || '');
        } catch (error) {
            return '';
        }
    };

    const describe = (view) => {
        if (!view) return 'nothing';
        const bits = [(view.constructor && view.constructor.name) || typeof view];
        const label = labelOf(view);
        if (label) bits.push(JSON.stringify(label));
        const action = actionOf(view);
        if (action) bits.push('action=' + action);
        try {
            const shortcut = view.get('shortcut');
            if (shortcut) bits.push('shortcut=' + JSON.stringify(shortcut));
        } catch (error) {
            // not a button
        }
        try {
            const layer = view.get('layer');
            const svg = layer && layer.querySelector('svg');
            if (svg) bits.push('icon=' + svg.getAttribute('class'));
        } catch (error) {
            // not drawn
        }
        return bits.join(' ');
    };

    const bars = Array.from(document.querySelectorAll('.v-Toolbar'))
        .map(node => FastMail.getViewFromNode(node))
        .filter(view => view && view._views);

    lines.push('toolbars on screen: ' + bars.length);

    bars.forEach((bar, index) => {
        lines.push('');
        lines.push('=== toolbar ' + index + ' ===');

        try {
            lines.push('registry names: ' + Object.keys(bar._views).join(', '));
        } catch (error) {
            lines.push('registry names: unreadable');
        }

        try {
            lines.push('config: ' + JSON.stringify(bar.get('config')));
            lines.push('leftConfig: ' + JSON.stringify(bar.get('leftConfig')));
            lines.push('rightConfig: ' + JSON.stringify(bar.get('rightConfig')));
        } catch (error) {
            lines.push('configs: unreadable');
        }

        // Every name the registry knows, and what it hands back for it
        try {
            Object.keys(bar._views).forEach((name) => {
                lines.push('  ' + name + ' -> ' + describe(bar._views[name]));
            });
        } catch (error) {
            lines.push('  (could not walk the registry)');
        }

        // What is actually drawn, in order
        try {
            const children = bar.get('childViews') || [];
            lines.push('drawn: ' + children.length);
            children.forEach((view, at) => {
                lines.push('  [' + at + '] ' + describe(view));
            });
        } catch (error) {
            lines.push('drawn: unreadable');
        }

        // And what waits under More
        try {
            const overflow = bar.getView('overflow');
            const menu = overflow && overflow.get('menuView');
            const options = (menu && menu.get('options')) || [];
            lines.push('in More: ' + options.length);
            options.forEach((view, at) => {
                lines.push('  (' + at + ') ' + describe(view));
            });
        } catch (error) {
            lines.push('in More: unreadable');
        }
    });

    // The names the mode asks for, against what is really there
    const WANTED = ['snooze', 'archive', 'labels', 'editLabels', 'move', 'moveTo',
        'trash', 'delete', 'flag', 'toggleFlagged', 'removeLabel', 'toggleUnread'];

    lines.push('');
    lines.push('=== the names the mode asks for ===');
    WANTED.forEach((name) => {
        const found = bars.filter((bar) => {
            try {
                return !!bar.getView(name);
            } catch (error) {
                return false;
            }
        });
        lines.push('  ' + name + ': ' + (found.length
            ? 'known to ' + found.length + ' bar(s) -> ' + describe(found[0].getView(name))
            : 'KNOWN TO NOBODY'));
    });

    return lines.join('\n');
})();
