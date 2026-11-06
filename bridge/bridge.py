import json
import os
import queue
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

import paho.mqtt.client as mqtt

import dashboard

HOST = os.environ["MARSTEK_HOST"]
PORT = int(os.environ.get("MARSTEK_PORT", "30000"))
INTERVAL = float(os.environ.get("POLL_INTERVAL", "60"))
TB_URL = os.environ["TB_URL"].rstrip("/")
TB_ACCESS_TOKEN = os.environ.get("TB_ACCESS_TOKEN")
TB_API_KEY = os.environ.get("TB_API_KEY")
TB_USER = os.environ.get("TB_USER")
TB_PASSWORD = os.environ.get("TB_PASSWORD")
# the device side talks MQTT: the same host as the web interface unless told otherwise,
# port 8883 with TLS when the web interface has https, 1883 otherwise; TLS follows the port unless set explicitly
TB_MQTT_HOST = os.environ.get("TB_MQTT_HOST") or urllib.parse.urlsplit(TB_URL).hostname
TB_MQTT_PORT = int(os.environ.get("TB_MQTT_PORT") or (8883 if TB_URL.startswith("https") else 1883))
TB_MQTT_TLS = os.environ.get("TB_MQTT_TLS", str(TB_MQTT_PORT == 8883)).lower() == "true"
DEVICE_NAME = os.environ.get("TB_DEVICE_NAME", "Marstek Venus E")
ALLOW_DISCHARGE = os.environ.get("ALLOW_DISCHARGE", "false").lower() == "true"
STATE_FILE = os.environ.get("STATE_FILE", "/data/state.json")
TZ = ZoneInfo(os.environ.get("TZ", "UTC"))
# counter key -> telemetry prefix, section of the state file (None keeps the original top-level keys)
ENERGY_COUNTERS = {"es_total_grid_input_energy": ("grid_input", None),
                   "battery_output_total": ("battery_output", "battery_output")}
OUTPUT_MAX_GAP = 300
# mains detection: grid power that counts as a flow, one step of the stored energy counter,
# and how long the stored energy has to hold still before the mains are taken to be back
MAINS_FLOW_W = 2
MAINS_STEP_WH = 4
MAINS_FLAT_SEC = 25 * 60

FAST_METHODS = ["ES.GetStatus", "ES.GetMode", "Bat.GetStatus"]
SLOW_METHODS = ["Wifi.GetStatus"]
SLOW_EVERY = 5
CALL_GAP = 1.0
SKIP_KEYS = {"id", "wifi_mac", "ble_mac", "ssid", "sta_ip", "sta_gate", "sta_mask", "sta_dns"}
MODE_CFG = {"Auto": "auto_cfg", "AI": "ai_cfg", "UPS": "ups_cfg"}
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

latest = {}
device = None
last_attrs = None
restored = False  # the attributes saved in ThingsBoard have been read back, so publishing ours cannot erase them
state_lock = threading.Lock()
poll_now = threading.Event()
sock_lock = threading.Lock()
req_counter = 0


