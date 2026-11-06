var el, timer, lastTs, mood, shownSoc = null, shownKwh = null, tweens = {};
var LEDS = [[38.1, 16.8], [41.5, 16.9], [44.8, 17], [70.4, 17.4], [73.5, 17.5], [76.5, 17.6]];
var MOTES = [[20, 7.5, 0], [31, 9, 2.4], [42, 6.5, 4.6], [58, 8.5, 1.2], [69, 7, 3.4], [80, 9.5, .6], [88, 8, 5.2], [12, 10, 3.9]];
var STALE_SEC = 180;
var RATE_WINDOW_MS = 3600000, RATE_MIN_SPAN_MS = 1800000, RATE_MIN_WH = 5;
var LOAD_WINDOW_MS = 600000, FLOW_MIN_W = 2, CHARGE_MIN_SPAN_MS = 120000;

function series(name) {
    var row = (self.ctx.data || []).filter(function(d) { return d.dataKey && d.dataKey.name === name; })[0];
    return row && row.data ? row.data : [];
}

function lastValue(name) {
    var d = series(name);
    var v = d.length ? Number(d[d.length - 1][1]) : NaN;
    return isNaN(v) ? null : v;
}

// Time of day, with the date in front when it was not today.
function clock(ts) {
    var d = new Date(ts), hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return d.toDateString() === new Date().toDateString() ? hm :
        ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' + hm;
}

function reservePercent() {
    var row = (self.ctx.latestData || []).filter(function(d) { return d.dataKey && d.dataKey.name === 'dod'; })[0];
    var dod = row && row.data && row.data[0] ? Number(row.data[0][1]) : NaN;
    return dod > 0 && dod <= 100 ? 100 - dod : null;
}

function hint(soc, reserve) {
    var floor = reserve === null ? 10 : reserve;
    return soc <= floor ? (reserve === null ? 'Very low' : 'At reserve') : soc <= floor + 10 ? 'Low' : '';
}

// Wh per hour lost over the last hour while nothing draws power. Periods with a load are skipped:
// a short kettle would otherwise look like a permanent drain long after it was switched off.
// A charge ends the look back: the battery was in another state before it, and that drain is over.
// So does the start of an outage: on the mains the battery lost nothing, which would thin the rate out.
function drainRate() {
    var d = series('bat_bat_capacity');
    if (d.length < 2) { return null; }
    var load = {}, grid = {};
    series('es_offgrid_power').forEach(function(p) { load[p[0]] = Math.abs(Number(p[1])) || 0; });
    series('es_ongrid_power').forEach(function(p) { grid[p[0]] = Number(p[1]) || 0; });
    var outSince = lastValue('mains') === 0 ? lastValue('mains_since') : null;
    var end = d[d.length - 1][0], lost = 0, span = 0;
    for (var i = d.length - 1; i > 0 && end - d[i - 1][0] <= RATE_WINDOW_MS; i--) {
        if (outSince && d[i - 1][0] < outSince) { break; }
        if (grid[d[i][0]] < -FLOW_MIN_W || grid[d[i - 1][0]] < -FLOW_MIN_W) { break; }
        if (load[d[i][0]] > FLOW_MIN_W || load[d[i - 1][0]] > FLOW_MIN_W) { continue; }
        lost += Number(d[i - 1][1]) - Number(d[i][1]);
        span += d[i][0] - d[i - 1][0];
    }
    return span < RATE_MIN_SPAN_MS ? null : lost / (span / 3600000);
}

// Average output to the sockets over the last minutes: reacts to a new load right away.
function recentLoad() {
    var d = series('es_offgrid_power');
    if (!d.length) { return 0; }
    var end = d[d.length - 1][0], sum = 0, n = 0;
    for (var i = d.length - 1; i >= 0 && end - d[i][0] <= LOAD_WINDOW_MS; i--) { sum += Math.max(0, Number(d[i][1]) || 0); n++; }
    return n ? sum / n : 0;
}

// Wh per hour gained over the last minutes the mains have been charging the battery.
function chargeRate() {
    var d = series('bat_bat_capacity'), grid = {};
    series('es_ongrid_power').forEach(function(p) { grid[p[0]] = Number(p[1]) || 0; });
    var end = d.length - 1, i = end;
    while (i > 0 && d[end][0] - d[i - 1][0] <= LOAD_WINDOW_MS && grid[d[i - 1][0]] < -FLOW_MIN_W) { i--; }
    var span = end < 0 ? 0 : d[end][0] - d[i][0];
    return span < CHARGE_MIN_SPAN_MS ? null : (Number(d[end][1]) - Number(d[i][1])) / (span / 3600000);
}

