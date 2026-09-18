(function () {
    if (window.__fmshell && window.__fmshell.report) return;

    // Only the mailbox window keeps the offline copy; every other window,
    // a compose window or a message Fastmail popped out, goes without. Every
    // page that joins the shared offline worker makes it sync mail first,
    // holding everyone's requests until it is done, and a popout sat on
    // "Loading…" for four to seven seconds. Fastmail leaves the worker out
    // when IDBTransaction is missing and asks the server directly, as it does
    // with offline mode off; the database itself is untouched, and the
    // mailbox window keeps using it.
    if (window.opener || window.__fmshellComposeWindow) {
        try { delete window.IDBTransaction; } catch (error) {}
    }

    var routeCallbacks = [];
    var lastHref = location.href;

    function post(action, payload) {
        var webkit = window.webkit;
        var handler = webkit && webkit.messageHandlers && webkit.messageHandlers.native;
        if (!handler) {
            console.error('fmshell: bridge unavailable', action, payload);
            return Promise.resolve(null);
        }
        try {
            var result = handler.postMessage({ action: action, payload: payload || {} });
            return result && result.catch ? result.catch(function () { return null; }) : Promise.resolve(result);
        } catch (error) {
            console.error('fmshell: bridge unavailable', action, payload);
            return Promise.resolve(null);
        }
    }

    function report(error) {
        var message = error && error.message ? error.message : String(error);
        var stack = error && error.stack ? error.stack : '';
        post('error', { message: message, stack: stack });
    }

    (function () {
        var native = window.matchMedia.bind(window);
        window.matchMedia = function (query) {
            if (typeof query === 'string' &&
                query.indexOf('display-mode') !== -1 &&
                query.indexOf('standalone') !== -1) {
                return {
                    matches: true,
                    media: query,
                    onchange: null,
                    addListener: function () {},
                    removeListener: function () {},
                    addEventListener: function () {},
                    removeEventListener: function () {},
                    dispatchEvent: function () { return false; }
                };
            }
            return native(query);
        };
    })();

    var lastTheme = null;
    var lastRegions = null;
    var regionsScheduled = false;

    function dragRegions() {
        var header = document.querySelector('.v-PageHeader');
        if (!header) return null;
        var box = header.getBoundingClientRect();
        if (!box.width || !box.height) return null;
        var noDrag = [];
        var nodes = header.querySelectorAll('.v-Button, .v-MainNavToolbar, .v-TextInput');
        for (var i = 0; i < nodes.length; i += 1) {
            var rect = nodes[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                noDrag.push([rect.left, rect.top, rect.width, rect.height]);
            }
        }
        return { drag: [box.left, box.top, box.width, box.height], noDrag: noDrag };
    }

    function reportDragRegions() {
        var regions = dragRegions();
        if (!regions) return;
        var encoded = JSON.stringify(regions);
        if (encoded === lastRegions) return;
        lastRegions = encoded;
        post('dragRegions', regions);
    }

    function scheduleDragRegions() {
        if (regionsScheduled) return;
        regionsScheduled = true;
        window.requestAnimationFrame(function () {
            regionsScheduled = false;
            reportDragRegions();
        });
    }

    function watchDragRegions() {
        scheduleDragRegions();
        var observer = new MutationObserver(scheduleDragRegions);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener('resize', scheduleDragRegions);
    }

    function paintedColor(element) {
        var node = element;
        while (node) {
            var color = window.getComputedStyle(node).backgroundColor;
            if (color && color !== 'transparent' &&
                color.replace(/\s/g, '').indexOf('rgba(0,0,0,0)') !== 0) {
                return color;
            }
            node = node.parentElement;
        }
        return null;
    }

    function headerColor() {
        return paintedColor(document.querySelector('.v-PageHeader')) ||
            paintedColor(document.body);
    }

    // Fastmail's own answer, and the only reliable one: whether a theme is
    // dark is not a question a colour can be asked.
    function pageIsDark() {
        var app = window.FastMail;
        var theme = app && app.theme;
        return theme && typeof theme.isDark === 'boolean' ? theme.isDark : null;
    }

    function reportTheme() {
        var meta = document.querySelector('meta[name="theme-color"]');
        var color = headerColor() || (meta ? meta.getAttribute('content') : null);
        if (!color) return;
        // The answer can change while the colour stays put; the app booting
        // behind an already-painted header; so both make up what is new.
        var isDark = pageIsDark();
        var reported = color + '|' + isDark;
        if (reported === lastTheme) return;
        lastTheme = reported;
        post('theme', isDark === null ? { color: color } : { color: color, isDark: isDark });
    }

    // Fastmail swaps the stylesheet in the head when its theme changes, so the
    // head is worth watching; once there is one.
    function watchHead(observer) {
        var watch = function () {
            if (document.head) {
                observer.observe(document.head, {
                    attributes: true, childList: true, subtree: true
                });
            }
        };
        if (document.head) {
            watch();
            return;
        }
        document.addEventListener('DOMContentLoaded', watch, { once: true });
    }

    function watchTheme() {
        var attempts = 0;
        (function poll() {
            reportTheme();
            attempts += 1;
            // Keep looking until the header is painted and Fastmail has a
            // theme to ask.
            if ((!headerColor() || pageIsDark() === null) && attempts < 40) {
                window.setTimeout(poll, 250);
            }
        })();
        var observer = new MutationObserver(reportTheme);
        // This runs at document-start, where there is no head yet to watch, so
        // the head observer waited on a null and was never installed at all.
        watchHead(observer);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }

    function notifyRoute() {
        if (location.href === lastHref) return;
        lastHref = location.href;
        for (var i = 0; i < routeCallbacks.length; i += 1) {
            try {
                routeCallbacks[i](location.href);
            } catch (error) {
                report(error);
            }
        }
    }

    function installRouteHooks() {
        ['pushState', 'replaceState'].forEach(function (name) {
            var original = history[name];
            history[name] = function () {
                var result = original.apply(this, arguments);
                notifyRoute();
                return result;
            };
        });
        window.addEventListener('popstate', notifyRoute);

        var pending = null;
        var observer = new MutationObserver(function () {
            if (pending) return;
            pending = setTimeout(function () {
                pending = null;
                notifyRoute();
                scheduleBadgePush();
            }, 100);
        });
        function observe() {
            if (document.body) observer.observe(document.body, { childList: true, subtree: true });
        }
        if (document.body) observe();
        else document.addEventListener('DOMContentLoaded', observe);
    }

    // Asking for a message: the C key, and Fastmail's own Compose button,
    // which read the same way.
    var handingOver = false;

    function composeAsk(event) {
        if (event.ctrlKey || event.shiftKey) return null;
        if (event.altKey) return event.metaKey ? 'tab' : 'inline';
        return event.metaKey ? null : 'default';
    }

    function askCompose(asked, handOver) {
        if (asked === 'inline') {
            handOver();
            return;
        }
        post('compose', { mode: asked }).then(function (answer) {
            if (answer === 'inline') handOver();
        });
    }

    function isTyping(element) {
        if (!element) return false;
        if (element.isContentEditable) return true;
        var tag = String(element.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select';
    }

    function handOverC(event) {
        var target = event.target && !isTyping(event.target) ? event.target : document.body;
        if (!target) return;
        handingOver = true;
        try {
            target.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'c',
                code: 'KeyC',
                bubbles: true,
                cancelable: true
            }));
        } finally {
            handingOver = false;
        }
    }

    function composeButton(target) {
        if (!target || typeof target.closest !== 'function') return null;
        return target.closest('.s-new-message');
    }

    function handOverClick(button) {
        handingOver = true;
        try {
            button.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            }));
        } finally {
            handingOver = false;
        }
    }

    function watchComposeKey() {
        document.addEventListener('keydown', function (event) {
            if (handingOver || event.repeat) return;
            if (event.code !== 'KeyC') return;
            if (isTyping(event.target)) return;
            var asked = composeAsk(event);
            if (!asked) return;
            event.preventDefault();
            event.stopPropagation();
            askCompose(asked, function () { handOverC(event); });
        }, true);

        document.addEventListener('click', function (event) {
            if (handingOver || event.button) return;
            var button = composeButton(event.target);
            if (!button) return;
            var asked = composeAsk(event);
            if (!asked) return;
            event.preventDefault();
            event.stopPropagation();
            askCompose(asked, function () { handOverClick(button); });
        }, true);
    }

    /*
     * Carrying on with a draft, where the compose setting says.
     *
     * Fastmail decides this for itself: in the page, in the thread under the
     * message, or a window of its own for a draft row double-clicked or
     * shift-clicked. With the setting on, the app answers instead and the
     * draft opens the way a new message does; with it off the app says
     * "fastmail" and the original runs with the arguments it was given, so
     * nothing changes for anyone who has not asked for this.
     *
     * Two entry points, because Fastmail has two. Every route that opens a
     * draft in a window passes through the mail controller's goNewCompose:
     * the double-click, a draft row clicked with no reading pane beside it,
     * and undoing a discard or a send. The Edit draft button does not always
     * get that far — beside a reading pane it drops the draft into the
     * thread instead — so the thread controller's editDraft is asked in its
     * own right, and hands over with `replaying` set so goNewCompose does
     * not ask the app a second time about the same draft.
     */
    var replaying = false;

    function draftIdOf(options) {
        if (!options || options.mode !== 'draft') return null;
        var message = options.message;
        if (!message || typeof message.get !== 'function') return null;
        var id = message.get('id');
        return typeof id === 'string' && id ? id : null;
    }

    // Handing a draft back to Fastmail. Whatever this runs reaches the other
    // patched call synchronously, and must pass straight through it.
    function replay(run) {
        replaying = true;
        try {
            run();
        } finally {
            replaying = false;
        }
    }

    // Runs `decide` with whether the app wants this draft in the page. A
    // draft the app opened itself never gets there, and neither does one it
    // could not answer for, which is left exactly as Fastmail had it.
    function askEditDraft(id, decide) {
        function answered(answer) {
            if (answer === 'window' || answer === 'tab') return;
            replay(function () { decide(answer === 'inline'); });
        }
        post('editDraft', { id: id }).then(answered, function () { answered(null); });
    }

    // A window of its own, a compose window among them, opens the draft it
    // was made for through the same calls, and asking the app then would
    // find that very window and leave it empty. Only the mailbox asks.
    // A compose window from the pool is known by the script it was given;
    // any other by its minimal chrome or its address.
    function isWindowOfItsOwn() {
        return typeof window.fmshellLeavePool === 'function'
            || /(^|[?&])ui=minimal(&|$)/.test(location.search.slice(1))
            || /^\/mail\/compose(\/|$)/.test(location.pathname);
    }

    function patchThreadEditDraft(controller) {
        var threads = typeof controller.get === 'function' ? controller.get('threadController') : null;
        var prototype = threads ? Object.getPrototypeOf(threads) : null;
        if (!prototype || typeof prototype.editDraft !== 'function') return false;
        if (prototype.__fmshellEditDraft) return true;
        var editDraft = prototype.editDraft;
        prototype.editDraft = function (message, inNewWindow) {
            var id = replaying ? null : draftIdOf({ mode: 'draft', message: message });
            if (!id) return editDraft.apply(this, arguments);
            var self = this;
            var args = arguments;
            askEditDraft(id, function (inline) {
                if (inline) editDraft.call(self, message, false);
                else editDraft.apply(self, args);
            });
            return this;
        };
        prototype.__fmshellEditDraft = true;
        return true;
    }

    function patchEditDraft() {
        var controller = mailController();
        if (!controller || typeof controller.goNewCompose !== 'function') return false;
        if (isWindowOfItsOwn()) return true;
        if (controller.__fmshellEditDraft) return true;

        var goNewCompose = controller.goNewCompose;
        controller.goNewCompose = function (options) {
            var id = replaying ? null : draftIdOf(options);
            if (!id) return goNewCompose.apply(this, arguments);
            var self = this;
            var args = arguments;
            askEditDraft(id, function (inline) {
                if (!inline) {
                    goNewCompose.apply(self, args);
                    return;
                }
                // Fastmail's own compose in the page, which is what it does
                // with a draft it was not asked to put in a window.
                var inPage = {};
                Object.keys(options).forEach(function (key) { inPage[key] = options[key]; });
                inPage.inNewWindow = false;
                goNewCompose.call(self, inPage);
            });
            return this;
        };

        // The thread controller is only made when a message first opens,
        // which is after boot more often than not, and always on a route
        // change; so it is looked for again on each one until it is found.
        if (!patchThreadEditDraft(controller)) {
            routeCallbacks.push(function () { patchThreadEditDraft(controller); });
        }

        controller.__fmshellEditDraft = true;
        return true;
    }

    // Fastmail builds the mail controller a moment after the page starts,
    // and the thread controller with it.
    function watchEditDraft() {
        var attempts = 0;
        (function poll() {
            if (patchEditDraft() || attempts >= 120) return;
            attempts += 1;
            window.setTimeout(poll, 250);
        })();
    }

    // Fastmail's own toast host: the container view built with the root
    // view at boot and inserted right after it, on desktop and on the phone
    // alike, so its drawn node is always there to ask for the instance —
    // the same node and the same show() Fastmail Custom's own toasts use, so a
    // message from this app reads like one of the page's own rather than
    // drawing anything of its own.
    function toastHost() {
        var node = document.querySelector('.v-NotificationContainer');
        var view = node && window.FastMail && FastMail.getViewFromNode(node);
        return view && typeof view.show === 'function' ? view : null;
    }
    function toast(message, duration) {
        try {
            var host = toastHost();
            if (host) host.show(String(message), duration || 4000, true);
        } catch (error) {
            // Nothing native left to fall back to from here.
        }
    }

    window.__fmshell = {
        onRoute: function (callback) {
            routeCallbacks.push(callback);
        },
        report: report,
        toast: toast
    };

    function collapse(text) {
        return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    }

    function mailController() {
        var fm = window.FastMail;
        if (!fm || !fm.router || typeof fm.router.getAppController !== 'function') return null;
        try {
            return fm.router.getAppController('mail');
        } catch (error) {
            return null;
        }
    }

    function stateSubject() {
        var controller = mailController();
        if (!controller || typeof controller.get !== 'function') return null;
        var message = null;
        try {
            message = controller.get('message');
        } catch (error) {
            return null;
        }
        if (!message) return null;
        var subject = controller.get('subject');
        if (!subject && typeof message.get === 'function') subject = message.get('subject');
        return collapse(subject) || null;
    }

    function stateURL() {
        var controller = mailController();
        if (!controller || typeof controller.getUrlForMessage !== 'function') return null;
        try {
            var message = controller.get('message');
            if (!message) return null;
            var url = controller.getUrlForMessage(message);
            return url ? String(new URL(url, location.href)) : null;
        } catch (error) {
            return null;
        }
    }

    function domSubject() {
        var node = document.querySelector('.v-Thread-title h1') ||
            document.querySelector('.v-MailboxItem.is-focused .v-MailboxItem-subject');
        return node ? (collapse(node.textContent) || null) : null;
    }

    var menuItems = [];
    var menuPatchInstalled = false;

    function iconNode(svg) {
        try {
            var parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
            parsed.setAttribute('role', 'presentation');
            return parsed;
        } catch (error) {
            return undefined;
        }
    }

    function isMessageActionsMenu(options) {
        var reply = false;
        var forward = false;
        for (var i = 0; i < options.length; i += 1) {
            var option = options[i];
            if (!option || typeof option.get !== 'function') continue;
            var action = option.get('action');
            if (action === 'reply') reply = true;
            if (action === 'forward') forward = true;
        }
        return reply && forward;
    }

    function optionProbe(option) {
        if (!option || typeof option.get !== 'function') return '';
        var probe = '';
        try {
            probe = String(option.get('action') || '') + ' ' +
                String(option.get('url') || '') + ' ' +
                String(option.get('href') || '') + ' ' +
                String(option.get('method') || '') + ' ' +
                String(option.get('label') || '');
        } catch (error) {
            return '';
        }
        return probe;
    }

    function logoutIndex(options) {
        return findOptionIndex(options, /log\s*-?\s*out|logout|sign\s*-?\s*out/i);
    }

    function findOptionIndex(options, pattern) {
        for (var i = 0; i < options.length; i += 1) {
            if (pattern.test(optionProbe(options[i]))) return i;
        }
        return -1;
    }

    function menuKindOf(options) {
        if (isMessageActionsMenu(options)) return 'message';
        if (logoutIndex(options) !== -1) return 'profile';
        return null;
    }

    // When neither fingerprint matches, say what the menu was made of, once
    // per shape; so a missed menu can be identified from the log instead of
    // guessed at.
    var loggedMenuShapes = {};

    function logMenuShape(options) {
        var parts = [];
        for (var i = 0; i < options.length && i < 12; i += 1) {
            var probe = collapse(optionProbe(options[i]));
            parts.push(probe ? probe.slice(0, 48) : '-');
        }
        var shape = parts.join(' | ');
        if (!shape || loggedMenuShapes[shape]) return;
        loggedMenuShapes[shape] = true;
        post('log', { message: 'menu shape: ' + shape });
    }

    function menuItemButton(item) {
        var ButtonView = window.FastMail.classes.ButtonView;
        var button = new ButtonView({
            label: item.label,
            icon: item.icon ? iconNode(item.icon) : undefined,
            method: 'chooseItem',
            chooseItem: function () {
                var layer = null;
                try {
                    layer = this.get('layer');
                } catch (error) {}
                var rect = layer && layer.getBoundingClientRect
                    ? layer.getBoundingClientRect() : null;
                try {
                    item.onSelect({ rect: rect });
                } catch (error) {
                    report(error);
                }
            }
        });
        button.__fmshellItem = item.id;
        return button;
    }

    // The line under a section's last option is drawn from a flag on the
    // option itself, the same one Fastmail's own groups carry (found on
    // their rendered options as the class v-MenuOption--lastOfSection) —
    // not from a gap in the array, which draws nothing at all.
    function markLastOfSection(button) {
        try {
            button.set('isLastOfSection', true);
        } catch (error) {}
        return button;
    }

    function injectMenuItems(menu) {
        var options = menu && typeof menu.get === 'function' && menu.get('options');
        if (!options || typeof options.unshift !== 'function') return;
        var kind = menuKindOf(options);
        if (!kind) {
            logMenuShape(options);
            return;
        }

        if (!menuItems.length) return;
        if (options.some(function (option) { return option && option.__fmshellItem; })) return;

        var wanted = menuItems.filter(function (item) { return item.menu === kind; });
        if (!wanted.length) return;

        if (kind === 'message') {
            // Everything this app adds to this menu sits together at the
            // very bottom, below all of Fastmail's own entries and marked off
            // from them, Share first as it always was.
            var last = options[options.length - 1];
            if (last) markLastOfSection(last);
            options.push.apply(options, wanted.map(menuItemButton));
            return;
        }

        var added = wanted.map(menuItemButton);
        var at = logoutIndex(options);
        var splice = [at < 0 ? options.length : at, 0].concat(added);
        options.splice.apply(options, splice);
    }

    function installMenuInjection() {
        if (menuPatchInstalled) return true;
        var fm = window.FastMail;
        var MenuView = fm && fm.classes && fm.classes.MenuView;
        var ButtonView = fm && fm.classes && fm.classes.ButtonView;
        if (!MenuView || !ButtonView || !MenuView.prototype ||
            typeof MenuView.prototype.draw !== 'function') return false;

        var original = MenuView.prototype.draw;
        MenuView.prototype.draw = function () {
            try {
                injectMenuItems(this);
            } catch (error) {
                report(error);
            }
            return original.apply(this, arguments);
        };
        menuPatchInstalled = true;
        return true;
    }

    function watchMenus() {
        var attempts = 0;
        (function poll() {
            if (installMenuInjection() || attempts >= 120) return;
            attempts += 1;
            window.setTimeout(poll, 250);
        })();
    }

    // The shell's own settings live in Fastmail's Settings screen, as a Device
    // settings row right after Custom options, or between Custom swipes and
    // Offline while Custom options has no row.
    function dressSettingsList() {
        // On the Mac the shell's own settings open from the app menu and ⌘, so
        // the Settings screen needs no row for them; the row belongs only
        // where there is no native way in, the phone and iPad.
        if (/Electron\//.test(navigator.userAgent)) return;
        var lists = document.querySelectorAll('ul.v-Sources-list');
        var list, swipes, offline, fastmailCustom;
        for (var i = 0; i < lists.length && !list; i += 1) {
            var foundSwipes = null;
            var foundOffline = null;
            var foundFastmailCustom = null;
            [].forEach.call(lists[i].children, function (li) {
                var link = li.querySelector('a.app-source');
                if (!link) return;
                var text = collapse(link.textContent).toLowerCase();
                if (text === 'custom swipes') foundSwipes = li;
                if (text === 'offline') foundOffline = li;
                if (text === 'custom options') foundFastmailCustom = li;
            });
            if (foundSwipes && foundOffline) {
                list = lists[i];
                swipes = foundSwipes;
                offline = foundOffline;
                fastmailCustom = foundFastmailCustom;
            }
        }
        if (!list) return;
        // Fastmail sizes the list with an inline pixel height for its collapse
        // animation (row count times a fixed row height); an extra row
        // overflows it and the next section's header laps the last row.
        var existing = list.querySelector('.fmshell-device-settings');
        if (existing) {
            // Custom options' entry is drawn once its page installs, which can
            // be after this row went in, and Fastmail's list may then put it
            // below this row; the row goes back under it.
            var row = existing.closest('li') || existing;
            if (fastmailCustom && row.previousElementSibling !== fastmailCustom) {
                list.insertBefore(row, fastmailCustom.nextSibling);
            }
            fixListHeight(list, swipes);
            return;
        }

        // Cloned from Custom swipes so the row matches, then made the shell's:
        // a fresh icon, a new label, no id to collide, and a click that opens
        // the Device settings page instead of routing to a Fastmail settings pane.
        var clone = swipes.cloneNode(true);
        clone.removeAttribute('id');
        var link = clone.querySelector('a') || clone;
        link.classList.remove('is-selected');
        link.classList.add('fmshell-device-settings');
        link.setAttribute('href', '#');
        link.removeAttribute('title');

        var oldIcon = link.querySelector('svg');
        var icon = iconNode(SETTINGS_ICON);
        if (oldIcon && icon) {
            oldIcon.parentNode.replaceChild(icon, oldIcon);
        }

        var label = link.querySelector('span');
        if (label) {
            label.textContent = 'Device settings';
        } else {
            link.appendChild(document.createTextNode('Device settings'));
        }

        link.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            post('openSettings', {});
        });

        list.insertBefore(clone, offline);
        fixListHeight(list, swipes);
    }

    // Grow the list's inline height to fit the added row.
    function fixListHeight(list, sample) {
        if (!/px\s*$/.test(list.style.height)) return;
        var rowHeight = sample ? sample.offsetHeight : 0;
        if (rowHeight > 0) {
            list.style.height = (list.children.length * rowHeight) + 'px';
        }
    }

    // The Settings screen is a page, not a popup, and Fastmail redraws its
    // sidebar as sections change, so the row is re-added whenever the DOM
    // settles rather than on a single click.
    function watchSettingsList() {
        var scheduled = false;
        function run() { scheduled = false; dressSettingsList(); }
        function schedule() {
            if (scheduled) return;
            scheduled = true;
            window.setTimeout(run, 100);
        }
        new MutationObserver(schedule).observe(document.documentElement, {
            childList: true, subtree: true
        });
        schedule();
    }

    // Fastmail's own icons in this menu (Reply, Forward, …) leave visible
    // padding inside their 24x24 box; these two, drawn on the same grid a
    // generic icon set uses, do not, and so read as noticeably bigger and
    // heavier even at the same stroke width. The group scales each down
    // around the box's centre to match, rather than redrawing the paths by
    // hand.
    var SHARE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"' +
        ' fill="none" stroke="currentColor" stroke-linecap="round"' +
        ' stroke-linejoin="round" class="u-standardicon v-Icon">' +
        '<g transform="translate(12 12) scale(0.7) translate(-12 -12)">' +
        '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/>' +
        '<polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></g></svg>';

    // No icon of their own, but still one of Fastmail's blank ones: an
    // option that draws nothing where an icon would go still gets the
    // room one takes, the way an unselected grouping option's does, so the
    // label lines up with the options around it that do have one.
    var BLANK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"' +
        ' class="u-standardicon v-Icon i-blank"></svg>';

    window.native = window.native || {};
    window.native.log = function () {
        var parts = Array.prototype.slice.call(arguments).map(String);
        post('log', { message: parts.join(' ') });
    };
    window.native.onRoute = function (callback) {
        window.__fmshell.onRoute(callback);
    };
    window.native.share = function (options) {
        options = options || {};
        var payload = { url: options.url || null, text: options.text || null };
        var rect = options.rect;
        if (rect) {
            payload.rect = {
                x: rect.x !== undefined ? rect.x : rect.left,
                y: rect.y !== undefined ? rect.y : rect.top,
                width: rect.width,
                height: rect.height
            };
        }
        return post('share', payload);
    };
    window.native.subjectResolver = null;
    window.native.currentLink = function () {
        return new Promise(function (resolve, reject) {
            var title = null;
            var resolver = window.native.subjectResolver;
            if (typeof resolver === 'function') {
                try {
                    title = collapse(resolver()) || null;
                } catch (error) {
                    report(error);
                }
            }
            if (!title) title = stateSubject();
            if (!title) title = domSubject();
            if (!title) {
                reject(new Error('No message open'));
                return;
            }
            var url = stateURL() || location.href;
            resolve({
                url: url,
                title: title,
                markdown: '[' + title.replace(/([\[\]\\])/g, '\\$1') + '](' + url + ')'
            });
        });
    };

    var lastBadge = null;
    var badgePushTimer = null;
    var lastPushedSubject = null;

    function pushSubject() {
        var subject = null;
        try {
            subject = stateSubject() || domSubject() || null;
        } catch (error) {
            subject = null;
        }
        if (subject === lastPushedSubject) return;
        lastPushedSubject = subject;
        post('subject', { title: subject });
    }

    function badgeFromScript() {
        var api = window.fastmailCustom;
        var fm = window.FastMail;
        if (!api || typeof api.countFor !== 'function') return null;
        if (!fm || !fm.store || !fm.classes || !fm.classes.Mailbox) return null;
        try {
            var inboxes = fm.store.getAll(fm.classes.Mailbox).filter(function (mailbox) {
                return mailbox.get('role') === 'inbox';
            });
            if (!inboxes.length) return null;
            var total = 0;
            inboxes.forEach(function (inbox) {
                total += api.countFor(inbox) || 0;
            });
            return total;
        } catch (error) {
            return null;
        }
    }

    function badgeFromSidebar() {
        var rows = document.querySelectorAll('.v-MailboxSource--inbox');
        if (!rows.length) return null;
        var total = 0;
        for (var i = 0; i < rows.length; i += 1) {
            var badge = rows[i].querySelector('.v-MailboxSource-badge');
            var count = badge ? parseInt(badge.textContent, 10) : 0;
            if (!isNaN(count)) total += count;
        }
        return total;
    }

    function badgeCount() {
        var resolver = window.native.badgeResolver;
        if (typeof resolver === 'function') {
            try {
                var resolved = resolver();
                return typeof resolved === 'number' && isFinite(resolved) ? resolved : null;
            } catch (error) {
                report(error);
                return null;
            }
        }
        // With no resolver the desktop reads its sidebar; the phone has none,
        // and its inbox-total reading would be the wrong number (the whole
        // Inbox, not what is left to triage), so it waits for the resolver
        // rather than guessing from a layout it does not have.
        if (window.FastMail && window.FastMail.isMobile) return null;
        var fromScript = badgeFromScript();
        return fromScript !== null ? fromScript : badgeFromSidebar();
    }

    function scheduleBadgePush() {
        if (badgePushTimer) return;
        badgePushTimer = setTimeout(function () {
            badgePushTimer = null;
            pushSubject();
            var count = badgeCount();
            if (count === null || count === lastBadge) return;
            lastBadge = count;
            post('badge', { count: count });
        }, 500);
    }

    window.native.addMenuItem = function (item) {
        if (!item || typeof item.id !== 'string' || !item.id ||
            typeof item.label !== 'string' || !item.label ||
            typeof item.onSelect !== 'function') {
            throw new TypeError('addMenuItem needs { id, label, onSelect }');
        }
        if (menuItems.some(function (existing) { return existing.id === item.id; })) return;
        menuItems.push({
            id: item.id,
            label: item.label,
            icon: typeof item.icon === 'string' ? item.icon : null,
            menu: item.menu === 'profile' ? 'profile' : 'message',
            // Items sharing a group sit together behind one separator;
            // an item with no group of its own is its own group of one.
            group: typeof item.group === 'string' ? item.group : item.id,
            onSelect: item.onSelect
        });
        installMenuInjection();
    };

    var registeredActions = {};

    window.native.registerAction = function (name, fn) {
        if (typeof name !== 'string' || !name || typeof fn !== 'function') {
            throw new TypeError('registerAction needs (name, fn)');
        }
        registeredActions[name] = fn;
        post('actions', { names: Object.keys(registeredActions) });
    };
    window.native.runAction = function (name) {
        var fn = registeredActions[name];
        if (!fn) return Promise.reject(new Error('No action named ' + name));
        try {
            return Promise.resolve(fn());
        } catch (error) {
            return Promise.reject(error);
        }
    };

    window.native.badgeResolver = null;
    window.native.setBadge = function (count) {
        if (typeof count !== 'number' || !isFinite(count)) return Promise.resolve(null);
        lastBadge = count;
        return post('badge', { count: count });
    };
    window.native.badgeCount = function () {
        return Promise.resolve(badgeCount());
    };

    // A Fastmail Custom setting the settings page has changed. The key is bare:
    // the shell owns the namespace it is stored under, so the page cannot
    // name anything outside it.
    window.native.setSetting = function (key, value) {
        return post('setting', { key: key, value: value });
    };

    // Which Fastmail account the page is on, so the app keeps synced
    // settings with their own account. The app checks the id.
    window.native.account = function (accountId) {
        return post('account', { accountId: accountId });
    };

    // The settings page's "Sync settings with iCloud" switch. The app takes
    // a real boolean only.
    window.native.setSettingsSync = function (enabled) {
        return post('settingsSync', { enabled: enabled });
    };

    // The Notifications page's way to the app, on the phone and the iPad. The
    // Mac keeps Fastmail's own page, so under the Electron user agent there
    // is none, and the userscript leaves Fastmail's page alone there.
    //
    // The app answers state() and set() as JSON text, since a reply's value
    // is a string; they resolve to the object, and reject when there is no
    // answer to read, which is how post() hands on a refusal.
    function notificationReply(text) {
        if (typeof text !== 'string') throw new Error('The app did not answer');
        return JSON.parse(text);
    }

    if (!/Electron\//.test(navigator.userAgent)) {
        window.native.notifications = {
            state: function () {
                return post('notificationState', {}).then(notificationReply);
            },
            set: function (choice) {
                choice = choice || {};
                var payload = { mode: choice.mode };
                if (choice.senders !== undefined) payload.senders = choice.senders;
                if (choice.mailboxIds !== undefined) payload.mailboxIds = choice.mailboxIds;
                if (choice.excludedMailboxIds !== undefined) payload.excludedMailboxIds = choice.excludedMailboxIds;
                if (choice.previews !== undefined) payload.previews = choice.previews;
                return post('setNotifications', payload).then(notificationReply);
            },
            openSettings: function () {
                return post('openNotificationSettings', {});
            }
        };
    }

    /*
     * Open Fastmail's search, for the home screen shortcut.
     *
     * There is no address for it: /mail/search:<query> opens results, and an
     * empty one bounces to the Inbox; measured. So it is opened the way a
     * person opens it, and which control that is depends on the layout.
     *
     * The phone keeps a search button in the page header and draws no search
     * field until it is pressed. A wider window has the field itself, in the
     * sidebar, and Fastmail binds "/" to it; so the shortcut's own target is
     * asked last, since a field that is not in the document has not
     * registered one.
     */
    function openSearch() {
        var headers = document.querySelectorAll('.v-PageHeader');
        for (var i = 0; i < headers.length; i += 1) {
            var icon = headers[i].querySelector('svg.i-search');
            var button = icon && icon.closest('button');
            if (button) {
                button.click();
                return true;
            }
        }

        var field = document.querySelector('.v-SearchInput input, input[type="search"]');
        if (field) {
            field.focus();
            if (typeof field.select === 'function') field.select();
            return true;
        }

        try {
            var bound = window.FastMail.ViewEventsController.kbShortcuts._shortcuts['/'];
            var entry = bound && bound[bound.length - 1];
            var target = entry && entry[0];
            var method = entry && entry[1];
            if (target && typeof target[method] === 'function') {
                target[method]();
                return true;
            }
        } catch (error) {
            // Fastmail has moved it; nothing left to try
        }

        return false;
    }

    window.native.registerAction('search', function () {
        if (!openSearch()) throw new Error('No search control on this page');
    });

    window.native.addMenuItem({
        id: 'share',
        label: 'Share',
        group: 'share',
        icon: SHARE_ICON,
        onSelect: function (context) {
            window.native.currentLink().then(function (link) {
                return window.native.share({
                    url: link.url,
                    text: link.title,
                    rect: context && context.rect
                });
            }).catch(function () {});
        }
    });

    // A menu's own way to the clipboard, confirmed the way an archive
    // confirms: with the page's own toast, not this app's.
    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        var area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.focus();
        area.select();
        try {
            document.execCommand('copy');
        } finally {
            document.body.removeChild(area);
        }
        return Promise.resolve();
    }

    [
        { id: 'copyMarkdownLink', label: 'Copy Markdown Link', part: 'markdown', done: 'Copied Markdown link' },
        { id: 'copyURL', label: 'Copy URL', part: 'url', done: 'Copied URL' },
        { id: 'copyTitle', label: 'Copy Title', part: 'title', done: 'Copied title' }
    ].forEach(function (spec) {
        window.native.addMenuItem({
            id: spec.id,
            label: spec.label,
            group: 'copy',
            icon: BLANK_ICON,
            onSelect: function () {
                window.native.currentLink().then(function (link) {
                    return copyText(link[spec.part]).then(function () { toast(spec.done); });
                }).catch(function () { toast('No message open'); });
            }
        });
    });

    // Fastmail's desktop-app hook. Its offline worker decides which new mail
    // notifies, from the page's own live connection, so no push is needed, and
    // broadcasts it; its service worker formats it and, when it believes it is
    // inside Fastmail's Electron app, hands it to the page, which calls
    // window.electron.showNotification.
    if (/Electron\//.test(navigator.userAgent) && typeof window.electron !== 'object') {
        var pendingNotifications = [];
        var notificationCount = 0;
        // Message ids already handed over from this page, by either route
        var notifiedEmailIds = {};

        // A sound, if wanted, is asked for right after the notification and
        // synchronously, so the send waits a tick and the two travel as one.
        // The sound has been settled by now, so a notification can wait here
        // for the start of its message's text without losing it.
        var flushNotifications = function () {
            var queued = pendingNotifications;
            pendingNotifications = [];
            queued.forEach(function (notification) {
                previewed(notification).then(function (shown) { post('notify', shown); });
            });
        };

        var queueNotification = function (notification) {
            pendingNotifications.push(notification);
            if (pendingNotifications.length === 1) setTimeout(flushNotifications, 0);
        };

        // How long a notification waits for its preview before it goes
        // without one
        var PREVIEW_WAIT = 1500;

        // The start of a message's text, as Fastmail's own preview has it, on
        // one line; empty when there is none or it could not be had in time.
        var previewOf = function (push) {
            var email = emailOf(push);
            if (!email) return Promise.resolve('');
            var oneLine = function (text) {
                return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
            };
            if (typeof email.preview === 'string') return Promise.resolve(oneLine(email.preview));
            var fastmail = window.FastMail;
            if (!push.accountId || !fastmail || typeof fastmail.callJMAPMethod !== 'function') {
                return Promise.resolve('');
            }
            var asked = Promise.resolve().then(function () {
                return fastmail.callJMAPMethod('Email/get', {
                    accountId: push.accountId, ids: [String(email.id)], properties: ['preview']
                });
            }).then(function (answer) {
                var found = answer && answer.list && answer.list[0];
                return oneLine(found && found.preview);
            }, function () { return ''; });
            var late = new Promise(function (resolve) { setTimeout(function () { resolve(''); }, PREVIEW_WAIT); });
            return Promise.race([asked, late]);
        };

        // The start of the text, and the subject to go above it, handed over
        // beside the words Fastmail wrote; the app lays the banner out the
        // way Mail does when its previews setting is on, and uses Fastmail's
        // words when it is off or there is no text.
        var previewed = function (notification) {
            var push;
            try {
                push = JSON.parse(notification.data || '{}');
            } catch (error) {
                return Promise.resolve(notification);
            }
            var email = emailOf(push);
            if (!email) return Promise.resolve(notification);
            return previewOf(push).then(function (preview) {
                if (!preview) return notification;
                var shown = {};
                Object.keys(notification).forEach(function (key) { shown[key] = notification[key]; });
                shown.subject = String(email.subject || '').trim();
                shown.preview = preview;
                return shown;
            });
        };

        // Fastmail hands its push over as the notification's data, with the
        // message under email; a calendar alert carries its event instead.
        var emailOf = function (data) {
            return data && data.email && data.email.id ? data.email : null;
        };

        // The message id for mail, so a read message's notification can be
        // dismissed by it; for anything else an id of its own, since two
        // alerts for one event are two notifications.
        var notificationIdOf = function (data) {
            var email = emailOf(data);
            if (email) return String(email.id);
            if (data.emailId) return String(data.emailId);
            notificationCount += 1;
            return (data.calendarEventId ? data.calendarEventId + '/' : 'n') +
                (data.alertId || Date.now() + '-' + notificationCount);
        };

        // Once per message from this page. Across windows, and for one that
        // comes in late, NotificationPresenter keeps it to once as well.
        var claimEmail = function (data) {
            var email = emailOf(data);
            if (!email) return true;
            if (notifiedEmailIds[email.id]) return false;
            notifiedEmailIds[email.id] = true;
            return true;
        };

        var jsonOf = function (data) {
            try {
                return JSON.stringify(data);
            } catch (error) {
                return '';
            }
        };

        // The address a click should open: exactly what sw-desktop.js's own
        // notificationclick handler (`he`) falls back to when it finds no
        // open window to hand the click to instead - host + /mail/Inbox/<id>,
        // no thread segment, since the router resolves that once the message
        // loads. Built here rather than left to the service worker, since
        // nothing guarantees WKWebView's Clients API finds this window the
        // way a real browser tab would.
        var messageUrlFor = function (data) {
            var email = data && data['@type'] === 'EmailPush' && data.email;
            if (!email || !email.id || !data.userId) return '';
            return location.origin + '/mail/Inbox/' + encodeURIComponent(String(email.id)) +
                '?u=' + encodeURIComponent(String(data.userId));
        };

        // Fastmail's service worker hands its icon over already read into a
        // data: URL: the sender's BIMI logo, contact photo, Gravatar or the
        // logo for their domain. Only that form is passed on, and only while
        // small; the app shows it beside the notification's text.
        var imageOf = function (icon) {
            return typeof icon === 'string' && /^data:image\//i.test(icon) && icon.length < 2800000 ? icon : '';
        };

        window.electron = {
            showNotification: function (payload, data) {
                payload = payload || {};
                data = data || {};
                if (!claimEmail(data)) return;
                var email = emailOf(data);
                queueNotification({
                    id: notificationIdOf(data),
                    title: String(payload.title || ''),
                    body: String(payload.body || ''),
                    sound: false,
                    threadId: String((email && email.threadId) || data.threadId || ''),
                    icon: imageOf(payload.icon),
                    url: messageUrlFor(data),
                    data: jsonOf(data)
                });
            },
            playNotificationSound: function () {
                if (pendingNotifications.length) {
                    pendingNotifications[pendingNotifications.length - 1].sound = true;
                }
            },
            // Read, archived or deleted: Fastmail says which notifications are
            // stale.
            updateNotifications: function (options) {
                var ids = (options && options.dismissEmailIds) || [];
                if (ids.length) post('dismissNotifications', { ids: ids.map(String) });
            },
            showWindow: function () {
                post('showWindow', {});
            },
            setTitleBarOverlay: function () {},
            featuresSupported: {},
            checkForUpdate: function () { return Promise.resolve(); },
            // Mail preferences asks before it draws whether this is the
            // default email app, and its switch asks to become it. Which app
            // opens mailto links is left to macOS, so the answer is always no
            // and the switch does nothing; a missing method threw instead and
            // the page never drew. The answer has to be a promise, as
            // Fastmail's own app gives it: the page waits on it together with
            // its preferences, and a bare false reaches the switch as on.
            getIsDefaultApp: function () { return Promise.resolve(false); },
            setIsDefaultApp: function () {},
            // Fastmail's desktop module builds the app's File and View menus
            // itself and hands them over whole, again whenever they change;
            // a click comes back as the item's action.
            setMenu: function (menu) {
                post('setMenu', { menu: menuOf(menu) });
            },
            onMenuActivate: function (callback) {
                menuActivate = typeof callback === 'function' ? callback : null;
            },
            // Its desktop module wraps window.print around this, since WebKit
            // does nothing with a page's own print(); the app prints the view.
            print: function () {
                return post('print', {});
            },
            // Offered in File only while this exists
            printToPDF: function () {
                return post('printToPDF', {});
            },
            // Handled by the app before the page ever hears of them: mailto
            // links arrive through the app, and it has no updater or links of
            // its own scheme.
            onMailto: function () {},
            onDeeplink: function () {},
            onUpdateCheck: function () {},
            onUpdateAvailable: function () {},
            onUpdateNotAvailable: function () {},
            onUpdateDownloaded: function () {},
            onUpdateError: function () {},
            restartAndUpdate: function () {}
        };

        // Fastmail's desktop app brings another of its windows forward, the
        // one a draft is being written in say, with open(<its address>, <its
        // name>, "popup=true"), and Electron finds the window of that name.
        // WebKit looks only among windows this page opened, which a compose
        // window never is, and opened yet another; the app finds it instead,
        // and only when it has none is a window opened after all.
        var openWindow = window.open;
        window.open = function (url, name, features) {
            if (features !== 'popup=true' || typeof name !== 'string' || !name ||
                name.charAt(0) === '_' || name === window.name) {
                return openWindow.apply(window, arguments);
            }
            post('focusWindow', { name: name }).then(function (found) {
                if (found !== 'true') openWindow.call(window, url, name, features);
            });
            return null;
        };

        // Fastmail closes a compose window of its own accord, once its draft
        // is discarded, closed or deleted elsewhere, with window.close(),
        // which WebKit ignores for a window no script opened.
        if (window.__fmshellComposeWindow) {
            window.close = function () {
                post('closeWindow', {});
            };
        }

        var menuActivate = null;
        window.native.menuActivate = function (action) {
            if (!menuActivate || typeof action !== 'string') return false;
            menuActivate(action);
            return true;
        };

        // Only what a menu item is made of crosses over
        var MENU_KEYS = ['label', 'type', 'role', 'action', 'accelerator', 'enabled', 'checked'];
        var menuItemsOf = function (items) {
            return (Array.isArray(items) ? items : []).filter(Boolean).map(function (item) {
                var copy = {};
                MENU_KEYS.forEach(function (key) {
                    var value = item[key];
                    if (typeof value === 'string' || typeof value === 'boolean') copy[key] = value;
                });
                return copy;
            });
        };
        var menuOf = function (menu) {
            var copy = {};
            Object.keys(menu || {}).forEach(function (name) {
                if (Array.isArray(menu[name])) copy[name] = menuItemsOf(menu[name]);
            });
            return copy;
        };

        /*
         * The new-mail notification Fastmail's service worker never shows.
         *
         * Before showing one it looks up the sender's contact photo, and for
         * a contact that has one it builds the photo's address from the
         * photo's type, which Fastmail's stored contacts call mediaType; the
         * lookup throws and the notification is dropped without a word. So
         * the same broadcast the service worker answers is heard here too,
         * and this page shows the message itself, formatted the way the
         * service worker formats it and with the sound Fastmail's page would
         * add: straight away when the sender has a contact photo, since that
         * is what the service worker fails on, and otherwise only if its
         * notification has not come through within FALLBACK_DELAY. Whichever
         * comes first is the one shown; the other is not shown again.
         *
         * Only the message Fastmail's offline worker has already decided
         * should notify is broadcast, so Fastmail's notification setting
         * still decides what notifies.
         */
        var FALLBACK_DELAY = 2000;
        var pageUserId = (/[?&]u=(\w+)/.exec(location.search) || [])[1] || '';

        // The sender as the service worker sees them: a name dressed up as an
        // address or as Fastmail, on a message that is not trusted, is not
        // believed. Fastmail's own test also catches lookalike characters;
        // this one catches the plain spellings.
        var senderOf = function (push) {
            var email = push.email;
            var from = (email.from && email.from[0]) || {};
            var address = String(from.email || '');
            var name = String(from.name || '').trim().replace(/\s+/g, ' ') || address;
            var keywords = email.keywords || {};
            var dressedUp = name !== address && !keywords.$istrusted &&
                (/[@\uFF20\uFE6B]/.test(name) || /f\W*a\W*s\W*t\W*m\W*a\W*i\W*l/i.test(name));
            return { address: address, name: dressedUp ? address : name, dressedUp: dressedUp };
        };

        // The service worker's title: the sender's name, or the address for a
        // name that is not believed; a clock ahead of it for snoozed mail
        // coming back
        var fallbackTitle = function (push) {
            return (push.isAwakened ? '\uD83D\uDD52 ' : '') + (senderOf(push).name || 'New message');
        };

        // What Fastmail's page reads before asking for a sound
        var mailSoundWanted = function (userId) {
            try {
                return !!JSON.parse(localStorage.getItem('preferences:' + userId + '.notificationsMailSound'));
            } catch (error) {
                return false;
            }
        };

        /*
         * The contact photo the service worker failed to read, looked up the
         * way it looks: a contact card holding the sender's address and a
         * photo, the default address book's account first, downloaded at the
         * size it asks for. Its photo's type is read from mediaType, where the
         * service worker reads type.
         *
         * The cards are read from Fastmail's offline copy, as the service
         * worker reads them, which takes a fraction of a second; asking the
         * server's contact search took one and a half to two and a half.
         * Without an offline copy the server is asked, and its search matches
         * parts of addresses, so the address itself is checked on each card.
         *
         * Resolves to the picture as a data: URL, or '' for none, and to
         * whether a photo was found at all: that is what makes the service
         * worker drop the notification, whether or not the download worked.
         */
        var PHOTO_TIMEOUT = 4000;
        var CONTACTS = 'urn:ietf:params:jmap:contacts';
        // How Fastmail's offline copy marks a record's account and a record
        // that has been destroyed, as its service worker reads them
        var OFFLINE_ACCOUNT = '_a';
        var OFFLINE_DESTROYED = '_d';

        var photoOnCard = function (card, address) {
            if (!card || card.kind === 'group') return null;
            var emails = card.emails || {};
            var hasAddress = Object.keys(emails).some(function (key) {
                return String((emails[key] || {}).address || '').trim().toLowerCase() === address;
            });
            if (!hasAddress) return null;
            var media = card.media || {};
            var key = Object.keys(media).filter(function (each) {
                return media[each] && media[each].kind === 'photo' && media[each].blobId;
            })[0];
            return key ? media[key] : null;
        };

        // The default address book's account first, then the newest card,
        // the service worker's order
        var betterPhoto = function (found, candidate, primary) {
            if (!found) return candidate;
            if ((candidate.accountId === primary) !== (found.accountId === primary)) {
                return candidate.accountId === primary ? candidate : found;
            }
            return candidate.cardId > found.cardId ? candidate : found;
        };

        // undefined when there is no offline copy to read
        var offlinePhotoOf = function (address, primary) {
            var name = 'JMAP-v2-' + pageUserId;
            if (!pageUserId || !window.indexedDB || typeof indexedDB.databases !== 'function') {
                return Promise.resolve(undefined);
            }
            return indexedDB.databases().then(function (databases) {
                if (!databases.some(function (each) { return each.name === name; })) return undefined;
                return new Promise(function (resolve) {
                    var opening = indexedDB.open(name);
                    // Never create one: a database that is not there stays not there
                    opening.onupgradeneeded = function () { opening.transaction.abort(); };
                    opening.onerror = opening.onblocked = function () { resolve(undefined); };
                    opening.onsuccess = function () {
                        var db = opening.result;
                        if (!db.objectStoreNames.contains('ContactCard')) {
                            db.close();
                            resolve(undefined);
                            return;
                        }
                        var reading = db.transaction(['ContactCard'], 'readonly').objectStore('ContactCard').getAll();
                        reading.onerror = function () { db.close(); resolve(undefined); };
                        reading.onsuccess = function () {
                            db.close();
                            var found = null;
                            (reading.result || []).forEach(function (card) {
                                var accountId = card && card[OFFLINE_ACCOUNT];
                                if (typeof accountId !== 'string' || card[OFFLINE_DESTROYED]) return;
                                var photo = photoOnCard(card, address);
                                if (photo) {
                                    found = betterPhoto(found, { accountId: accountId, cardId: String(card.id), photo: photo }, primary);
                                }
                            });
                            resolve(found);
                        };
                    };
                });
            }).catch(function () {
                return undefined;
            });
        };

        var serverPhotoOf = function (fastmail, address, accountIds) {
            var photoIn = function (accountId) {
                return fastmail.callJMAPMethod('ContactCard/query', {
                    accountId: accountId, filter: { email: address }, limit: 20
                }).then(function (found) {
                    if (!found || !found.ids || !found.ids.length) return null;
                    return fastmail.callJMAPMethod('ContactCard/get', {
                        accountId: accountId, ids: found.ids, properties: ['kind', 'emails', 'media']
                    });
                }).then(function (cards) {
                    var photo = null;
                    ((cards && cards.list) || []).some(function (card) {
                        photo = photoOnCard(card, address);
                        return !!photo;
                    });
                    return photo ? { accountId: accountId, photo: photo } : null;
                });
            };
            return accountIds.reduce(function (previous, accountId) {
                return previous.then(function (found) { return found || photoIn(accountId); });
            }, Promise.resolve(null));
        };

        var contactPhotoOf = function (push) {
            var none = { image: '', hasPhoto: false };
            var address = senderOf(push).address.trim().toLowerCase();
            var fastmail = window.FastMail;
            var auth = fastmail && fastmail.auth;
            if (!address || !auth || typeof auth.get !== 'function' || typeof auth.signUrl !== 'function' ||
                    typeof fastmail.callJMAPMethod !== 'function') {
                return Promise.resolve(none);
            }

            var accounts = auth.get('accounts') || {};
            var primary = (auth.get('primaryAccounts') || {})[CONTACTS];
            var accountIds = Object.keys(accounts).filter(function (id) {
                return !!((accounts[id] || {}).accountCapabilities || {})[CONTACTS];
            }).sort(function (a, b) {
                return (b === primary ? 1 : 0) - (a === primary ? 1 : 0);
            });

            var lookup = offlinePhotoOf(address, primary).then(function (found) {
                return found === undefined ? serverPhotoOf(fastmail, address, accountIds) : found;
            }).then(function (found) {
                var template = String(auth.get('downloadUrl') || '');
                if (!found) return none;
                if (!template) return { image: '', hasPhoto: true };
                var type = String(found.photo.mediaType || found.photo.type || 'image/jpeg');
                var url = template
                    .replace('{accountId}', encodeURIComponent(found.accountId))
                    .replace('{blobId}', encodeURIComponent(found.photo.blobId))
                    .replace('{type}', encodeURIComponent(type))
                    .replace('{name}', encodeURIComponent(type.replace('/', '.')));
                // Asked for inside the signed address: the signature covers
                // the path only
                url += (url.indexOf('?') === -1 ? '?' : '&') + 'max-width=212&max-height=212';
                return fetch(auth.signUrl(url)).then(function (response) {
                    return response.ok ? response.blob() : null;
                }).then(function (blob) {
                    if (!blob || !/^image\//.test(blob.type)) return '';
                    return new Promise(function (resolve) {
                        var reader = new FileReader();
                        reader.onloadend = function () { resolve(imageOf(reader.result)); };
                        reader.readAsDataURL(blob);
                    });
                }).catch(function () {
                    return '';
                }).then(function (image) {
                    return { image: image, hasPhoto: true };
                });
            }).catch(function () {
                return none;
            });

            return Promise.race([lookup, new Promise(function (resolve) {
                setTimeout(function () { resolve(none); }, PHOTO_TIMEOUT);
            })]);
        };

        // A compose window leaves this to the mailbox window it came from,
        // rather than every open one looking the same sender up again.
        if (!window.__fmshellComposeWindow) try {
            // Held on to: a channel nothing refers to is collected, listener
            // and all, a few seconds after the page has loaded
            window.__fmshell.proxyWorkerChannel = new BroadcastChannel('proxyworker');
            window.__fmshell.proxyWorkerChannel.addEventListener('message', function (event) {
                var message = event.data;
                if (!message || message.type !== 'emailPush' || !message.data) return;
                var push = message.data;
                var email = emailOf(push);
                if (!email || notifiedEmailIds[email.id]) return;
                // Another account's window is the one Fastmail would pick
                if (pageUserId && push.userId && push.userId !== pageUserId) return;

                // Looked up straight away rather than after the wait. The
                // service worker looks no picture up for a sender it does not
                // believe, and so does not fail on one.
                var announcedAt = Date.now();
                var lookup = senderOf(push).dressedUp ? Promise.resolve({ image: '', hasPhoto: false }) : contactPhotoOf(push);
                lookup.then(function (found) {
                    // A contact photo, with no BIMI logo to show ahead of it,
                    // is exactly what the service worker fails on: nothing is
                    // coming from it, so there is nothing to wait for. Anything
                    // else it may still show, and gets the rest of its time.
                    var dropped = found.hasPhoto && !email.bimiBlobId;
                    var wait = dropped ? 0 : Math.max(0, FALLBACK_DELAY - (Date.now() - announcedAt));
                    setTimeout(function () {
                        if (!claimEmail(push)) return;
                        queueNotification({
                            id: String(email.id),
                            title: fallbackTitle(push),
                            body: String(email.subject || '') || 'New message',
                            sound: mailSoundWanted(push.userId),
                            threadId: String(email.threadId || ''),
                            icon: found.image,
                            url: messageUrlFor(push),
                            data: jsonOf(push)
                        });
                    }, wait);
                });
            });
        } catch (error) {
            report(error);
        }

        // A WKWebView's own window.Notification reports "denied" with no
        // public way for this app to change that, which is what left the
        // Notifications page's own "Enable notifications" button unable to
        // do anything. Real Electron apps stand in front of the same page
        // code by replacing window.Notification themselves, so it is
        // replaced here too, backed by whatever the Mac app already knows
        // from asking the system.
        var notificationPermission = 'default';
        var refreshNotificationPermission = function () {
            post('notificationPermission', {}).then(function (value) {
                if (typeof value === 'string') notificationPermission = value;
            });
        };
        refreshNotificationPermission();
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) refreshNotificationPermission();
        });

        var NotificationShim = function (title, options) {
            options = options || {};
            window.electron.showNotification(
                { title: title, body: options.body },
                options.data || {}
            );
        };
        Object.defineProperty(NotificationShim, 'permission', {
            get: function () { return notificationPermission; }
        });
        NotificationShim.requestPermission = function (callback) {
            return post('requestNotificationPermission', {}).then(function (value) {
                notificationPermission = typeof value === 'string' ? value : 'denied';
                if (typeof callback === 'function') callback(notificationPermission);
                return notificationPermission;
            });
        };
        window.Notification = NotificationShim;

        // A click, back to the worker that wrote the notification: it
        // opens the message, the same way it does for its own clicks
        window.native.notificationClicked = function (dataJSON) {
            var worker = navigator.serviceWorker && navigator.serviceWorker.controller;
            if (!worker) {
                console.warn('FastmailShell: no service worker to open the notification');
                return;
            }
            var data;
            try { data = JSON.parse(dataJSON); } catch (error) { return; }
            worker.postMessage({ type: 'notificationclick', data: data });
        };

        // A mail click, opened by Fastmail's own entry point for its native
        // apps: the action its service worker posts for a click. It marks the
        // thread out of date before opening it, so a window left idle shows
        // the thread as it is now, and it picks the message's own mailbox.
        // Answers false when the page cannot take it (not signed in, another
        // user, an account this session lacks), so the app opens the address.
        window.native.openMessage = function (dataJSON) {
            var data;
            try { data = JSON.parse(dataJSON); } catch (error) { return false; }
            var email = data && data['@type'] === 'EmailPush' && data.email;
            var app = window.FastMail;
            if (!email || !email.id || !email.mailboxIds || !data.accountId) return false;
            if (!app || typeof app.doAction !== 'function' || !app.auth || !app.store) return false;
            // FastMail.userId is only filled in when the page was loaded with
            // ?u=, so a user is turned away only when both are known; the
            // account check is what keeps another user's mail out.
            if (app.userId && data.userId && String(app.userId) !== String(data.userId)) return false;
            if (!app.auth.get('isAuthenticated') || !(data.accountId in (app.auth.get('accounts') || {}))) return false;
            app.doAction('goMessage', {
                accountId: data.accountId,
                emailId: email.id,
                threadId: email.threadId || null,
                mailboxIds: email.mailboxIds
            });
            return true;
        };
    }

    var SETTINGS_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"' +
        ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
        ' stroke-linejoin="round" class="u-standardicon v-Icon">' +
        '<circle cx="12" cy="12" r="3"/>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83' +
        ' 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1' +
        ' 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65' +
        ' 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06' +
        'a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2' +
        ' 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06' +
        'a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9' +
        'a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65' +
        ' 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0' +
        ' 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51' +
        ' 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

    window.addEventListener('error', function (event) {
        if (!event.error && event.message === 'Script error.') {
            report('a script failed but WebKit suppressed the details; check Web Inspector');
            return;
        }
        report(event.error || event.message);
    });
    // Fastmail rejects with plain objects as part of its own flow, a record
    // that could not be loaded say, and leaves some of those unhandled; they
    // are logged rather than shown, which read "[object Object]".
    window.addEventListener('unhandledrejection', function (event) {
        var reason = event.reason;
        if (reason instanceof Error) {
            report(reason);
            return;
        }
        var described;
        try {
            described = reason && typeof reason === 'object' ? Object.keys(reason).join(',') : String(reason);
        } catch (error) {
            described = typeof reason;
        }
        post('log', { message: 'unhandled rejection: ' + described });
    });

    installRouteHooks();
    watchTheme();
    watchComposeKey();
    watchEditDraft();
    watchDragRegions();
    watchMenus();
    watchSettingsList();
})();
