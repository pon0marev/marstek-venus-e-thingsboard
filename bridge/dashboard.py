import base64
import json
import os
import urllib.parse
import uuid

TITLE = "Marstek Venus E"
VERSION = "73"
COLS = 24
def realtime_window(ms):
    return {"displayValue": "", "selectedTab": 0,
            "realtime": {"realtimeType": 0, "interval": 60000, "timewindowMs": ms},
            "aggregation": {"type": "NONE", "limit": 5000}}


TW_MAIN = realtime_window(6 * 3600 * 1000)
TW_DAY = realtime_window(24 * 3600 * 1000)
# A calendar window: its one-day buckets start at midnight. A "last N days" window slides with the clock,
# so its buckets would run from noon to noon when the dashboard is opened at noon.
TW_DAILY_BARS = {"displayValue": "", "selectedTab": 0,
                 "realtime": {"realtimeType": 1, "quickInterval": "CURRENT_MONTH", "interval": 24 * 3600 * 1000,
                              "timewindowMs": 14 * 24 * 3600 * 1000},
                 "aggregation": {"type": "MAX", "limit": 1000}}
TW_MONTH = {"selectedTab": 1,
            "history": {"historyType": 0, "interval": 7200000, "timewindowMs": 30 * 24 * 3600 * 1000},
            "aggregation": {"type": "MAX", "limit": 1000}}
POPUP_WINDOW = {"grid_input_month": TW_MONTH, "battery_output_month": TW_MONTH}
POPUP_ROWS = 16
ROW_SCALE = 1
CARD_ROWS = 1
SETTINGS_ROWS = 6
GRID = {"columns": COLS, "margin": 6, "outerMargin": True, "backgroundSizeMode": "100%"}

PALETTES = {
    "dark": {"PAGE": "#0B0C0D", "TEXT": "#E8E6E1", "MUTED": "#8A8F94", "AXIS": "#7A7F85", "CHARGE": "#6EE7A0", "SILVER": "#C9CDD1",
             "WARM": "#E8B170", "CORAL": "#D9694F", "SPLIT": "rgba(255,255,255,.05)", "ZERO": "rgba(255,255,255,.18)",
             "RESERVE": "rgba(217,105,79,.6)", "TOOLTIP": "rgba(18,19,21,.94)", "IMAGE": "battery_cut"},
    "light": {"PAGE": "#E4E1DA", "TEXT": "#17181A", "MUTED": "#5E6266", "AXIS": "#5E6266", "CHARGE": "#0B7A53", "SILVER": "#55595E",
              "WARM": "#A85A12", "CORAL": "#B23A22", "SPLIT": "rgba(0,0,0,.07)", "ZERO": "rgba(0,0,0,.25)",
              "RESERVE": "rgba(178,58,34,.6)", "TOOLTIP": "rgba(241,238,232,.96)", "IMAGE": "battery_light"},
}
THEME = "dark"
PAL = PALETTES[THEME]
FONT = "IBM Plex Sans, Roboto, sans-serif"
WIDGET_NS = os.environ.get("TB_WIDGET_NAMESPACE", "marstek")

HERO_COLS = 8
CARD_COLS = 4
# Optional device whose telemetry key is above 0 while mains power is present; adds a timeline strip.
GRID_DEVICE = os.environ.get("TB_GRID_DEVICE")
GRID_KEY = os.environ.get("TB_GRID_KEY", "power")

