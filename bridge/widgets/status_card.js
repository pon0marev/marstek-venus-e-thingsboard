var timer, lastTs, el, gradId;
var STALE_SEC = 180;

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) {
        return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
    });
}

var CHARGE, WARM, CORAL, MUTED;

function state(kind, v) {
    if (kind === 'grid') {
        return v > 0 ? { color: WARM, hint: 'To grid' } : v < 0 ? { color: CHARGE, hint: 'Charging' } : { color: MUTED, hint: 'Idle' };
    }
    if (kind === 'temp') {
        return v < 5 ? { color: MUTED, hint: 'Cold' } : v < 40 ? { color: MUTED, hint: 'Normal' } :
               v < 50 ? { color: WARM, hint: 'Warm' } : { color: CORAL, hint: 'Hot' };
    }
    return null;
}

function lastOf(name) {
    var row = (self.ctx.data || []).filter(function(d) { return d.dataKey && d.dataKey.name === name; })[0];
    return row && row.data && row.data.length ? row.data[row.data.length - 1][1] : null;
}

function age() {
    if (!lastTs) { return; }
    var sec = Math.max(0, Math.round((Date.now() - lastTs) / 1000));
    var stale = sec > STALE_SEC;
    var node = el.querySelector('.mv-updated');
    el.querySelector('.mv-card').classList.toggle('stale', stale);
    if (stale) {
        node.textContent = 'no data for ' + Math.round(sec / 60) + ' min';
    } else if ((self.ctx.settings || {}).showAge) {
        node.textContent = 'updated ' + (sec < 60 ? sec + ' s' : Math.round(sec / 60) + ' min') + ' ago';
    } else {
        node.textContent = '';
    }
}

self.onInit = function() {
    var s = self.ctx.settings || {};
    var light = s.theme === 'light';
    CHARGE = light ? '#0B7A53' : '#6EE7A0';
    WARM = light ? '#A85A12' : '#E8B170';
    CORAL = light ? '#B23A22' : '#D9694F';
    MUTED = light ? '#5E6266' : '#8A8F94';
    gradId = 'mvg' + Math.random().toString(36).slice(2);
    el = self.ctx.$container[0].querySelector('.mv-root');
    el.innerHTML =
        '<div class="mv-card' + (s.gear ? ' has-gear' : '') + (s.theme === 'light' ? ' light' : '') + '" style="--accent:' + esc(s.color || '#2196f3') + '">' +
        '<div class="mv-body">' +
        '<div class="mv-head"><span class="mv-label">' + esc(s.label) + '</span><span class="mv-updated"></span></div>' +
        '<div class="mv-main"><span class="mv-value">–</span><span class="mv-unit">' + esc(s.units) + '</span>' +
        '<span class="mv-hint">' + esc(s.hint) + '</span></div></div>' +
        (s.spark ? '<svg class="mv-spark" viewBox="0 0 100 30" preserveAspectRatio="none"></svg>' : '') +
        (s.gear ? '<button type="button" class="mv-gear" title="Settings"><span class="material-icons">settings</span></button>' : '') +
        '</div>';
    timer = setInterval(age, 15000);

    var gearButton = el.querySelector('.mv-gear');
    if (gearButton) {
        gearButton.addEventListener('click', function(event) {
            event.stopPropagation();
            var gears = self.ctx.actionsApi.getActionDescriptors('gearClick');
            if (!gears || !gears.length) { return; }
            var ds = self.ctx.datasources && self.ctx.datasources[0];
            var entityId = ds && ds.entityId ? { entityType: ds.entityType, id: ds.entityId } : null;
            self.ctx.actionsApi.handleWidgetAction(event, gears[0], entityId, ds && ds.entityName, null, ds && ds.entityLabel);
        });
    }

    var descriptors = self.ctx.actionsApi.getActionDescriptors('cardClick');
    if (descriptors && descriptors.length) {
        var card = el.querySelector('.mv-card');
        card.classList.add('clickable');
        card.title = descriptors[0].name || '';
        card.addEventListener('click', function(event) {
            var ds = self.ctx.datasources && self.ctx.datasources[0];
            var entityId = ds && ds.entityId ? { entityType: ds.entityType, id: ds.entityId } : null;
            self.ctx.actionsApi.handleWidgetAction(event, descriptors[0], entityId, ds && ds.entityName, null, ds && ds.entityLabel);
        });
    }
};

