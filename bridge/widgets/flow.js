var el, timer, lastTs;
var STALE_SEC = 180, IDLE_W = 2;
var GRID, LOAD;

function last(name) {
    var row = (self.ctx.data || []).filter(function(d) { return d.dataKey && d.dataKey.name === name; })[0];
    var d = row && row.data;
    if (!d || !d.length) { return null; }
    var v = Number(d[d.length - 1][1]);
    if (name === 'es_ongrid_power') { lastTs = d[d.length - 1][0]; }
    return isNaN(v) ? null : v;
}

function setLink(id, watts, reverse, color, label) {
    var link = el.querySelector(id);
    var on = watts !== null && Math.abs(watts) > IDLE_W;
    link.classList.toggle('on', on);
    link.classList.toggle('reverse', on && reverse);
    link.style.setProperty('--flow', color);
    link.querySelector('.mf-watts').textContent = watts === null ? '–' : Math.round(Math.abs(watts)) + ' W';
    link.querySelector('.mf-dir').textContent = on ? label : '';
    // More power, faster pulse.
    link.style.setProperty('--speed', on ? Math.max(.9, 3.2 - Math.abs(watts) / 1000 * 2.3).toFixed(2) + 's' : '3s');
    return on;
}

function setNode(id, active, color) {
    var node = el.querySelector(id);
    node.classList.toggle('active', active);
    node.style.setProperty('--flow', color);
}

function age() {
    if (!lastTs) { return false; }
    var sec = Math.max(0, Math.round((Date.now() - lastTs) / 1000));
    var stale = sec > STALE_SEC;
    el.querySelector('.mf-card').classList.toggle('stale', stale);
    return stale;
}

function render() {
    if (!el) { return; }
    var grid = last('es_ongrid_power'), off = last('es_offgrid_power'), soc = last('es_bat_soc');
    var charging = grid !== null && grid < 0;
    var gridColor = charging ? GRID : LOAD;
    var gridOn = setLink('.mf-grid', grid, !charging, gridColor, charging ? 'Charging' : 'To grid');
    var offOn = setLink('.mf-load', off, false, LOAD, 'To sockets');
    // A full battery on the mains shows 0 W too, so an outage is drawn as a cut link.
    var out = last('mains') === 0 && !gridOn, gridLink = el.querySelector('.mf-grid');
    gridLink.classList.toggle('out', out);
    el.querySelector('.mf-n-grid').classList.toggle('out', out);
    if (out) { gridLink.querySelector('.mf-watts').textContent = 'Off'; }
    setNode('.mf-n-grid', gridOn, gridColor);
    setNode('.mf-n-load', offOn, LOAD);
    setNode('.mf-n-bat', gridOn || offOn, gridOn ? gridColor : LOAD);
    el.querySelector('.mf-soc').textContent = soc === null ? '–' : Math.round(soc) + '%';
    var stale = age();
    el.querySelector('.mf-status').textContent = stale ? 'No fresh data' : gridOn || offOn ? 'Flowing' : 'Idle';
}

self.onInit = function() {
    el = self.ctx.$container[0].querySelector('.mf-root');
    var light = (self.ctx.settings || {}).theme === 'light';
    GRID = light ? '#55595E' : '#C9CDD1';
    LOAD = light ? '#A85A12' : '#E8B170';
    function node(cls, name, extra) {
        return '<div class="mf-node ' + cls + '"><div class="mf-dot"></div><div class="mf-name">' + name + (extra || '') + '</div></div>';
    }
    function link(cls) {
        return '<div class="mf-link ' + cls + '"><div class="mf-watts"></div><div class="mf-line"></div><div class="mf-dir"></div></div>';
    }
    el.innerHTML = '<div class="mf-card' + (light ? ' light' : '') + '"><div class="mf-head"><span class="mf-title">Energy flow</span><span class="mf-status"></span></div>' +
        '<div class="mf-diagram">' + node('mf-n-grid', 'Grid') + link('mf-grid') +
        node('mf-n-bat', 'Battery', '<span class="mf-soc">–</span>') + link('mf-load') +
        node('mf-n-load', 'Sockets') + '</div></div>';
    timer = setInterval(render, 15000);
    render();
};

self.onDataUpdated = render;

self.onDestroy = function() {
    clearInterval(timer);
};

self.typeParameters = function() {
    return { maxDatasources: 1, maxDataKeys: 4, dataKeysOptional: false };
};
