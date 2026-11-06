// Theme choice shared by the widgets: auto (sun at the chosen location), light or dark, kept per browser.
(function() {
    if (window.MarstekTheme) { return; }
    var KYIV = { lat: 50.45, lon: 30.52 }, RAD = Math.PI / 180;

    function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    function write(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private window */ } }

    function sun(now, lat, lon) {
        var day = Math.round(now.getTime() / 86400000 + 2440587.5 - 2451545 + lon / 360);
        var star = day - lon / 360;
        var m = (357.5291 + 0.98560028 * star) * RAD;
        var c = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m);
        var l = (m / RAD + c + 180 + 102.9372) * RAD;
        var noon = 2451545 + star + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);
        var dec = Math.asin(Math.sin(l) * Math.sin(23.4397 * RAD));
        var cos = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(dec)) / (Math.cos(lat * RAD) * Math.cos(dec));
        if (cos >= 1) { return { polar: 'night' }; }
        if (cos <= -1) { return { polar: 'day' }; }
        var w = Math.acos(cos) / RAD / 360;
        var toDate = function(j) { return new Date((j - 2440587.5) * 86400000); };
        return { rise: toDate(noon - w), set: toDate(noon + w) };
    }

    var api = {
        sun: sun,
        pref: function() {
            var v = read('marstek.theme');
            return v === 'light' || v === 'dark' ? v : 'auto';
        },
        location: function() {
            var lat = parseFloat(read('marstek.lat')), lon = parseFloat(read('marstek.lon'));
            return isNaN(lat) || isNaN(lon) ? KYIV : { lat: lat, lon: lon };
        },
        today: function() {
            var loc = api.location();
            return sun(new Date(), loc.lat, loc.lon);
        },
        resolve: function() {
            var pref = api.pref();
            if (pref !== 'auto') { return pref; }
            var s = api.today(), now = new Date();
            if (s.polar) { return s.polar === 'day' ? 'light' : 'dark'; }
            return now >= s.rise && now < s.set ? 'light' : 'dark';
        },
        setPref: function(v) { write('marstek.theme', v); window.dispatchEvent(new Event('marstek-theme')); },
        setLocation: function(lat, lon) {
            write('marstek.lat', String(lat));
            write('marstek.lon', String(lon));
            window.dispatchEvent(new Event('marstek-theme'));
        }
    };
    window.MarstekTheme = api;
})();