def cards():
    SILVER, WARM, MUTED = PAL["SILVER"], PAL["WARM"], PAL["MUTED"]
    # label, key, units, decimals, icon, color, divisor, kind, sparkline range, (row, col, width)
    return [
        ("Mode", "es_mode", "", None, "tune", SILVER, None, "mode", None, (0, HERO_COLS, CARD_COLS)),
        ("Grid", "es_ongrid_power", "W", 0, "bolt", SILVER, None, "grid", None, (0, HERO_COLS + CARD_COLS, CARD_COLS)),
        ("Sockets", "es_offgrid_power", "W", 0, "power", WARM, None, None, None, (0, HERO_COLS + 2 * CARD_COLS, CARD_COLS)),
        ("Temperature", "bat_bat_temp", "°C", 1, "thermostat", MUTED, None, "temp", None, (0, HERO_COLS + 3 * CARD_COLS, CARD_COLS)),
        ("Grid input today", "grid_input_day", "kWh", 2, "today", SILVER, 1000, None, None, (1, HERO_COLS, CARD_COLS)),
        ("Battery output today", "battery_output_day", "kWh", 2, "today", WARM, 1000, None, None, (1, HERO_COLS + CARD_COLS, CARD_COLS)),
        ("Grid input month", "grid_input_month", "kWh", 2, "calendar_month", SILVER, 1000, None, None, (1, HERO_COLS + 2 * CARD_COLS, CARD_COLS)),
        ("Battery output month", "battery_output_month", "kWh", 2, "calendar_month", WARM, 1000, None, None, (1, HERO_COLS + 3 * CARD_COLS, CARD_COLS)),
    ]


STATE_NAMES = {"default": TITLE, "controls": "Battery control", "settings": "Settings"}

def chart_specs():
    CHARGE, SILVER, WARM, MUTED, CORAL = PAL["CHARGE"], PAL["SILVER"], PAL["WARM"], PAL["MUTED"], PAL["CORAL"]
    # key -> title, icon, units, decimals, colour, divisor, threshold lines (value, colour)
    return {
        "es_bat_soc": ("Charge", "battery_full", "%", 0, CHARGE, None, []),
        "es_ongrid_power": ("Grid", "bolt", "W", 0, SILVER, None, [(0, PAL["ZERO"])]),
        "es_offgrid_power": ("Sockets", "power", "W", 0, WARM, None, []),
        "bat_bat_temp": ("Temperature", "thermostat", "°C", 1, MUTED, None, [(40, WARM), (50, CORAL)]),
        "bat_bat_capacity": ("Stored energy", "battery_charging_full", "Wh", 0, CHARGE, None, []),
        "grid_input_day": ("Grid input today", "today", "kWh", 2, SILVER, 1000, []),
        "grid_input_month": ("Grid input month", "calendar_month", "kWh", 2, SILVER, 1000, []),
        "battery_output_day": ("Battery output today", "today", "kWh", 2, WARM, 1000, []),
        "battery_output_month": ("Battery output month", "calendar_month", "kWh", 2, WARM, 1000, []),
    }


def use_theme(theme):
    global THEME, PAL, CHART_SPECS
    THEME, PAL = theme, PALETTES[theme]
    CHART_SPECS = chart_specs()


def state_id(name):
    """A theme is a set of states: the page colour and chart colours are fixed per state."""
    return name if THEME == "dark" else name + "_day"


CHART_SPECS = chart_specs()
Y_RANGE = {"es_bat_soc": (0, 100), "bat_bat_temp": (0, 60)}

WIDGETS_DIR = os.path.join(os.path.dirname(__file__), "widgets")
CUSTOM = {"status_card": "Marstek status card", "battery": "Marstek battery card", "flow": "Marstek energy flow",
          "grid_status": "Marstek mains timeline", "controls": "Marstek controls",
          "settings": "Marstek battery settings"}
CUSTOM_TYPE = {"status_card": "timeseries", "battery": "timeseries", "flow": "timeseries", "grid_status": "timeseries",
               "controls": "rpc", "settings": "rpc"}
CUSTOM_SIZE = {"status_card": (6, 1), "battery": (12, 2), "flow": (8, 3), "grid_status": (24, 1),
               "controls": (24, 8), "settings": (24, 5)}


def image_uri(name):
    with open(os.path.join(WIDGETS_DIR, "img", name + ".webp"), "rb") as f:
        return "data:image/webp;base64," + base64.b64encode(f.read()).decode()


