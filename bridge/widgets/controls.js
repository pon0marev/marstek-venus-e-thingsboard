var root, el = {}, st = null, selected = null, picked = false, detailKey = '', busy = false, pollTimer, fitTimer, fitObserver;
var form = { power: 1000, minutes: 60, dir: -1 };
var draft = [], dirty = false, clearOthers = true;
var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var MODES = [
    { id: 'Auto', icon: 'autorenew', desc: 'Automatic control based on the smart meter', exports: true },
    { id: 'AI', icon: 'psychology', desc: 'Automatic optimisation by the battery AI', exports: true },
    { id: 'Manual', icon: 'event', desc: 'Weekly schedule of charge or discharge rules' },
    { id: 'Passive', icon: 'tune', desc: 'Charge or discharge at a set power for a set time' },
    { id: 'UPS', icon: 'power', desc: 'Backup power priority' }
];

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) {
        return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
    });
}

function maxPower() { return (self.ctx.settings && self.ctx.settings.maxPower) || 2500; }
function allowed() { return !!(st && st.allowDischarge); }
function activeMode() {
    if (!st || !st.mode) { return null; }
    var m = MODES.filter(function(x) { return x.id.toLowerCase() === String(st.mode).toLowerCase(); })[0];
    return m ? m.id : null;
}
function locked(m) { return m.exports && !allowed(); }

function setMsg(text, cls) {
    el.msg.textContent = text || '';
    el.msg.title = text || '';
    el.msg.className = 'mc-msg ' + (cls || '');
}

function send(method, params, cb, timeout) {
    self.ctx.controlApi.sendTwoWayCommand(method, params, timeout || 30000).subscribe(
        function(res) { cb(null, res); },
        function(err) { cb(err && (err.statusText || err.message) || 'no response'); });
}

function loadState() {
    send('getState', {}, function(err, res) {
        if (err || !res || res.error) { return; }
        st = res;
        render();
    });
}

function run(method, params, label, opts) {
    opts = opts || {};
    if (busy) { return; }
    busy = true;
    setMsg(label + ': sending…');
    send(method, params, function(err, res) {
        busy = false;
        var time = new Date().toLocaleTimeString();
        if (err) {
            setMsg(label + ': failed - ' + err, 'err');
        } else if (res && res.error) {
            setMsg(label + ': ' + res.error, 'err');
        } else if (res && res.set_result === false) {
            setMsg(label + ': the device rejected the command (' + time + ')', 'err');
        } else {
            setMsg(label + ': done (' + time + ')', 'ok');
            if (opts.onOk) { opts.onOk(); }
        }
        loadState();
    }, opts.timeout);
}

function confirmThen(title, message, fn) {
    var dialogs = self.ctx.dialogs;
    if (dialogs && dialogs.confirm) {
        dialogs.confirm(title, message, 'Cancel', 'Confirm').subscribe(function(ok) { if (ok) { fn(); } });
    } else if (window.confirm(title + '\n\n' + message)) {
        fn();
    }
}

