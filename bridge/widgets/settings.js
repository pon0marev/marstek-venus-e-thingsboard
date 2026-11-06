var root, el = {}, st = null, busy = false, pollTimer;
var charge = { value: null, touched: false };

function maxPower() { return (self.ctx.settings && self.ctx.settings.maxPower) || 2500; }

function setMsg(text, cls) {
    el.msg.textContent = text || '';
    el.msg.className = 'ms-msg ' + (cls || '');
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
        renderState();
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
        if (err) { setMsg(label + ': failed - ' + err, 'err'); }
        else if (res && res.error) { setMsg(label + ': ' + res.error, 'err'); }
        else if (res && res.set_result === false) { setMsg(label + ': the device rejected the command (' + time + ')', 'err'); }
        else {
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

function help(text, right) {
    return '<span class="ms-help' + (right ? ' right' : '') + '" tabindex="0"><span class="material-icons">help_outline</span><span class="ms-tip">' + text + '</span></span>';
}

function clock(d) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

function renderTheme() {
    var pref = MarstekTheme.pref(), sun = MarstekTheme.today();
    root.classList.toggle('dark', MarstekTheme.resolve() === 'dark');
    root.querySelectorAll('#ms-theme button').forEach(function(b) { b.classList.toggle('on', b.dataset.v === pref); });
    root.querySelector('#ms-sun').textContent = sun.polar ? 'No sunrise or sunset today' : 'Sunrise ' + clock(sun.rise) + ' · Sunset ' + clock(sun.set);
}

function lastSet(v, fmt) { return v == null ? 'not set from here yet' : 'last set from here: ' + fmt(v); }

function renderCharge() {
    var now = st ? st.chargePower : null;
    // the slider follows the battery until it is moved, then keeps the pending value
    if (!charge.touched) { charge.value = now || Math.min(1500, maxPower()); }
    el.charge.value = charge.value;
    el.chargeVal.textContent = charge.value + ' W';
    el.chargeApply.disabled = !st || charge.value === now;
    root.querySelector('#ms-charge-hint').textContent = !st ? '' : now ? 'set from here: ' + now + ' W, all day' : 'not set from here';
}

function applyCharge() {
    var p = charge.value, now = st && st.chargePower;
    confirmThen(now ? 'Change charge power to ' + p + ' W?' : 'Charge at ' + p + ' W whenever grid power is available?',
        now ? 'The all-day charge window is rewritten with the new power.' :
        'This switches the battery to Manual mode and replaces its whole schedule with one window: every day, 00:00–23:59, charge at ' + p + ' W. ' +
        'Windows created on the Battery control page or in the Marstek app are erased. They cannot be read back or restored.',
        function() {
            // taking over the schedule writes all ten slots, a second apart
            run('setChargePower', { power: p }, 'Charge power ' + p + ' W', { timeout: 150000, onOk: function() { charge.touched = false; } });
        });
}

function renderState() {
    var d = (st && st.device) || {};
    renderCharge();
    if (d.dod != null) { el.dod.value = d.dod; el.dodVal.textContent = d.dod + '%'; }
    root.querySelector('#ms-dod-hint').textContent = lastSet(d.dod, function(v) { return v + '%'; });
    root.querySelector('#ms-led-hint').textContent = lastSet(d.led, function(v) { return v ? 'on' : 'off'; });
    root.querySelector('#ms-ble-hint').textContent = lastSet(d.ble_adv, function(v) { return v ? 'on' : 'off'; });
    [['led', d.led], ['ble', d.ble_adv]].forEach(function(c) {
        root.querySelectorAll('#ms-' + c[0] + ' button').forEach(function(b) {
            b.classList.toggle('on', c[1] != null && (b.dataset.v === '1') === !!c[1]);
        });
    });
}

self.onInit = function() {
    root = self.ctx.$container[0].querySelector('.ms-root');
    var loc = MarstekTheme.location();
    root.innerHTML =
        '<div class="ms-panel"><div class="ms-card"><b>Appearance' + help('Auto switches to light at sunrise and dark at sunset, calculated from the date and this location. The choice is kept in this browser.') + '</b>' +
        '<div class="ms-theme"><div class="ms-seg" id="ms-theme"><button type="button" data-v="auto">Auto</button><button type="button" data-v="light">Light</button><button type="button" data-v="dark">Dark</button></div>' +
        '<span class="ms-sun" id="ms-sun"></span>' +
        '<label class="ms-field">Latitude<input type="number" step="0.01" min="-90" max="90" id="ms-lat" value="' + loc.lat + '"></label>' +
        '<label class="ms-field">Longitude<input type="number" step="0.01" min="-180" max="180" id="ms-lon" value="' + loc.lon + '"></label></div></div>' +
        '<div class="ms-grid">' +
        '<div class="ms-card"><b>Charge power' + help('How fast the battery charges whenever grid power is available. The battery has no such setting, only a power per Manual window, so this writes one window that charges all day, every day, and makes it the whole schedule. Windows created on the Battery control page or in the Marstek app are erased, and changes made in the app afterwards are not seen here.') + '</b>' +
        '<span class="ms-hint" id="ms-charge-hint"></span><div class="ms-ctl"><input type="range" id="ms-charge" min="100" max="' + maxPower() + '" step="100">' +
        '<span class="ms-val wide" id="ms-charge-val"></span><button type="button" class="ms-btn" id="ms-charge-apply">Apply</button></div></div>' +
        '<div class="ms-card"><b>Depth of discharge' + help('Lowest charge level the battery may reach, 30-88% (88 is the default). Lower values keep a reserve. Needs battery firmware 150 or newer. The battery cannot report this value, so the last value set from this dashboard is shown.') + '</b>' +
        '<span class="ms-hint" id="ms-dod-hint"></span><div class="ms-ctl"><input type="range" id="ms-dod" min="30" max="88" value="88">' +
        '<span class="ms-val" id="ms-dod-val">88%</span><button type="button" class="ms-btn" id="ms-dod-apply">Apply</button></div></div>' +
        '<div class="ms-card"><b>LED' + help('Status lights on the battery. Needs battery firmware 150 or newer. The battery cannot report this value, so the last value set from this dashboard is shown.') + '</b><span class="ms-hint" id="ms-led-hint"></span>' +
        '<div class="ms-ctl"><div class="ms-seg" id="ms-led"><button type="button" data-v="1">On</button><button type="button" data-v="0">Off</button></div></div></div>' +
        '<div class="ms-card"><b>Bluetooth' + help('Advertising lets the Marstek app find the battery. Needs battery firmware 150 or newer. The battery cannot report this value, so the last value set from this dashboard is shown.') + '</b><span class="ms-hint" id="ms-ble-hint"></span>' +
        '<div class="ms-ctl"><div class="ms-seg" id="ms-ble"><button type="button" data-v="1">On</button><button type="button" data-v="0">Off</button></div></div></div>' +
        '</div>' +
        '<div class="ms-msg"></div></div>';
    el = { msg: root.querySelector('.ms-msg'), dod: root.querySelector('#ms-dod'), dodVal: root.querySelector('#ms-dod-val'),
           charge: root.querySelector('#ms-charge'), chargeVal: root.querySelector('#ms-charge-val'), chargeApply: root.querySelector('#ms-charge-apply') };
    el.charge.addEventListener('input', function() {
        charge.value = Number(el.charge.value);
        charge.touched = true;
        renderCharge();
    });
    el.chargeApply.addEventListener('click', applyCharge);
    renderCharge();
    el.dod.addEventListener('input', function() { el.dodVal.textContent = el.dod.value + '%'; });
    root.querySelector('#ms-dod-apply').addEventListener('click', function() {
        var v = Number(el.dod.value);
        confirmThen('Set depth of discharge to ' + v + '%?', 'The battery will stop discharging when the remaining charge reaches ' + (100 - v) + '%.',
            function() { run('setDod', { value: v }, 'Depth of discharge ' + v + '%'); });
    });
    [['led', 'setLed', 'LED'], ['ble', 'setBle', 'Bluetooth advertising']].forEach(function(c) {
        root.querySelectorAll('#ms-' + c[0] + ' button').forEach(function(b) {
            b.addEventListener('click', function() {
                var on = b.dataset.v === '1';
                confirmThen('Turn ' + c[2] + (on ? ' on?' : ' off?'),
                    !on && c[0] === 'ble' ? 'The Marstek app may not find the battery over Bluetooth until it is turned on again.' : 'The setting is sent to the battery.',
                    function() { run(c[1], { on: on }, c[2] + (on ? ' on' : ' off')); });
            });
        });
    });
    root.querySelectorAll('#ms-theme button').forEach(function(b) {
        b.addEventListener('click', function() { MarstekTheme.setPref(b.dataset.v); });
    });
    ['#ms-lat', '#ms-lon'].forEach(function(id) {
        root.querySelector(id).addEventListener('change', function() {
            var lat = parseFloat(root.querySelector('#ms-lat').value), lon = parseFloat(root.querySelector('#ms-lon').value);
            if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { MarstekTheme.setLocation(lat, lon); }
        });
    });
    window.addEventListener('marstek-theme', renderTheme);
    renderTheme();
    if (!self.ctx.defaultSubscription.rpcEnabled) { setMsg('Target device is not set', 'err'); return; }
    loadState();
    pollTimer = setInterval(loadState, 30000);
};

self.onDestroy = function() {
    clearInterval(pollTimer);
    window.removeEventListener('marstek-theme', renderTheme);
};

self.typeParameters = function() {
    return { maxDatasources: 0, maxDataKeys: 0, dataKeysOptional: true, displayRpcMessageToast: false };
};