def read(name, ext):
    with open(os.path.join(WIDGETS_DIR, name + "." + ext)) as f:
        return f.read()


def widget_body(name, namespace=None):
    namespace = namespace or WIDGET_NS
    title = CUSTOM[name]
    sx, sy = CUSTOM_SIZE[name]
    descriptor = {
        "type": CUSTOM_TYPE[name], "sizeX": sx, "sizeY": sy, "resources": [],
        "templateHtml": read(name, "html"), "templateCss": read(name, "css"),
        "controllerScript": (read("fonts", "js") + read("theme", "js") if name in ("battery", "settings") else "") + read(name, "js"),
        "settingsSchema": "{}", "dataKeySettingsSchema": "{}", "settingsDirective": "",
        "defaultConfig": json.dumps({
            "datasources": [], "showTitle": False, "backgroundColor": "rgba(0, 0, 0, 0)",
            "color": "rgba(0, 0, 0, 0.87)", "padding": "0px", "margin": "0px", "settings": {},
            "title": title, "dropShadow": False, "enableFullscreen": False, "widgetStyle": {},
            "actions": {}, "showLegend": False, "targetDevice": None}),
    }
    return {"fqn": namespace + "." + name, "name": title, "descriptor": descriptor}


def upsert_widgets(http, jwt):
    existing = {t["fqn"]: t for t in http("GET", "/api/widgetTypes?pageSize=1000&page=0&tenantOnly=true",
                                          token=jwt)["data"]}
    fqns = {}
    for name in CUSTOM:
        body = widget_body(name)
        if body["fqn"] in existing:
            body["id"] = existing[body["fqn"]]["id"]
        saved = http("POST", "/api/widgetType", body, token=jwt)
        fqns[name] = "tenant." + saved["fqn"]
    return fqns


def default_configs(http, jwt, fqns):
    types = http("GET", "/api/widgetTypes?pageSize=1000&page=0", token=jwt)["data"]
    ids = {t["fqn"]: t["id"]["id"] for t in types}
    out = {}
    for fqn in fqns:
        d = http("GET", "/api/widgetType/" + ids[fqn], token=jwt)["descriptor"]
        out[fqn] = (d["type"], json.loads(d["defaultConfig"]))
    return out


def datasource(alias_id, keys):
    return [{"type": "entity", "entityAliasId": alias_id, "dataKeys": [
        {"name": n, "type": "timeseries", "label": label, "color": color, "settings": {}}
        for n, label, color in keys]}]


def clone(x):
    return json.loads(json.dumps(x))


def axis_limit(value):
    return {"type": "constant", "value": value, "entityAlias": None}


def style_chart(cfg, ticks=None):
    """Quiet chart: no vertical grid or axis lines, faint horizontals, one typeface."""
    font = lambda size: {"family": FONT, "size": size, "sizeUnit": "px", "style": "normal", "weight": "400", "lineHeight": "1.3"}
    TEXT, MUTED, AXIS = PAL["TEXT"], PAL["MUTED"], PAL["AXIS"]
    cfg.update(backgroundColor="rgba(0,0,0,0)", color=TEXT, dropShadow=False, borderRadius="0px", showTitleIcon=False,
               displayTimewindow=False, titleColor=MUTED, titleFont=font(12),
               padding="8px 18px", titleStyle={"text-transform": "uppercase"},
               # the platform resets letter spacing on the title style, so it has to come from widget CSS
               widgetCss=".tb-widget-title .title { letter-spacing: .14em !important; }")
    settings = cfg["settings"]
    settings["background"] = {"type": "color", "color": "rgba(0,0,0,0)",
                              "overlay": {"enabled": False, "color": "rgba(0,0,0,0)", "blur": 3}}
    settings.update(legendLabelColor=MUTED, legendLabelFont=font(12), tooltipBackgroundColor=PAL["TOOLTIP"],
                    tooltipLabelColor=TEXT, tooltipValueColor=TEXT, tooltipDateColor=MUTED, padding="0")
    for axis in settings["yAxes"].values():
        axis.update(showLine=False, showTicks=False, showSplitLines=True, splitLinesColor=PAL["SPLIT"],
                    tickLabelColor=AXIS, tickLabelFont=font(11), labelColor=AXIS)
    settings["xAxis"].update(showLine=False, showTicks=False, showSplitLines=False, tickLabelColor=AXIS, tickLabelFont=font(11),
                             ticksFormat=ticks or {})
    return cfg


