# Marstek Venus E solution template (draft)

Draft package for ThingsBoard IoT Hub. Not published anywhere.

## Build

```
cd solution-template
NICKNAME=<creator nickname> python3 -I build.py
```

Needs the local ThingsBoard from `../docker-compose.yml` (default `http://localhost:8081`, `tenant@thingsboard.org` / `tenant`; override with `TB_URL`, `TB_USER`, `TB_PASSWORD`, or `TB_API_KEY` for tenants without a password, such as Google sign-in). Output: `marstek-venus-e-1.0.0.zip` (the template) and `widgets/*.json` (one file per custom widget, for separate Widget uploads).

## Contents

- `content/` description and instructions shown on the listing and after install
- `package/images/preview.png` preview (re-take after a real install; no gallery yet)
- `../bridge/` bridge source (`bridge.py`, `dashboard.py`, `widgets/`); the dashboard and widgets in the package are generated from it

## Open items before publishing

- Creator nickname: widget fqn must be `nickname.widget_fqn` (currently `marstek`)
- Publish the custom widgets first: `marstek.status_card`, `marstek.battery`, `marstek.flow`, `marstek.grid_status`, `marstek.controls`, `marstek.settings`
- Public repository and image for the bridge; replace `REPLACE_WITH_PUBLISHED_BRIDGE_IMAGE` in `content/instructions.md`
- Ask `iothub@thingsboard.io`: is a Solution Template that needs an external bridge allowed, and how to stop the emulator once a real device is connected
- Gallery screenshots after installing the template on a fresh tenant
- Minimum ThingsBoard version (tested on 4.4.0.2)
- The controls widget resizes its own `gridster-item` to fit its content; mention it to reviewers, it relies on ThingsBoard internals
- Writing DOD, windows and the Auto/AI modes to a real battery is untested; LED and Bluetooth were exercised by hand
