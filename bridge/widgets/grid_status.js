var el, timer;
var GAP_MS = 10 * 60000;

function duration(ms) {
    var min = Math.round(ms / 60000);
    if (min < 60) { return min + ' min'; }
    var h = Math.floor(min / 60);
    return h < 48 ? h + ' h ' + (min % 60) + ' min' : Math.round(h / 24) + ' days';
}

function clock(ts) {
    var d = new Date(ts);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

function render() {
    if (!el) { return; }
    var row = self.ctx.data && self.ctx.data[0];
    var points = (row && row.data) || [];
    var tw = self.ctx.defaultSubscription && self.ctx.defaultSubscription.timeWindow;
    var now = Date.now();
    var max = tw && tw.maxTime ? tw.maxTime : now;
    var min = tw && tw.minTime ? tw.minTime : (points.length ? points[0][0] : now - 3600000);
    var span = Math.max(1, max - min), html = '', start = null, on = null, prev = null;

    function flush(end) {
        if (start === null) { return; }
        var left = Math.max(0, (start - min) / span * 100), width = Math.min(100 - left, (end - start) / span * 100);
        html += '<div class="mg-seg ' + (on ? 'on' : 'off') + '" style="left:' + left + '%;width:' + width + '%" title="' +
            (on ? 'Mains on' : 'Mains off') + ', ' + clock(start) + ' – ' + clock(end) + '"></div>';
    }
    points.forEach(function(p) {
        var value = Number(p[1]) > 0;
        if (prev !== null && p[0] - prev > GAP_MS) { flush(prev); start = null; }
        if (start === null) { start = p[0]; on = value; }
        else if (value !== on) { flush(p[0]); start = p[0]; on = value; }
        prev = p[0];
    });
    flush(prev);
    el.querySelector('.mg-track').innerHTML = html;

    var state = el.querySelector('.mg-state');
    if (prev === null || now - prev > GAP_MS) {
        state.textContent = 'Unknown';
        state.style.color = 'rgba(0, 0, 0, .54)';
    } else {
        state.textContent = (on ? 'On for ' : 'Off for ') + duration(now - start);
        state.style.color = on ? '#2e7d32' : '#c62828';
    }
}

self.onInit = function() {
    el = self.ctx.$container[0].querySelector('.mg-root');
    el.innerHTML = '<div class="mg-card"><div class="mg-info"><span class="mg-label">Mains power</span><span class="mg-state">–</span></div>' +
        '<div class="mg-track"></div><div class="mg-legend"><span><span class="mg-dot" style="background:#66bb6a"></span>On</span>' +
        '<span><span class="mg-dot" style="background:#ef5350"></span>Off</span></div></div>';
    timer = setInterval(render, 30000);
    render();
};

self.onDataUpdated = render;

self.onDestroy = function() {
    clearInterval(timer);
};

self.typeParameters = function() {
    return { maxDatasources: 1, maxDataKeys: 1, dataKeysOptional: false };
};
