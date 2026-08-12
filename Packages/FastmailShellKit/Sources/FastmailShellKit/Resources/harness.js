(function () {
    if (window.__fmshell && window.__fmshell.report) return;

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

    var lastTheme = null;

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

    function reportTheme() {
        var meta = document.querySelector('meta[name="theme-color"]');
        var color = headerColor() || (meta ? meta.getAttribute('content') : null);
        if (!color || color === lastTheme) return;
        lastTheme = color;
        post('theme', { color: color });
    }

    function watchTheme() {
        var attempts = 0;
        (function poll() {
            reportTheme();
            attempts += 1;
            if (!headerColor() && attempts < 40) {
                window.setTimeout(poll, 250);
            }
        })();
        var observer = new MutationObserver(reportTheme);
        if (document.head) {
            observer.observe(document.head, { attributes: true, childList: true, subtree: true });
        }
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
            }, 100);
        });
        function observe() {
            if (document.body) observer.observe(document.body, { childList: true, subtree: true });
        }
        if (document.body) observe();
        else document.addEventListener('DOMContentLoaded', observe);
    }

    window.__fmshell = {
        onRoute: function (callback) {
            routeCallbacks.push(callback);
        },
        report: report
    };

    window.native = window.native || {};
    window.native.log = function () {
        var parts = Array.prototype.slice.call(arguments).map(String);
        post('log', { message: parts.join(' ') });
    };
    window.native.onRoute = function (callback) {
        window.__fmshell.onRoute(callback);
    };

    window.addEventListener('error', function (event) {
        if (!event.error && event.message === 'Script error.') {
            report('a script failed but WebKit suppressed the details; check Web Inspector');
            return;
        }
        report(event.error || event.message);
    });
    window.addEventListener('unhandledrejection', function (event) {
        report(event.reason);
    });

    installRouteHooks();
    watchTheme();
})();