def http(method, path, body=None, token=None, timeout=15):
    req = urllib.request.Request(
        TB_URL + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    if token:
        req.add_header("X-Authorization", ("ApiKey " if TB_API_KEY else "Bearer ") + token)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


class Device:
    """The device side of ThingsBoard over MQTT.

    Telemetry and attributes go out with QoS 1: paho keeps them while the link is down and sends them
    once it is back, so every telemetry message carries its own timestamp. RPC requests arrive on a
    subscription and are answered from a worker thread, because a command can take a quarter of a
    minute while the network loop has to keep running.
    """

    def __init__(self, token, on_rpc):
        self.on_rpc = on_rpc
        self.connected = threading.Event()
        self.rpc_queue = queue.Queue()
        self.attr_reply, self.attr_event = {}, threading.Event()
        self.last_publish = ("", 0.0)
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self.client.username_pw_set(token)
        if TB_MQTT_TLS:
            self.client.tls_set()
        self.client.on_socket_open = self._on_socket_open
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message
        self.client.reconnect_delay_set(min_delay=1, max_delay=60)
        self.client.max_queued_messages_set(2000)
        # one message in flight: a backlog drains at the pace of the acknowledgements instead of
        # arriving as a burst that trips the per-device rate limit of ThingsBoard Cloud
        self.client.max_inflight_messages_set(1)
        threading.Thread(target=self._rpc_worker, daemon=True).start()

    def start(self):
        self.client.connect_async(TB_MQTT_HOST, TB_MQTT_PORT, keepalive=60)
        self.client.loop_start()

    def _on_socket_open(self, client, userdata, sock):
        # paho leaves Nagle's algorithm on, so a small packet sent right after another one (an RPC reply
        # right after the acknowledgement of the request) waits for the server's ACK: half a second
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def _on_connect(self, client, userdata, flags, reason, properties=None):
        if reason.is_failure:
            print("mqtt connection refused:", reason)
            return
        client.subscribe([("v1/devices/me/rpc/request/+", 1), ("v1/devices/me/attributes/response/+", 1)])
        self.connected.set()
        print("mqtt connected to %s:%s" % (TB_MQTT_HOST, TB_MQTT_PORT))

    def _on_disconnect(self, client, userdata, flags, reason, properties=None):
        self.connected.clear()
        print("mqtt disconnected (%s), reconnecting" % reason)
        topic, at = self.last_publish
        if time.time() - at < 3:
            # ThingsBoard closes the session instead of answering a message it cannot accept
            print("the disconnect followed a publish to %s: ThingsBoard may have rejected that message" % topic)

    def _on_message(self, client, userdata, msg):
        try:
            body = json.loads(msg.payload or b"{}")
        except ValueError:
            body = {}
        if msg.topic.startswith("v1/devices/me/rpc/request/"):
            self.rpc_queue.put((msg.topic.rsplit("/", 1)[1], body))
        elif msg.topic.startswith("v1/devices/me/attributes/response/"):
            self.attr_reply = body
            self.attr_event.set()

    def _rpc_worker(self):
        while True:
            req_id, body = self.rpc_queue.get()
            print("rpc", body)
            try:
                if not isinstance(body, dict):
                    raise ValueError("request must be a JSON object")
                resp = self.on_rpc(body.get("method"), body.get("params") or {})
            except Exception as e:
                resp = {"error": str(e)}
            try:
                # not queued for later: a reply that could not go out at once answers a request that has expired
                self._publish("v1/devices/me/rpc/response/" + req_id, resp, qos=0)
            except Exception as e:
                print("rpc reply error:", e)

    def _publish(self, topic, payload, qos=1):
        """Send or queue a message; False means it is gone: the queue is full or the payload is invalid."""
        try:
            body = json.dumps(payload, allow_nan=False)
        except ValueError as e:
            print("not sent, invalid value for %s: %s" % (topic, e))
            return False
        info = self.client.publish(topic, body, qos=qos)
        if info.rc == mqtt.MQTT_ERR_QUEUE_SIZE:
            print("dropped, the outgoing queue is full:", topic)
            return False
        self.last_publish = (topic, time.time())
        return True

    def telemetry(self, values, ts):
        return self._publish("v1/devices/me/telemetry", {"ts": ts, "values": values})

    def attributes(self, attrs):
        # ThingsBoard rejects a null, and a rejected message closes the session: paho would then
        # resend it after every reconnect and nothing else would ever get through
        return self._publish("v1/devices/me/attributes", {k: v for k, v in attrs.items() if v is not None})

    def request_attributes(self, keys, timeout=10):
        """Client attributes saved earlier, or None when ThingsBoard does not answer in time."""
        if not self.connected.wait(timeout):
            return None
        self.attr_event.clear()
        self._publish("v1/devices/me/attributes/request/1", {"clientKeys": keys}, qos=0)
        if not self.attr_event.wait(timeout):
            return None
        return self.attr_reply.get("client", {})


def provision():
    jwt = TB_API_KEY or http("POST", "/api/auth/login", {"username": TB_USER, "password": TB_PASSWORD})["token"]
    try:
        dev = http("GET", "/api/tenant/devices?deviceName=" + urllib.parse.quote(DEVICE_NAME), token=jwt)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        dev = http("POST", "/api/device", {"name": DEVICE_NAME, "type": "Marstek Venus E"}, token=jwt)
    device_id = dev["id"]["id"]
    token = http("GET", "/api/device/%s/credentials" % device_id, token=jwt)["credentialsId"]
    return jwt, device_id, token


def call(sock, method, params, retries=3):
    global req_counter
    for _ in range(retries):
        with sock_lock:
            req_counter += 1
            req_id = req_counter
            msg = {"id": req_id, "method": method, "params": params}
            sock.sendto(json.dumps(msg).encode(), (HOST, PORT))
            deadline = time.time() + 4
            while time.time() < deadline:
                sock.settimeout(max(0.1, deadline - time.time()))
                try:
                    data, _ = sock.recvfrom(4096)
                except socket.timeout:
                    break
                resp = json.loads(data)
                if resp.get("id") == req_id:
                    return resp.get("result")
    return None


def signed16(value):
    """The battery sends power as an unsigned 16-bit number, so -16 W arrives as 65520."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    return value - 65536 if 32767 < value <= 65535 else value


def poll(sock, cycle):
    telemetry = {}
    methods = FAST_METHODS + (SLOW_METHODS if cycle % SLOW_EVERY == 0 else [])
    for method in methods:
        time.sleep(CALL_GAP)
        result = call(sock, method, {"id": 0})
        if isinstance(result, dict):
            prefix = method.split(".")[0].lower()
            for k, v in result.items():
                if k not in SKIP_KEYS and isinstance(v, (int, float, str, bool)):
                    telemetry["%s_%s" % (prefix, k)] = signed16(v) if k.endswith("_power") else v
    if isinstance(telemetry.get("es_offgrid_power"), (int, float)):
        # the sockets only give power out: a few watts below zero is meter noise when the mains switch over
        telemetry["es_offgrid_power"] = max(0, telemetry["es_offgrid_power"])
    for key, name in (("es_mode", "mode"), ("es_ongrid_power", "power"), ("es_bat_soc", "soc")):
        if key in telemetry:
            latest[name] = telemetry[key]
    return telemetry


def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state):
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        with open(STATE_FILE + ".tmp", "w") as f:
            json.dump(state, f)
        os.replace(STATE_FILE + ".tmp", STATE_FILE)
    except OSError as e:
        print("state save error:", e)


def state_attributes(state):
    rules = state.get("rules", {})
    attrs = {"manual_windows": [rules[k] for k in sorted(rules, key=int)],
             "allow_discharge": state.get("settings", {}).get("allow_discharge", ALLOW_DISCHARGE)}
    attrs.update(state.get("device", {}))
    return attrs


def publish_attributes(state):
    global last_attrs
    attrs = state_attributes(state)
    if device is None or not restored or attrs == last_attrs:
        return
    if device.attributes(attrs):
        last_attrs = attrs


def restore_state(timeout=10):
    """Read the saved attributes back once; until that works, nothing is published over them."""
    global restored
    client = device.request_attributes("manual_windows,allow_discharge,dod,led,ble_adv", timeout)
    if client is None:
        print("attributes restore: no answer from ThingsBoard, trying again after the next poll")
        return

    def apply(state):
        if "rules" not in state and client.get("manual_windows") is not None:
            state["rules"] = {str(w["slot"]): w for w in client["manual_windows"]}
        saved = state.setdefault("device", {})
        for key in ("dod", "led", "ble_adv"):
            if key not in saved and key in client:
                saved[key] = client[key]
        if "allow_discharge" in client:
            state.setdefault("settings", {}).setdefault("allow_discharge", client["allow_discharge"])

    restored = True
    update_state(apply)


def update_state(fn):
    with state_lock:
        state = load_state()
        fn(state)
        save_state(state)
    publish_attributes(state)
    return state


def allow_discharge():
    return load_state().get("settings", {}).get("allow_discharge", ALLOW_DISCHARGE)


def period_energy(current, prefix="grid_input", section=None):
    now = datetime.now(TZ)
    result = {}

    def apply(root):
        state = root.setdefault(section, {}) if section else root
        last = state.get("last", current)
        for name, label in (("day", now.strftime("%Y-%m-%d")), ("month", now.strftime("%Y-%m"))):
            if state.get(name) != label:
                state[name] = label
                state[name + "_base"] = last if name in state and "last" in state else current
            if current < state[name + "_base"]:
                state[name + "_base"] = current
        state["last"] = current
        result[prefix + "_day"] = current - state["day_base"]
        result[prefix + "_month"] = current - state["month_base"]

    update_state(apply)
    return result


def device_attributes(sock):
    info = call(sock, "Marstek.GetDevice", {"ble_mac": "0"}) or {}
    return {"device_model": info.get("device"), "firmware": info.get("ver"),
            "ble_mac": info.get("ble_mac"), "wifi_mac": info.get("wifi_mac"),
            "wifi_name": info.get("wifi_name"), "ip": info.get("ip", HOST)}


def build_manual(params):
    slot = int(params["slot"])
    power = int(params["power"])
    start, end = params["start"], params["end"]
    days = sorted({int(d) for d in params.get("days", range(7))})
    enable = bool(params.get("enable", True))
    if not 0 <= slot <= 9:
        raise ValueError("slot must be 0-9")
    if power > 0 and not allow_discharge():
        raise ValueError(DISCHARGE_ERROR)
    if not (TIME_RE.match(start) and TIME_RE.match(end) and start < end):
        raise ValueError("start and end must be HH:MM with start < end")
    if not days or any(not 0 <= d <= 6 for d in days):
        raise ValueError("days must be a non-empty list of 0 (Mon) - 6 (Sun)")
    config = {"mode": "Manual", "manual_cfg": {
        "time_num": slot, "start_time": start, "end_time": end,
        "week_set": sum(1 << d for d in days), "power": power, "enable": 1 if enable else 0}}
    rule = {"slot": slot, "start": start, "end": end, "days": days, "power": power, "enable": enable}
    return config, rule


def set_all_manual(sock, params):
    windows = params.get("windows", [])
    if len(windows) > 10:
        raise ValueError("at most 10 windows are supported")
    slots = [int(w["slot"]) for w in windows]
    if len(set(slots)) != len(slots):
        raise ValueError("each window needs its own slot")
    jobs = [build_manual(w) for w in windows]
    cleared = []
    if params.get("clearOthers"):
        for slot in range(10):
            if slot not in slots:
                cleared.append(slot)
                jobs.append(build_manual({"slot": slot, "start": "00:00", "end": "00:01", "days": [0],
                                          "power": 0, "enable": False}))
    applied = 0
    for config, rule in jobs:
        time.sleep(CALL_GAP)
        result = call(sock, "ES.SetMode", {"id": 0, "config": config})
        if result is None or not result.get("set_result"):
            raise RuntimeError("slot %d failed after %d of %d windows were written" % (rule["slot"], applied, len(jobs)))
        applied += 1
        slot = str(rule["slot"])
        if rule["slot"] in cleared:
            update_state(lambda st: st.setdefault("rules", {}).pop(slot, None))
        else:
            update_state(lambda st: st.setdefault("rules", {}).update({slot: rule}))

    def done(st):
        st["command"] = {"type": "manual", "at": int(time.time() * 1000)}
        if params.get("clearOthers"):
            st["rules_exact"] = True

    update_state(done)
    latest["mode"] = "Manual"
    return {"set_result": True, "written": applied}


def charge_rule(power):
    return {"slot": 0, "start": "00:00", "end": "23:59", "days": list(range(7)), "power": -power, "enable": True}


def charge_power(state):
    """The battery has no charge power setting, only a power per Manual window.

    So a charge power is one window that charges all day, every day. It counts as set only when
    that window is the whole schedule: rules_exact says every other slot was cleared from here.
    """
    rules = state.get("rules", {})
    power = -(rules.get("0") or {}).get("power", 0)
    if latest.get("mode") == "Manual" and state.get("rules_exact") and power > 0 and rules == {"0": charge_rule(power)}:
        return power
    return None


def set_charge_power(sock, params):
    power = int(params["power"])
    if power < 1:
        raise ValueError("charge power must be at least 1 W")
    # changing the power rewrites one slot; taking over the schedule clears the other nine as well
    return set_all_manual(sock, {"windows": [charge_rule(power)], "clearOthers": charge_power(load_state()) is None})


DISCHARGE_ERROR = "discharging into the grid is disabled: enable it on the dashboard first"
EXPORT_MODES = {"Auto", "AI"}


def get_state():
    state = load_state()
    return {"mode": latest.get("mode"), "power": latest.get("power"), "soc": latest.get("soc"),
            "allowDischarge": allow_discharge(), "command": state.get("command"), "chargePower": charge_power(state),
            "rules": state.get("rules", {}), "device": state.get("device", {})}


def handle_rpc(sock, method, params):
    now_ms = int(time.time() * 1000)
    record = None
    if method == "getState":
        return get_state()
    if method == "refresh":
        poll_now.set()
        return {"ok": True}
    if method in ("setDod", "setLed", "setBle"):
        if method == "setDod":
            value = int(params["value"])
            if not 30 <= value <= 88:
                raise ValueError("DOD must be between 30 and 88")
            rpc, body, key, shown = "DOD.SET", {"value": value}, "dod", value
        elif method == "setLed":
            on = bool(params["on"])
            rpc, body, key, shown = "Led.Ctrl", {"state": 1 if on else 0}, "led", on
        else:
            on = bool(params["on"])
            # the device doc defines enable=0 as advertising on and 1 as off
            rpc, body, key, shown = "Ble.Adv", {"enable": 0 if on else 1}, "ble_adv", on
        if params.get("record"):
            # the value was set elsewhere, in the Marstek app: the battery cannot report it, so note it here
            update_state(lambda st: st.setdefault("device", {}).update({key: shown}))
            return {"set_result": True, "recorded": True}
        result = call(sock, rpc, dict(body, id=0))
        if result is None:
            raise RuntimeError("no response from device (Marstek documents this command for firmware 150 or newer)")
        if result.get("set_result"):
            update_state(lambda st: st.setdefault("device", {}).update({key: shown}))
        return {"set_result": result.get("set_result")}
    if method == "setManualAll":
        return set_all_manual(sock, params)
    if method == "setChargePower":
        return set_charge_power(sock, params)
    if method == "setAllowDischarge":
        value = bool(params["value"])
        update_state(lambda st: st.setdefault("settings", {}).update(allow_discharge=value))
        return {"allowDischarge": value}
    if method == "setMode":
        mode = params.get("mode")
        if mode not in MODE_CFG:
            raise ValueError("mode must be one of %s" % sorted(MODE_CFG))
        if mode in EXPORT_MODES and not allow_discharge():
            raise ValueError("%s may export energy to the grid: enable discharging on the dashboard first" % mode)
        config = {"mode": mode, MODE_CFG[mode]: {"enable": 1}}
        record = ("command", {"type": "mode", "mode": mode, "at": now_ms})
    elif method == "setPassive":
        power = int(params["power"])
        seconds = int(params["seconds"])
        if power > 0 and not allow_discharge():
            raise ValueError(DISCHARGE_ERROR)
        config = {"mode": "Passive", "passive_cfg": {"power": power, "cd_time": seconds}}
        record = ("command", {"type": "passive", "power": power, "seconds": seconds, "at": now_ms})
    elif method == "setManual":
        config, rule = build_manual(params)
        record = ("rule", rule)
    else:
        raise ValueError("unknown method " + method)
    result = call(sock, "ES.SetMode", {"id": 0, "config": config})
    if result is None:
        raise RuntimeError("no response from device")
    if result.get("set_result"):
        kind, value = record
        if kind == "rule":
            update_state(lambda st: st.setdefault("rules", {}).update({str(value["slot"]): value}))
            update_state(lambda st: st.update(command={"type": "manual", "at": now_ms}))
        else:
            # leaving Manual may drop its windows, and the battery cannot report them
            update_state(lambda st: st.update(command=value, rules_exact=False))
        latest["mode"] = config["mode"]
    return {"set_result": result.get("set_result")}


def integrate_output(telemetry, now=None):
    """Battery output in Wh from off-grid power: the battery's own load counter stayed at 0 under load."""
    if "es_offgrid_power" not in telemetry:
        return
    power = max(0.0, float(telemetry["es_offgrid_power"]))
    now = time.time() if now is None else now

    def apply(root):
        meter = root.setdefault("output_meter", {})
        total = meter.get("total", 0.0)
        if "ts" in meter and 0 < now - meter["ts"] <= OUTPUT_MAX_GAP:
            total += (meter["power"] + power) / 2 * (now - meter["ts"]) / 3600
        meter.update(ts=now, power=power, total=total)
        telemetry["battery_output_total"] = total

    update_state(apply)


def detect_mains(telemetry, now=None):
    """Tell whether the mains are present. The battery does not report it, and a full battery on the mains
    shows the same 0 W from the grid as a battery in an outage. What differs is the stored energy: without
    the mains the battery runs its own electronics from it, so it keeps falling, a step every ten minutes."""
    grid, stored = telemetry.get("es_ongrid_power"), telemetry.get("bat_bat_capacity")
    now = time.time() if now is None else now

    def number(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool)

    def apply(root):
        m = root.setdefault("mains", {})
        on, since = m.get("on"), now
        if now - m.get("seen", now) > MAINS_FLAT_SEC:
            # too long without data to know what happened in between: gather the evidence again
            on = None
            m.pop("level", None)
        m["seen"] = now
        if number(grid) and abs(grid) > MAINS_FLOW_W:
            on = True
            if number(stored):
                m.update(level=stored, level_ts=now)
        elif number(stored):
            level = m.get("level")
            if level is None:
                m.update(level=stored, level_ts=now)
            elif stored - level >= MAINS_STEP_WH:
                on = True  # charged between two polls
                m.update(level=stored, level_ts=now)
            elif level - stored >= MAINS_STEP_WH:
                on = False  # energy left the battery and the grid gave none
                m.update(level=stored, level_ts=now)
            elif now - m["level_ts"] >= MAINS_FLAT_SEC:
                on, since = True, m["level_ts"]  # holding its level, so the grid feeds the electronics
        if on != m.get("on"):
            m.update(on=on, since=since)
        if m.get("on") is not None:
            telemetry["mains"] = 1 if m["on"] else 0
            telemetry["mains_since"] = int(m["since"] * 1000)

    update_state(apply)


def add_period_energy(telemetry):
    try:
        integrate_output(telemetry)
    except Exception as e:
        print("output meter error:", e)
    for key, (prefix, section) in ENERGY_COUNTERS.items():
        if key in telemetry:
            try:
                telemetry.update(period_energy(float(telemetry[key]), prefix, section))
            except Exception as e:
                print("period energy error:", e)


def main():
    token = TB_ACCESS_TOKEN
    if not token:
        while True:
            try:
                jwt, device_id, token = provision()
                break
            except Exception as e:
                print("waiting for ThingsBoard:", e)
                time.sleep(10)
        try:
            print("dashboard:", dashboard.ensure(http, jwt, device_id, DEVICE_NAME))
        except Exception as e:
            print("dashboard creation failed:", e)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", PORT))
    global device
    device = Device(token, lambda method, params: handle_rpc(sock, method, params))
    device.start()
    restore_state()
    try:
        device.attributes(device_attributes(sock))
    except Exception as e:
        print("device info error:", e)
    print("polling %s:%s every %ss" % (HOST, PORT, INTERVAL))

    cycle = 0
    while True:
        try:
            if not restored and device.connected.is_set():
                restore_state()
            telemetry = poll(sock, cycle)
            add_period_energy(telemetry)
            try:
                detect_mains(telemetry)
            except Exception as e:
                print("mains detection error:", e)
            cycle += 1
            if telemetry:
                if device.telemetry(telemetry, int(time.time() * 1000)):
                    print("sent" if device.connected.is_set() else "queued, ThingsBoard unreachable", telemetry)
            else:
                print("no response from device")
        except Exception as e:
            print("error:", e)
        poll_now.wait(INTERVAL)
        poll_now.clear()


if __name__ == "__main__":
    main()