function fmtTime(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function flow(power) {
    if (power == null || isNaN(Number(power))) { return ''; }
    var p = Number(power);
    return p < 0 ? 'charging ' + Math.abs(p) + ' W' : p > 0 ? 'discharging ' + p + ' W' : 'idle';
}

function renderStatus() {
    if (!st) { el.status.innerHTML = '<span class="mc-dot"></span>Reading battery state…'; return; }
    var mode = st.mode || 'unknown';
    var parts = ['<b>' + esc(mode) + '</b> mode'];
    var f = flow(st.power);
    if (f) { parts.push(f); }
    if (st.soc != null) { parts.push('charge ' + esc(st.soc) + '%'); }
    var c = st.command;
    if (c && c.type === 'passive' && activeMode() === 'Passive' && c.at + c.seconds * 1000 > Date.now()) {
        parts.push('set from here: ' + (c.power < 0 ? 'charge ' : 'discharge ') + Math.abs(c.power) +
            ' W until ' + fmtTime(c.at + c.seconds * 1000));
    }
    el.status.innerHTML = '<span class="mc-dot ' + (st.power < 0 ? 'charge' : st.power > 0 ? 'discharge' : '') +
        '"></span>' + parts.join(' · ');
    el.sw.checked = allowed();
}

function renderTiles() {
    var active = activeMode();
    el.tiles.innerHTML = '';
    MODES.forEach(function(m) {
        var t = document.createElement('button');
        t.className = 'mc-tile' + (m.id === active ? ' active' : '') + (m.id === selected ? ' selected' : '') +
            (locked(m) ? ' locked' : '');
        t.title = m.desc + (m.exports ? '. May export energy to the grid' + (locked(m) ? ': enable discharging below to use it' : '') : '');
        t.innerHTML = '<span class="mc-tile-top"><span class="material-icons">' + m.icon + '</span>' +
            (m.id === active ? '<span class="mc-chip">Active</span>' :
             locked(m) ? '<span class="material-icons mc-lock">lock</span>' : '') + '</span>' +
            '<span class="mc-tile-name">' + m.id + '</span>';
        t.addEventListener('click', function() { selected = m.id; picked = true; render(); });
        el.tiles.appendChild(t);
    });
}

function help(text) {
    return '<span class="mc-help" tabindex="0"><span class="material-icons">help_outline</span><span class="mc-tip">' + esc(text) + '</span></span>';
}

function field(label, id, value, attrs) {
    return '<label class="mc-field">' + label + '<input id="' + id + '" ' + attrs + ' value="' + esc(value) + '"></label>';
}

function dirSwitch() {
    var can = allowed();
    if (!can && form.dir > 0) { form.dir = -1; }
    return '<div class="mc-seg"><button type="button" data-dir="-1" class="' + (form.dir < 0 ? 'on' : '') + '">Charge</button>' +
        '<button type="button" data-dir="1" class="' + (form.dir > 0 ? 'on' : '') + '"' +
        (can ? '' : ' disabled title="Enable discharging below"') + '>Discharge</button></div>';
}

function syncDraft() {
    if (dirty) { return; }
    var rules = st && st.rules ? st.rules : {};
    draft = Object.keys(rules).map(Number).sort(function(x, y) { return x - y; }).map(function(k) {
        var r = rules[k];
        return { slot: r.slot, start: r.start, end: r.end, days: r.days.slice(), power: Math.abs(r.power),
                 dir: r.power < 0 ? -1 : 1, enable: r.enable };
    });
}

function freeSlot() {
    var used = draft.map(function(w) { return w.slot; });
    for (var i = 0; i <= 9; i++) { if (used.indexOf(i) < 0) { return i; } }
    return -1;
}

function winRow(w, i) {
    var can = allowed();
    var days = DAYS.map(function(d, k) {
        return '<button type="button" class="mc-day' + (w.days.indexOf(k) >= 0 ? ' on' : '') + '" data-d="' + k + '">' + d.slice(0, 2) + '</button>';
    }).join('');
    return '<div class="mc-win' + (w.enable ? '' : ' off') + '" data-i="' + i + '"><span class="mc-slotno">#' + w.slot + '</span>' +
        '<div class="mc-seg sm"><button type="button" data-wdir="-1" class="' + (w.dir < 0 ? 'on' : '') + '">Charge</button>' +
        '<button type="button" data-wdir="1" class="' + (w.dir > 0 ? 'on' : '') + '"' + (can || w.dir > 0 ? '' : ' disabled title="Enable discharging below"') + '>Discharge</button></div>' +
        '<input type="time" data-f="start" value="' + esc(w.start) + '"><span>–</span><input type="time" data-f="end" value="' + esc(w.end) + '">' +
        '<input type="number" data-f="power" class="pw" min="1" max="' + maxPower() + '" value="' + esc(w.power) + '"><span>W</span>' +
        '<span class="mc-days2">' + days + '</span>' +
        '<label class="mc-on"><input type="checkbox" data-f="enable"' + (w.enable ? ' checked' : '') + '> On</label>' +
        '<button type="button" class="mc-icon-btn" data-del title="Remove window">&times;</button></div>';
}

function detailHtml() {
    var m = MODES.filter(function(x) { return x.id === selected; })[0];
    if (!m) { return ''; }
    if (m.id === 'Passive') {
        return '<div class="mc-rules-title">Passive mode' +
            help('Charge or discharge at a set power for a set time. Passive mode replaces the current mode, and when the time runs out the battery returns to idle.') + '</div>' +
            '<div class="mc-row">' + dirSwitch() +
            field('Power, W (max ' + maxPower() + ')', 'mc-power', form.power, 'type="number" min="1" max="' + maxPower() + '"') +
            field('Duration, min', 'mc-minutes', form.minutes, 'type="number" min="1" max="1440"') +
            '<button type="button" class="mc-btn green" id="mc-start"><span class="material-icons">play_arrow</span>Start</button>' +
            '<button type="button" class="mc-btn ghost" id="mc-stop"><span class="material-icons">pause_circle</span>Stop (idle)</button></div>';
    }
    if (m.id === 'Manual') {
        syncDraft();
        var enabled = draft.filter(function(w) { return w.enable; }).length;
        return '<div class="mc-row mc-between"><div class="mc-rules-title">Weekly windows · ' + draft.length + ' of 10' +
            (dirty ? ' <span class="mc-dirty">not applied</span>' : '') +
            help('The battery cannot report its windows, so ThingsBoard remembers what was last applied from this dashboard (device attribute manual_windows). ' +
                'Applying writes the listed windows to the battery and, if ticked, clears every other slot, so the battery ends up with exactly this schedule. ' +
                'Existing windows created in the Marstek app are replaced. Overlaps are not checked by the battery.') + '</div>' +
            '<div class="mc-row"><span class="mc-tipwrap">' +
            '<button type="button" class="mc-btn ghost" id="mc-add"' + (draft.length >= 10 ? ' disabled' : '') + '><span class="material-icons">add</span>Add window</button>' +
            (draft.length >= 10 ? '<span class="mc-tip">All 10 windows are in use</span>' : '') + '</span>' +
            (dirty ? '<button type="button" class="mc-btn ghost" id="mc-reset">Reset</button>' : '') + '</div></div>' +
            (draft.length ? draft.map(winRow).join('') : '<div class="mc-note">No windows yet</div>') +
            '<div class="mc-row mc-between"><label class="mc-check"><input type="checkbox" id="mc-clear"' + (clearOthers ? ' checked' : '') +
            '> Clear all other slots when applying</label>' +
            (draft.length ?
                '<button type="button" class="mc-btn green" id="mc-apply"><span class="material-icons">check</span>Apply ' + enabled + ' window' + (enabled === 1 ? '' : 's') + '</button>' :
                '<button type="button" class="mc-btn ghost" id="mc-apply"><span class="material-icons">delete_sweep</span>Clear battery schedule</button>') + '</div>';
    }
    var lockedNow = locked(m), isActive = activeMode() === m.id;
    return '<div class="mc-rules-title">' + m.id + ' mode' +
        help(m.desc + '.' + (m.exports ? ' This mode can send energy to the grid.' : '') +
            ' Activating it replaces the current mode and its schedule.') + '</div>' +
        '<div class="mc-row">' +
        (isActive ? '<span class="mc-active"><span class="material-icons">check_circle</span>Active now</span>' :
            '<button type="button" class="mc-btn blue" id="mc-activate"' +
            (lockedNow ? ' disabled title="Enable discharging below to use this mode"' : '') +
            '><span class="material-icons">' + m.icon + '</span>Activate ' + m.id + '</button>') + '</div>';
}

function readForm() {
    var q = function(id) { var n = el.detail.querySelector('#' + id); return n ? n.value : null; };
    if (q('mc-power') != null) { form.power = Number(q('mc-power')); form.minutes = Number(q('mc-minutes')); }
}

function readDraft() {
    el.detail.querySelectorAll('.mc-win').forEach(function(row) {
        var w = draft[Number(row.dataset.i)];
        if (!w) { return; }
        row.querySelectorAll('[data-f]').forEach(function(inp) {
            var f = inp.dataset.f;
            if (f === 'enable') { w.enable = inp.checked; }
            else if (f === 'power') { w.power = Number(inp.value); }
            else { w[f] = inp.value; }
        });
        w.days = [];
        row.querySelectorAll('.mc-day.on').forEach(function(b) { w.days.push(Number(b.dataset.d)); });
    });
    var c = el.detail.querySelector('#mc-clear');
    if (c) { clearOthers = c.checked; }
}

function overlaps() {
    var on = draft.filter(function(w) { return w.enable; }), found = [];
    for (var i = 0; i < on.length; i++) {
        for (var j = i + 1; j < on.length; j++) {
            var a = on[i], b = on[j];
            var share = a.days.some(function(d) { return b.days.indexOf(d) >= 0; });
            if (share && a.start < b.end && b.start < a.end) { found.push('#' + a.slot + ' and #' + b.slot); }
        }
    }
    return found;
}

function applyAll() {
    readDraft();
    var p, bad = null;
    var windows = draft.map(function(w) {
        p = Math.round(w.power);
        if (!(p >= 1 && p <= maxPower())) { bad = 'window #' + w.slot + ': power must be 1-' + maxPower() + ' W'; }
        else if (!w.start || !w.end || w.start >= w.end) { bad = 'window #' + w.slot + ': start must be before end'; }
        else if (!w.days.length) { bad = 'window #' + w.slot + ': pick at least one day'; }
        return { slot: w.slot, start: w.start, end: w.end, days: w.days, power: w.dir * p, enable: w.enable };
    });
    if (bad) { setMsg('Check ' + bad, 'err'); return; }
    var ov = overlaps();
    var enabled = windows.filter(function(w) { return w.enable; }).length;
    var exports = windows.some(function(w) { return w.enable && w.power > 0; });
    // The list is also empty on a fresh dashboard while the battery holds a schedule made in the Marstek app.
    var empty = !windows.length;
    if (empty && !clearOthers) { setMsg('Nothing to apply: add a window first', 'err'); return; }
    confirmThen(empty ? 'Erase all 10 windows on the battery?' : 'Apply ' + enabled + ' window' + (enabled === 1 ? '' : 's') + ' to the battery?',
        empty ? 'The list here is empty, so this switches the battery to Manual mode and clears every slot, ' +
        'including windows created in the Marstek app. They cannot be read back or restored.' :
        'This switches the battery to Manual mode and writes ' + windows.length + ' slot' + (windows.length === 1 ? '' : 's') +
        (clearOthers ? ', clearing all other slots' : '') + '. Existing windows in those slots are replaced.' +
        (exports ? ' At least one window discharges into the grid.' : '') +
        (ov.length ? ' Warning: overlapping windows ' + ov.join(', ') + '.' : ''),
        function() {
            run('setManualAll', { windows: windows, clearOthers: clearOthers }, 'Apply windows',
                { timeout: 150000, onOk: function() { dirty = false; } });
        });
}

function bindDetail() {
    var d = el.detail, on = function(id, fn) { var n = d.querySelector('#' + id); if (n) { n.addEventListener('click', fn); } };
    d.querySelectorAll('[data-dir]').forEach(function(b) {
        b.addEventListener('click', function() { readForm(); form.dir = Number(b.dataset.dir); renderDetail(true); });
    });
    d.querySelectorAll('.mc-win').forEach(function(row) {
        var i = Number(row.dataset.i);
        row.addEventListener('input', function() { dirty = true; });
        row.querySelectorAll('.mc-day').forEach(function(b) {
            b.addEventListener('click', function() { b.classList.toggle('on'); readDraft(); dirty = true; });
        });
        row.querySelectorAll('[data-wdir]').forEach(function(b) {
            b.addEventListener('click', function() { readDraft(); draft[i].dir = Number(b.dataset.wdir); dirty = true; renderDetail(true); });
        });
        row.querySelectorAll('[data-del]').forEach(function(b) {
            b.addEventListener('click', function() { readDraft(); draft.splice(i, 1); dirty = true; renderDetail(true); });
        });
        row.querySelectorAll('[data-f="enable"]').forEach(function(c) {
            c.addEventListener('change', function() { readDraft(); renderDetail(true); });
        });
    });
    on('mc-add', function() {
        readDraft();
        var slot = freeSlot();
        if (slot < 0) { return; }
        draft.push({ slot: slot, start: '10:00', end: '15:00', days: [0, 1, 2, 3, 4, 5, 6], power: 800, dir: -1, enable: true });
        dirty = true;
        renderDetail(true);
    });
    on('mc-reset', function() { dirty = false; renderDetail(true); });
    on('mc-apply', applyAll);
    var clr = d.querySelector('#mc-clear');
    if (clr) { clr.addEventListener('change', function() { clearOthers = clr.checked; }); }
    on('mc-activate', function() {
        confirmThen('Switch to ' + selected + ' mode?', 'This replaces the current mode and its schedule. A Manual schedule cannot be restored from ThingsBoard.',
            function() { run('setMode', { mode: selected }, selected + ' mode'); });
    });
    on('mc-stop', function() {
        confirmThen('Stop (idle for 60 min)?', 'The battery will neither charge nor discharge and the current mode will be replaced.',
            function() { run('setPassive', { power: 0, seconds: 3600 }, 'Stop'); });
    });
    on('mc-start', function() {
        readForm();
        var p = Math.round(form.power), m = Math.round(form.minutes);
        if (!(p >= 1 && p <= maxPower()) || !(m >= 1 && m <= 1440)) { setMsg('Power must be 1-' + maxPower() + ' W and duration 1-1440 min', 'err'); return; }
        var verb = form.dir < 0 ? 'Charge' : 'Discharge';
        confirmThen(verb + ' at ' + p + ' W for ' + m + ' min?',
            (form.dir > 0 ? 'The battery will send energy to the grid. ' : '') + 'The current mode will be replaced.',
            function() { run('setPassive', { power: form.dir * p, seconds: m * 60 }, verb + ' ' + p + ' W'); });
    });
}

function renderDetail(force) {
    var key = [selected, activeMode(), allowed(), form.dir, JSON.stringify(st && st.rules)].join('|');
    if (!force && key === detailKey) { return; }
    detailKey = key;
    if (selected === 'Manual' && el.detail.querySelector('.mc-win')) { readDraft(); }
    el.detail.innerHTML = detailHtml();
    bindDetail();
}

function placeTip(h) {
    var tip = h.querySelector('.mc-tip');
    if (!tip) { return; }
    h.classList.remove('up');
    if (h.getBoundingClientRect().bottom + 6 + tip.offsetHeight > root.getBoundingClientRect().bottom) { h.classList.add('up'); }
}

function fitCell() {
    var item = root && root.closest('gridster-item');
    var panel = root && root.querySelector('.mc-panel');
    if (!item || !panel) { return; }
    root.classList.add('mc-fit');
    var h = Math.ceil(panel.getBoundingClientRect().height) + 4;
    if (Math.abs(item.offsetHeight - h) > 1) { item.style.height = h + 'px'; }
}

function render() {
    if (!picked && st) { selected = activeMode() || selected || 'Passive'; }
    renderStatus();
    renderTiles();
    renderDetail(false);
}

self.onInit = function() {
    root = self.ctx.$container[0].querySelector('.mc-root');
    root.classList.toggle('dark', (self.ctx.settings || {}).theme !== 'light');
    root.innerHTML =
        '<div class="mc-panel"><div class="mc-head"><div class="mc-status"></div>' +
        '<label class="mc-switch" title="When off, nothing can send energy from the battery to the grid">' +
        '<input type="checkbox"><span class="mc-slider"></span><span class="mc-switch-text">Allow discharge to grid</span></label></div>' +
        '<div class="mc-tiles"></div><div class="mc-detail"></div>' +
        '<div class="mc-msg"></div></div>';
    el = { status: root.querySelector('.mc-status'), tiles: root.querySelector('.mc-tiles'),
           detail: root.querySelector('.mc-detail'), msg: root.querySelector('.mc-msg'),
           sw: root.querySelector('.mc-switch input') };
    el.sw.addEventListener('change', function() {
        var want = el.sw.checked;
        el.sw.checked = !want;
        if (want) {
            confirmThen('Allow discharging into the grid?',
                'Auto and AI modes become available, and Passive and Manual rules can discharge. Energy will be sent to the grid.',
                function() { run('setAllowDischarge', { value: true }, 'Discharging allowed'); });
        } else {
            run('setAllowDischarge', { value: false }, 'Discharging blocked');
        }
    });
    if (!self.ctx.defaultSubscription.rpcEnabled) {
        setMsg('Target device is not set', 'err');
        return;
    }
    ['mouseover', 'focusin'].forEach(function(ev) {
        root.addEventListener(ev, function(e) {
            var h = e.target.closest && e.target.closest('.mc-help');
            if (h) { placeTip(h); }
        });
    });
    render();
    loadState();
    pollTimer = setInterval(loadState, 20000);
    if (window.ResizeObserver) {
        fitObserver = new ResizeObserver(fitCell);
        fitObserver.observe(root.querySelector('.mc-panel'));
    }
    fitTimer = setInterval(fitCell, 1000);
};

self.onDestroy = function() {
    clearInterval(pollTimer);
    clearInterval(fitTimer);
    if (fitObserver) { fitObserver.disconnect(); }
};

self.typeParameters = function() {
    return { maxDatasources: 0, maxDataKeys: 0, dataKeysOptional: true, displayRpcMessageToast: false };
};