function spark(points, range) {
    var svg = el.querySelector('.mv-spark');
    var vals = [];
    var n = Math.min(points.length, 80);
    var size = points.length / n;
    for (var i = 0; i < n; i++) {
        var chunk = points.slice(Math.floor(i * size), Math.floor((i + 1) * size) || undefined);
        var sum = 0;
        chunk.forEach(function(p) { sum += p; });
        vals.push(sum / chunk.length);
    }
    if (vals.length < 2) { svg.innerHTML = ''; return; }
    var lo = range[0], span = range[1] - range[0];
    var xy = vals.map(function(v, i) {
        var y = 27 - Math.max(0, Math.min(1, (v - lo) / span)) * 24;
        return (i / (vals.length - 1) * 100).toFixed(2) + ',' + y.toFixed(2);
    });
    svg.innerHTML =
        '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/>' +
        '<stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>' +
        '<polygon points="0,30 ' + xy.join(' ') + ' 100,30" fill="url(#' + gradId + ')"/>' +
        '<polyline points="' + xy.join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="1.6" ' +
        'vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>';
}

self.onDataUpdated = function() {
    var s = self.ctx.settings || {};
    var d = self.ctx.data && self.ctx.data[0] && self.ctx.data[0].data;
    if (!d || !d.length) { return; }
    var last = d[d.length - 1];
    var raw = last[1];
    var num = Number(raw);
    var isNum = raw !== '' && raw !== null && !isNaN(num);
    var card = el.querySelector('.mv-card');
    var shown = raw;
    if (isNum) {
        var v = s.divisor ? num / s.divisor : num;
        // grid power direction is spelled out by the hint, so show the size only
        var size = s.kind === 'grid' ? Math.abs(v) : v;
        shown = s.decimals != null ? size.toFixed(s.decimals) : String(size);
        num = v;
        var st = state(s.kind, v);
        // A full battery on the mains shows 0 W too, so an outage is spelled out.
        var out = s.kind === 'grid' && !v && lastOf('mains') !== null && Number(lastOf('mains')) === 0;
        if (out) {
            shown = 'Off';
            st = { color: CORAL, hint: '' };
        }
        card.classList.toggle('out', out);
        el.querySelector('.mv-unit').textContent = out ? '' : (s.units || '');
        if (st) {
            el.querySelector('.mv-hint').textContent = st.hint;
            card.style.setProperty('--accent', st.color);
        }
    }
    var valueNode = el.querySelector('.mv-value');
    if (valueNode.textContent !== '–' && valueNode.textContent !== String(shown)) {
        valueNode.classList.remove('flash');
        void valueNode.offsetWidth;
        valueNode.classList.add('flash');
    }
    valueNode.textContent = shown;
    if (isNum && s.spark) {
        var series = [];
        d.forEach(function(p) {
            var x = Number(p[1]);
            if (!isNaN(x)) { series.push(s.divisor ? x / s.divisor : x); }
        });
        spark(series, s.spark);
    }
    lastTs = last[0];
    age();
};

self.onDestroy = function() {
    clearInterval(timer);
};

self.typeParameters = function() {
    return { maxDatasources: 1, maxDataKeys: 2, dataKeysOptional: false };
};

self.actionSources = function() {
    return { cardClick: { name: 'Card click', multiple: true }, gearClick: { name: 'Gear button click', multiple: true } };
};