function spanText(hours) {
    return hours < 1 ? Math.round(hours * 60) + ' min' : hours < 72 ? Math.round(hours) + ' h' : Math.round(hours / 24) + ' days';
}

function runtimeText(stored, rated, reserve) {
    if (stored === null || !rated) { return ''; }
    if ((lastValue('es_ongrid_power') || 0) < -FLOW_MIN_W) {
        // On mains the sockets are fed from the grid too, so nothing runs down whatever they draw.
        var gain = chargeRate();
        if (gain !== null && gain < RATE_MIN_WH) { return ''; }
        var left = gain === null ? 0 : (rated - stored) / gain;
        return left * 60 >= 1 ? '≈ ' + spanText(left) + ' to full' : 'Charging';
    }
    if (reserve === null) { return ''; }
    var load = recentLoad(), rate = load > FLOW_MIN_W ? load : drainRate();
    if (rate === null || rate < RATE_MIN_WH) { return ''; }
    var hours = Math.max(0, stored - reserve / 100 * rated) / rate;
    return hours > 0 ? '≈ ' + spanText(hours) + ' to reserve' : '';
}

function age() {
    if (!lastTs) { return; }
    var sec = Math.max(0, Math.round((Date.now() - lastTs) / 1000));
    var stale = sec > STALE_SEC;
    el.querySelector('.mb-card').classList.toggle('stale', stale);
    el.querySelector('.mb-updated').textContent = stale ? 'no data for ' + Math.round(sec / 60) + ' min' : '';
}

function setMood(card) {
    var grid = lastValue('es_ongrid_power') || 0, off = lastValue('es_offgrid_power') || 0;
    // The battery can lose energy with 0 W reported: its own electronics draw power during an outage.
    var next = grid < -FLOW_MIN_W ? 'charging' : (grid > FLOW_MIN_W || off > FLOW_MIN_W) ? 'discharging' :
        (lastValue('mains') === 0 || drainRate() >= RATE_MIN_WH) ? 'draining' : 'idle';
    ['charging', 'discharging', 'draining', 'idle'].forEach(function(m) { card.classList.toggle(m, m === next); });
    if (mood && mood !== next) {
        card.classList.remove('bloom');
        void card.offsetWidth;
        card.classList.add('bloom');
    }
    mood = next;
}

// Numbers roll to their new value instead of jumping.
function roll(key, from, to, write) {
    if (tweens[key]) { cancelAnimationFrame(tweens[key]); }
    var quiet = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (quiet || from === to) { write(to); return; }
    var start = null, length = 1000;
    function step(ts) {
        if (start === null) { start = ts; }
        var t = Math.min(1, (ts - start) / length), eased = 1 - Math.pow(1 - t, 3);
        write(from + (to - from) * eased);
        tweens[key] = t < 1 ? requestAnimationFrame(step) : null;
    }
    tweens[key] = requestAnimationFrame(step);
}

// The page colour and charts belong to a dashboard state, so a theme is a pair of states.
function syncTheme() {
    var mine = (self.ctx.settings || {}).theme === 'light' ? 'light' : 'dark', want = MarstekTheme.resolve();
    var states = self.ctx.stateController;
    if (want === mine || !states) { return; }
    var target = want === 'light' ? 'default_day' : 'default';
    if (states.getStateId() !== target) { states.updateState(target, states.getStateParams()); }
}