def add_reserve_line(cfg, units, decimals, y_axis="default"):
    """Draw the backup reserve (100 - depth of discharge) from the last DOD known to ThingsBoard."""
    cfg["datasources"][0]["latestDataKeys"] = [
        {"name": "dod", "type": "attribute", "label": "Backup reserve", "color": PAL["CORAL"], "settings": {},
         "usePostProcessing": True, "postFuncBody": "return 100 - value;"}]
    cfg["settings"]["thresholds"] = cfg["settings"]["thresholds"] + [
        {"type": "latestKey", "latestKey": "dod", "latestKeyType": "attribute", "yAxisId": y_axis,
         "units": units, "decimals": decimals, "lineColor": PAL["RESERVE"], "lineType": "dashed", "lineWidth": 1,
         "startSymbol": "none", "endSymbol": "none", "showLabel": True, "labelPosition": "end", "labelColor": PAL["CORAL"]}]


# The battery reports output as positive; charts show charging going up and discharging going down.
BATTERY_VIEW_KEYS = {"es_ongrid_power", "es_offgrid_power"}


def series_key(key, y_axis="default", fill=True, legend=False):
    title, _, units, decimals, color, div, _ = CHART_SPECS[key]
    area = {"type": "gradient", "opacity": 1, "gradient": {"start": 12, "end": 0}} if fill else {"type": "none"}
    data_key = {"name": key, "type": "timeseries", "label": title, "color": color,
                "units": units, "decimals": decimals,
                "settings": {"yAxisId": y_axis, "showInLegend": legend, "dataHiddenByDefault": False,
                             "type": "line",
                             "lineSettings": {"showLine": True, "step": False, "smooth": True, "lineWidth": 1.5,
                                              "showPoints": False, "showPointLabel": False,
                                              "fillAreaSettings": area}}}
    if div:
        data_key.update(usePostProcessing=True, postFuncBody="return value / %d;" % div)
    if key in BATTERY_VIEW_KEYS:
        data_key.update(usePostProcessing=True, postFuncBody="return value ? -value : 0;")
    return data_key


def chart_config(base, alias_id, key, popup=False):
    title, icon, units, decimals, color, div, thresholds = CHART_SPECS[key]
    data_key = series_key(key)
    cfg = clone(base)
    cfg["datasources"] = [{"type": "entity", "entityAliasId": alias_id, "dataKeys": [data_key]}]
    cfg.update(title=title, showTitle=True, showTitleIcon=True, titleIcon=icon, iconColor=color,
               useDashboardTimewindow=True, units=units, decimals=decimals, dropShadow=False,
               borderRadius="14px", enableFullscreen=False, enableDataExport=False)
    cfg["settings"].update(showLegend=False, dataZoom=popup, stack=False)
    if popup:
        cfg.update(useDashboardTimewindow=False, timewindow=POPUP_WINDOW.get(key, TW_DAY))
    cfg["settings"]["yAxes"]["default"].update(units=units, decimals=decimals)
    if key in Y_RANGE:
        # a bare 0 is treated as "not set" by the chart, so pass limits as value sources
        cfg["settings"]["yAxes"]["default"].update(min=axis_limit(Y_RANGE[key][0]), max=axis_limit(Y_RANGE[key][1]))
    cfg["settings"]["thresholds"] = [
        {"type": "constant", "value": v, "yAxisId": "default", "units": units, "decimals": decimals,
         "lineColor": c, "lineType": "dashed", "lineWidth": 1, "startSymbol": "none", "endSymbol": "none",
         "showLabel": True, "labelPosition": "end", "labelColor": c} for v, c in thresholds]
    if key == "es_bat_soc":
        add_reserve_line(cfg, units, decimals)
        cfg["settings"]["yAxes"]["default"]["interval"] = 50
    return style_chart(cfg)


