import json
import os
import shutil
import sys
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "bridge"))
import dashboard  # noqa: E402

TB_URL = os.environ.get("TB_URL", "http://localhost:8081")
TB_API_KEY = os.environ.get("TB_API_KEY")
TB_USER = os.environ.get("TB_USER", "tenant@thingsboard.org")
TB_PASSWORD = os.environ.get("TB_PASSWORD", "tenant")
NICKNAME = os.environ.get("NICKNAME", "marstek")
VERSION = "1.0.0"
DEVICE = "Marstek Venus E"
PKG = os.path.join(HERE, "package")
ZIP = os.path.join(HERE, "marstek-venus-e-%s.zip" % VERSION)


def http(method, path, body=None, token=None):
    req = urllib.request.Request(TB_URL + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    if token:
        req.add_header("X-Authorization", ("ApiKey " if TB_API_KEY else "Bearer ") + token)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or "null")


def write_json(rel, data):
    path = os.path.join(PKG, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def write_text(rel, text):
    path = os.path.join(PKG, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


def number_predicate(op, value):
    return {"type": "NUMERIC", "operation": op,
            "value": {"defaultValue": value, "userValue": None, "dynamicValue": None}}


def temp_condition(op, value):
    return {"condition": [{"key": {"type": "TIME_SERIES", "key": "bat_bat_temp"}, "valueType": "NUMERIC",
                           "predicate": number_predicate(op, value)}],
            "spec": {"type": "SIMPLE"}}


def device_profile():
    return {
        "name": DEVICE,
        "description": "Marstek Venus E home battery polled over the local Open API (UDP) by the Venus E bridge",
        "type": "DEFAULT", "transportType": "DEFAULT", "provisionType": "DISABLED",
        "profileData": {
            "configuration": {"type": "DEFAULT"},
            "transportConfiguration": {"type": "DEFAULT"},
            "provisionConfiguration": {"type": "DISABLED", "provisionDeviceSecret": None},
            "alarms": [{
                "id": "high-battery-temperature", "alarmType": "High battery temperature",
                "createRules": {
                    "CRITICAL": {"condition": temp_condition("GREATER", 50), "schedule": None,
                                 "alarmDetails": None, "dashboardId": None},
                    "MAJOR": {"condition": temp_condition("GREATER", 40), "schedule": None,
                              "alarmDetails": None, "dashboardId": None}},
                "clearRule": {"condition": temp_condition("LESS", 38), "schedule": None,
                              "alarmDetails": None, "dashboardId": None},
                "propagate": False, "propagateToOwner": False, "propagateToTenant": False,
                "propagateRelationTypes": None}]}}


def natural(precision, start, low, high, inc, dec=(0, 0)):
    return {"type": "natural", "precision": precision,
            "minStartValue": start[0], "maxStartValue": start[1],
            "minLowValue": low[0], "maxLowValue": low[1],
            "minHighValue": high[0], "maxHighValue": high[1],
            "minIncrement": inc[0], "maxIncrement": inc[1],
            "minDecrement": dec[0] or inc[0], "maxDecrement": dec[1] or inc[1],
            "holidayMultiplier": 1.0, "workHoursMultiplier": 1.0, "nightHoursMultiplier": 1.0}


def emulator():
    profiles = [
        ("es_bat_soc", natural(0, (45, 55), (20, 30), (95, 100), (1, 3))),
        ("es_ongrid_power", natural(0, (-820, -780), (-900, -850), (0, 0), (40, 120))),
        ("es_offgrid_power", natural(0, (60, 90), (40, 55), (180, 220), (5, 20))),
        ("bat_bat_temp", natural(1, (25, 27), (22, 24), (30, 33), (0.1, 0.4))),
        ("bat_bat_capacity", natural(0, (2600, 2800), (1000, 1200), (4900, 5100), (30, 90))),
        ("grid_input_day", natural(0, (0, 20), (0, 20), (3500, 4500), (10, 60))),
        ("grid_input_month", natural(0, (20000, 25000), (20000, 25000), (90000, 110000), (20, 120))),
    ]
    return [{
        "name": "Venus E Emulator", "publishPeriodInDays": 7, "publishFrequencyInSeconds": 900,
        "publishPauseInMillis": 1, "activityPeriodInMillis": 720000,
        "telemetryProfiles": [{"key": k, "valueStrategy": s} for k, s in profiles] + [
            {"key": "es_mode", "valueStrategy": {"type": "enum", "values": ["Passive", "UPS", "Manual"]}}]}]


def build_dashboard(token):
    namespaced = {n: "tenant.%s.%s" % (NICKNAME, n) for n in dashboard.CUSTOM}
    configs = dashboard.default_configs(http_bound(token), token, ["time_series_chart"])
    config = dashboard.dashboard_config(configs, namespaced, DEVICE)
    config.pop("description", None)
    return {"title": dashboard.TITLE, "name": dashboard.TITLE, "image": None, "mobileHide": False,
            "mobileOrder": None, "configuration": config, "externalId": None, "resources": []}


def http_bound(token):
    return lambda method, path, body=None, token=None: http(method, path, body, token)


def widget_exports():
    for name in dashboard.CUSTOM:
        body = dashboard.widget_body(name, NICKNAME)
        body["deprecated"] = False
        body["tags"] = ["marstek", "battery", "energy"]
        yield body


def main():
    token = TB_API_KEY or http("POST", "/api/auth/login", {"username": TB_USER, "password": TB_PASSWORD})["token"]
    images = os.path.join(PKG, "images")
    keep = os.listdir(images) if os.path.isdir(images) else []
    saved = {f: open(os.path.join(images, f), "rb").read() for f in keep}
    shutil.rmtree(PKG, ignore_errors=True)
    os.makedirs(images)
    for f, data in saved.items():
        open(os.path.join(images, f), "wb").write(data)

    write_json("solution.json", {
        "title": "Marstek Venus E home battery", "installTimeoutMs": 0,
        "previewImageUrl": "images/preview.png",
        "imageUrls": ["images/" + f for f in ("gallery-1.png", "gallery-2.png") if f in keep]})
    for name in ("description.md", "instructions.md"):
        shutil.copy(os.path.join(HERE, "content", name), os.path.join(PKG, name))
    write_json("entities/devices.json", [{"name": DEVICE, "type": DEVICE, "emulator": "Venus E Emulator",
                                          "additionalInfo": {"description": "Marstek Venus E battery"}}])
    write_json("entities/assets.json", [])
    write_json("entities/customers.json", [])
    write_json("entities/rule_chains.json", [])
    write_json("entities/dashboards.json", [{"name": dashboard.TITLE, "file": "marstek_venus_e.json", "main": True}])
    write_json("entities/device_emulators.json", emulator())
    write_json("dashboards/marstek_venus_e.json", build_dashboard(token))
    write_json("device_profiles/marstek_venus_e.json", device_profile())

    widgets_dir = os.path.join(HERE, "widgets")
    shutil.rmtree(widgets_dir, ignore_errors=True)
    os.makedirs(widgets_dir)
    for w in widget_exports():
        with open(os.path.join(widgets_dir, w["fqn"].replace(".", "_") + ".json"), "w") as f:
            json.dump(w, f, indent=2)
            f.write("\n")

    if os.path.exists(ZIP):
        os.remove(ZIP)
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(PKG):
            for f in sorted(files):
                full = os.path.join(root, f)
                z.write(full, os.path.relpath(full, PKG))
    print("built", ZIP, os.path.getsize(ZIP), "bytes")


if __name__ == "__main__":
    main()
