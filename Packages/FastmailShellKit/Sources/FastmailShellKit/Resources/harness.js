(function () {
    if (window.__fmshell && window.__fmshell.boot) return;

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

    function matchesAny(patterns, href) {
        for (var i = 0; i < patterns.length; i += 1) {
            var escaped = patterns[i].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
            if (new RegExp('^' + escaped + '$').test(href)) return true;
        }
        return false;
    }

    function runWhenReady(runAt, fn) {
        if (runAt === 'document-start') {
            fn();
            return;
        }
        if (runAt === 'document-end') {
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
            else fn();
            return;
        }
        if (document.readyState === 'complete') fn();
        else window.addEventListener('load', fn);
    }

    function evaluate(source, label) {
        try {
            (0, eval)(source);
        } catch (error) {
            var message = error && error.message ? error.message : String(error);
            var stack = error && error.stack ? error.stack : '';
            post('error', { message: label + ': ' + message, stack: stack });
        }
    }

    window.__fmshell = {
        boot: function (userScript, overlay, metadata) {
            var patterns = (metadata && metadata.matches) || [];
            if (patterns.length && !matchesAny(patterns, location.href)) {
                post('error', {
                    message: 'user script @match does not cover ' + location.href,
                    stack: ''
                });
                return;
            }
            installRouteHooks();
            var runAt = (metadata && metadata.runAt) || 'document-idle';
            runWhenReady(runAt, function () {
                if (userScript) evaluate(userScript, 'userscript');
                if (overlay) evaluate(overlay, 'overlay');
            });
        },
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
        report(event.error || event.message);
    });
    window.addEventListener('unhandledrejection', function (event) {
        report(event.reason);
    });
})();