def power_chart_config(base, alias_id):
    cfg = chart_config(base, alias_id, "es_ongrid_power")
    cfg["datasources"][0]["dataKeys"] = [
        series_key("es_ongrid_power", fill=False, legend=True),
        series_key("es_offgrid_power", fill=False, legend=True)]
    cfg.update(title="Power", showLegend=True)
    cfg["settings"]["showLegend"] = True
    cfg["settings"]["legendConfig"].update(position="top", direction="row", showMin=False, showMax=False,
                                           showAvg=False, showTotal=False, showLatest=False)
    cfg["settings"]["yAxes"]["default"]["splitNumber"] = 2
    for threshold in cfg["settings"]["thresholds"]:
        threshold["showLabel"] = False
    return style_chart(cfg)


def energy_chart_config(base, alias_id):
    """Energy per calendar day: the bridge's daily counters restart at midnight, so a day's bar is their maximum."""
    cfg = chart_config(base, alias_id, "grid_input_month")
    cfg["datasources"][0]["dataKeys"] = [
        {"name": key, "type": "timeseries", "label": label, "color": color, "units": "kWh", "decimals": 2,
         "usePostProcessing": True, "postFuncBody": "return value / 1000;",
         "settings": {"yAxisId": "default", "showInLegend": True, "dataHiddenByDefault": False, "type": "bar"}}
        for key, label, color in (("grid_input_day", "Grid input", PAL["SILVER"]),
                                  ("battery_output_day", "Battery output", PAL["WARM"]))]
    cfg.update(title="Energy per day", showLegend=True,
               useDashboardTimewindow=False, timewindow=TW_DAILY_BARS)
    cfg["settings"]["showLegend"] = True
    cfg["settings"]["legendConfig"].update(position="top", direction="row", showMin=False, showMax=False,
                                           showAvg=False, showTotal=False, showLatest=False)
    cfg["settings"]["yAxes"]["default"]["splitNumber"] = 2
    return style_chart(cfg, {"day": "MMM dd", "month": "MMM dd"})