function render() {
    if (!el) { return; }
    var soc = lastValue('es_bat_soc');
    if (soc === null) { return; }
    var card = el.querySelector('.mb-card');
    var stored = lastValue('bat_bat_capacity'), rated = lastValue('bat_rated_capacity');
    var reserve = reservePercent();
    setMood(card);
    var light = (self.ctx.settings || {}).theme === 'light';
    card.style.setProperty('--accent', reserve !== null && soc <= reserve ? (light ? '#B23A22' : '#D9694F') : (light ? '#0B7A53' : '#6EE7A0'));
    var valueNode = el.querySelector('.mb-value');
    roll('soc', shownSoc === null ? 0 : shownSoc, Math.round(soc), function(v) { valueNode.textContent = Math.round(v); });
    shownSoc = Math.round(soc);
    // An outage is named in the large line until there is a time estimate to put there instead.
    var since = lastValue('mains_since'), runtime = runtimeText(stored, rated, reserve);
    var outage = lastValue('mains') === 0 ? 'Discharging' + (since ? ' since ' + clock(since) : '') : '';
    el.querySelector('.mb-hint').textContent = [hint(soc, reserve), runtime ? outage : ''].filter(Boolean).join(' · ');
    var level = Math.max(0, Math.min(100, soc)) + '%';
    el.querySelector('.mb-fill').style.width = level;
    el.querySelector('.mb-sheen').style.width = level;

    var marker = el.querySelector('.mb-marker');
    marker.style.display = reserve === null ? 'none' : 'block';
    if (reserve !== null) { marker.style.left = reserve + '%'; }
    el.querySelector('.mb-reserve').textContent = reserve === null ? '' : 'Reserve ' + reserve + '%';

    if (stored !== null) {
        var hasReserve = reserve !== null && rated;
        var kwh = (hasReserve ? Math.max(0, stored - reserve / 100 * rated) : stored) / 1000;
        var footNode = el.querySelector('.mb-foot-value');
        roll('kwh', shownKwh === null ? 0 : shownKwh, kwh, function(v) {
            footNode.textContent = v.toFixed(2) + (hasReserve ? ' kWh usable' : ' kWh stored');
        });
        shownKwh = kwh;
    }
    var runtimeNode = el.querySelector('.mb-runtime');
    runtimeNode.textContent = runtime || outage;
    runtimeNode.classList.toggle('alert', !runtime && !!outage);

    var d = series('es_bat_soc');
    lastTs = d[d.length - 1][0];
    age();
}

self.onInit = function() {
    el = self.ctx.$container[0].querySelector('.mb-root');
    var image = (self.ctx.settings || {}).image;
    el.innerHTML =
        '<div class="mb-card idle' + ((self.ctx.settings || {}).theme === 'light' ? ' light' : '') + '">' +
        '<div class="mb-halo mb-halo-green"></div><div class="mb-halo mb-halo-warm"></div><div class="mb-bloom"></div>' +
        '<div class="mb-motes">' + MOTES.map(function(m) {
            return '<span class="mb-mote" style="left:' + m[0] + '%;--t:' + m[1] + 's;--d:-' + m[2] + 's"></span>';
        }).join('') + '</div><div class="mb-floor"></div>' +
        '<div class="mb-head"><span class="mb-label">Battery</span><span class="mb-updated"></span></div>' +
        '<div class="mb-main"><span class="mb-value">–</span><span class="mb-unit">%</span><span class="mb-hint"></span></div>' +
        '<div class="mb-runtime"></div>' +
        '<div class="mb-track"><div class="mb-fill"></div><div class="mb-sheen"></div><div class="mb-marker"></div></div>' +
        '<div class="mb-foot"><span class="mb-foot-value"></span><span class="mb-reserve"></span></div>' +
        (image ? '<div class="mb-device"><img class="mb-img" alt="Battery" src="' + image + '">' + LEDS.map(function(p, i) {
            return '<span class="mb-led" style="left:' + p[0] + '%;top:' + p[1] + '%;--d:' + (i % 3) * .22 + 's"></span>';
        }).join('') + '</div>' : '') + '</div>';
    timer = setInterval(function() { age(); syncTheme(); }, 15000);
    window.addEventListener('marstek-theme', syncTheme);
    syncTheme();

    var descriptors = self.ctx.actionsApi.getActionDescriptors('cardClick');
    if (descriptors && descriptors.length) {
        var card = el.querySelector('.mb-card');
        card.classList.add('clickable');
        card.title = descriptors[0].name || '';
        card.addEventListener('click', function(event) {
            var ds = self.ctx.datasources && self.ctx.datasources[0];
            var entityId = ds && ds.entityId ? { entityType: ds.entityType, id: ds.entityId } : null;
            self.ctx.actionsApi.handleWidgetAction(event, descriptors[0], entityId, ds && ds.entityName, null, ds && ds.entityLabel);
        });
    }
    render();
};

self.onDataUpdated = render;
self.onLatestDataUpdated = render;

self.onDestroy = function() {
    clearInterval(timer);
    window.removeEventListener('marstek-theme', syncTheme);
    Object.keys(tweens).forEach(function(k) { if (tweens[k]) { cancelAnimationFrame(tweens[k]); } });
};

self.typeParameters = function() {
    return { maxDatasources: 1, maxDataKeys: 7, dataKeysOptional: false, hasAdditionalLatestDataKeys: true };
};

self.actionSources = function() {
    return { cardClick: { name: 'Card click', multiple: true } };
};