def build(configs, custom, alias_id, widgets, layouts, grid_alias=None):
    SILVER, CHARGE, CORAL = PAL["SILVER"], PAL["CHARGE"], PAL["CORAL"]

    def add(fqn, wtype, config, w, h, row, col, state="default"):
        if state == "default":
            h, row = int(round(h * ROW_SCALE)), int(round(row * ROW_SCALE))
        wid = str(uuid.uuid4())
        if not fqn.startswith("system."):
            config.setdefault("settings", {})["theme"] = THEME
        widgets[wid] = {"id": wid, "typeFullFqn": fqn, "type": wtype,
                        "sizeX": w, "sizeY": h, "row": row, "col": col, "config": config}
        layouts.setdefault(state_id(state), {})[wid] = {"sizeX": w, "sizeY": h, "row": row, "col": col}

    def custom_cfg():
        return {"datasources": [], "showTitle": False, "backgroundColor": "rgba(0, 0, 0, 0)",
                "color": "rgba(0, 0, 0, 0.87)", "padding": "0px", "margin": "0px", "settings": {},
                "dropShadow": False, "enableFullscreen": False, "widgetStyle": {}, "actions": {},
                "showLegend": False, "enableDataExport": False}

    base = configs["time_series_chart"][1]
    for key in CHART_SPECS:
        add("system.time_series_chart", "timeseries", chart_config(base, alias_id, key, popup=True),
            COLS, POPUP_ROWS, 0, 0, state="chart_" + key)

    cfg = custom_cfg()
    cfg["datasources"] = [{"type": "entity", "entityAliasId": alias_id, "dataKeys": [
        {"name": n, "type": "timeseries", "label": n, "color": CHARGE, "settings": {}}
        # mains (1 or 0) and mains_since are worked out by the bridge: the battery does not report them
        for n in ("es_bat_soc", "bat_bat_capacity", "bat_rated_capacity", "es_ongrid_power", "es_offgrid_power",
                  "mains", "mains_since")],
        "latestDataKeys": [{"name": "dod", "type": "attribute", "label": "dod", "color": CORAL, "settings": {}}]}]
    cfg["actions"] = {"cardClick": [{
        "id": str(uuid.uuid4()), "name": "Show chart", "icon": "show_chart",
        "type": "openDashboardState", "targetDashboardStateId": state_id("chart_es_bat_soc"),
        "openRightLayout": False, "setEntityId": False, "stateEntityParamName": None,
        "openInSeparateDialog": True, "dialogTitle": CHART_SPECS["es_bat_soc"][0],
        "dialogHideDashboardToolbar": True}]}
    cfg["settings"] = {"image": image_uri(PAL["IMAGE"])}

    top = 2
    if grid_alias:
        strip = custom_cfg()
        strip["datasources"] = datasource(grid_alias, [(GRID_KEY, "Mains power", CHARGE)])
        add(custom["grid_status"], "timeseries", strip, COLS - HERO_COLS, 1, top, HERO_COLS)
        top += 1
    add(custom["battery"], "timeseries", cfg, HERO_COLS, top + 10, 0, 0)

    for label, key, units, decimals, icon, color, div, kind, spark, (row, col, w) in cards():
        cfg = custom_cfg()
        cfg["datasources"] = datasource(alias_id, [(key, label, color)] +
                                        ([("mains", "mains", color)] if kind == "grid" else []))
        cfg["settings"] = {"label": label, "units": units, "decimals": decimals, "icon": icon,
                           "color": color, "divisor": div, "kind": kind, "spark": spark}
        if kind == "mode":
            cfg["settings"].update(gear=True, showAge=True, hint="Controls ›")
            cfg["actions"] = {"gearClick": [{
                "id": str(uuid.uuid4()), "name": "Battery settings", "icon": "settings",
                "type": "openDashboardState", "targetDashboardStateId": state_id("settings"),
                "openRightLayout": False, "setEntityId": False, "stateEntityParamName": None,
                "openInSeparateDialog": True, "dialogTitle": "Settings",
                "dialogHideDashboardToolbar": True, "dialogWidth": 70, "dialogHeight": 46}],
                "cardClick": [{
                    "id": str(uuid.uuid4()), "name": "Open battery control", "icon": "tune",
                    "type": "openDashboardState", "targetDashboardStateId": state_id("controls"),
                    "openRightLayout": False, "setEntityId": False, "stateEntityParamName": None}]}
        if key in CHART_SPECS:
            title = CHART_SPECS[key][0]
            cfg["actions"] = {"cardClick": [{
                "id": str(uuid.uuid4()), "name": "Show chart", "icon": "show_chart",
                "type": "openDashboardState", "targetDashboardStateId": state_id("chart_" + key),
                "openRightLayout": False, "setEntityId": False, "stateEntityParamName": None,
                "openInSeparateDialog": True, "dialogTitle": title,
                "dialogHideDashboardToolbar": True}]}
        add(custom["status_card"], "timeseries", cfg, w, CARD_ROWS, row, col)

    right = COLS - HERO_COLS
    cfg = custom_cfg()
    cfg["datasources"] = datasource(alias_id, [(n, n, SILVER) for n in ("es_ongrid_power", "es_offgrid_power", "es_bat_soc", "mains")])
    add(custom["flow"], "timeseries", cfg, right, 2, top, HERO_COLS)
    add("system.time_series_chart", "timeseries", chart_config(base, alias_id, "es_bat_soc"), right, 3, top + 2, HERO_COLS)
    add("system.time_series_chart", "timeseries", power_chart_config(base, alias_id), right, 3, top + 5, HERO_COLS)
    add("system.time_series_chart", "timeseries", energy_chart_config(base, alias_id), right, 2, top + 8, HERO_COLS)

    cfg = custom_cfg()
    cfg["targetDevice"] = {"type": "entity", "entityAliasId": alias_id}
    cfg["targetDeviceAliasIds"] = [alias_id]
    cfg["settings"] = {"maxPower": 2500}
    add(custom["controls"], "rpc", cfg, COLS, 8, 0, 0, state="controls")

    cfg = custom_cfg()
    cfg["targetDevice"] = {"type": "entity", "entityAliasId": alias_id}
    cfg["targetDeviceAliasIds"] = [alias_id]
    add(custom["settings"], "rpc", cfg, COLS, SETTINGS_ROWS, 0, 0, state="settings")
    return widgets, layouts


def base_state(name):
    return name[:-len("_day")] if name.endswith("_day") else name


def dashboard_config(configs, custom, device_name):
    alias_id = str(uuid.uuid4())
    grid_alias = str(uuid.uuid4()) if GRID_DEVICE else None
    widgets, layouts = {}, {}
    pages = {}
    for theme in PALETTES:
        use_theme(theme)
        before = set(layouts)
        build(configs, custom, alias_id, widgets, layouts, grid_alias)
        pages.update({name: PAL["PAGE"] for name in set(layouts) - before})
    use_theme("dark")
    aliases = {alias_id: {"id": alias_id, "alias": device_name, "filter": {
        "type": "entityName", "resolveMultiple": False, "entityType": "DEVICE", "entityNameFilter": device_name}}}
    if grid_alias:
        aliases[grid_alias] = {"id": grid_alias, "alias": GRID_DEVICE, "filter": {
            "type": "entityName", "resolveMultiple": False, "entityType": "DEVICE", "entityNameFilter": GRID_DEVICE}}
    return {
        "description": "v" + VERSION,
        "widgets": widgets,
        "states": {name: {"name": STATE_NAMES.get(base_state(name), base_state(name)), "root": name == "default",
                          "layouts": {"main": {"widgets": layout,
                                    "gridSettings": dict(GRID, backgroundColor=pages[name],
                                                         autoFillHeight=base_state(name) == "default")}}}
                   for name, layout in layouts.items()},
        "entityAliases": aliases,
        "timewindow": TW_MAIN,
        "settings": {"stateControllerId": "entity", "showTitle": False, "showDashboardsSelect": False,
                     "showEntitiesSelect": False, "showFilters": False, "showDashboardTimewindow": True,
                     "showDashboardExport": True, "toolbarAlwaysOpen": True},
        "filters": {},
    }


def ensure(http, jwt, device_id, device_name):
    custom = upsert_widgets(http, jwt)
    found = http("GET", "/api/tenant/dashboards?pageSize=10&page=0&textSearch=" + urllib.parse.quote(TITLE),
                 token=jwt)["data"]
    for d in found:
        if d["title"] != TITLE:
            continue
        cur = http("GET", "/api/dashboard/" + d["id"]["id"], token=jwt)
        if (cur.get("configuration") or {}).get("description") == "v" + VERSION:
            return "exists"
        # saved under the same id, so links and bookmarks to the dashboard keep working
        cur["configuration"] = dashboard_config(default_configs(http, jwt, ["time_series_chart"]), custom, device_name)
        http("POST", "/api/dashboard", cur, token=jwt)
        return "updated " + d["id"]["id"]

    config = dashboard_config(default_configs(http, jwt, ["time_series_chart"]), custom, device_name)
    d = http("POST", "/api/dashboard", {"title": TITLE, "configuration": config}, token=jwt)
    return "created " + d["id"]["id"]
