## Marstek Venus E setup

The demo device **Marstek Venus E** is already filled with simulated data, so you can explore the [main dashboard](${MAIN_DASHBOARD_URL}) right away. The steps below connect your real battery.

### Step 1: Enable the Open API on the battery

Open the Marstek app, select your Venus E and turn on **Open API**. Note the battery IP address and the UDP port (default 30000).

### Step 2: Copy the device access token

Open the **Marstek Venus E** device in ThingsBoard, press **Copy access token** and keep it for the next step.

### Step 3: Run the bridge

The bridge polls the battery over UDP and forwards telemetry to ThingsBoard. It must run on a machine in the same network as the battery. Save the file below as `docker-compose.yml`, fill in the three values and start it.

```bash
cat > docker-compose.yml <<'YAML'
services:
  marstek-bridge:
    image: REPLACE_WITH_PUBLISHED_BRIDGE_IMAGE
    restart: unless-stopped
    environment:
      MARSTEK_HOST: 192.168.1.50
      TB_URL: https://YOUR_THINGSBOARD_HOST
      TB_ACCESS_TOKEN: YOUR_DEVICE_ACCESS_TOKEN
      TZ: Europe/Kyiv
    volumes:
      - bridge-data:/data
volumes:
  bridge-data:
YAML
docker compose up -d
```{:copy-code}

### Step 4: Open the dashboard

Open the [main dashboard](${MAIN_DASHBOARD_URL}). Cards refresh every minute and turn grey when no data has arrived for 3 minutes. Click a card to see its trend.

### Using the controls

- Click the **Mode** card to open the **Battery control** page; monitoring stays on the main page. The status line shows the active mode and what the battery is doing right now. Click a tile to see what the mode does and how to configure it.
- **Auto**, **AI** and **UPS** are switched on with one button. **Passive** charges or discharges at a chosen power for a chosen number of minutes. **Manual** is a weekly schedule of up to 10 windows: add them with **Add window**, edit them in place and press **Apply** to write the whole schedule to the battery in one go. Tick "Clear all other slots" to make the battery schedule match the list exactly.
- The battery cannot report its own windows, so ThingsBoard remembers what was last applied (device attribute `manual_windows`) and restores it if the bridge is redeployed. Windows created in the Marstek app are not shown until you apply from here.
- Every command asks for confirmation. Switching modes replaces the current mode and its schedule. A Manual schedule cannot be read back from the battery, so it cannot be restored from ThingsBoard.
- **Battery settings** open from the gear on the Mode card. **Charge power** there sets how fast the battery charges whenever grid power is available. The battery has no setting for this, only a power per Manual window, so the dashboard writes one window that charges all day, every day, at the chosen power and makes it the whole schedule. Windows created in the Marstek app are erased. To charge at some power for a limited time only, use **Passive**.
- The same page sets the depth of discharge (30-88%), the LED and Bluetooth advertising; Marstek documents these three commands for firmware 150 or newer, although a Venus E 3.0 on firmware 148 accepts them. The battery cannot report them back, so the dashboard shows the last value recorded from it; **Record** next to the depth of discharge stores a value you set in the Marstek app without sending it, so the reserve on the battery card is right.
- **Allow discharge to grid** is off by default. While it is off, Auto and AI are locked and discharge is unavailable in Passive and Manual. The setting is enforced by the bridge and is remembered across restarts.

### Notes

- The battery drops UDP packets when polled too often, so the bridge polls once a minute.
- The bridge talks to ThingsBoard over MQTT, on the host named in `TB_URL`: port 8883 with TLS when `TB_URL` starts with https, port 1883 without TLS otherwise. Set `TB_MQTT_HOST`, `TB_MQTT_PORT` and `TB_MQTT_TLS` (`true`/`false`) in the bridge environment if your MQTT endpoint differs. Readings taken while ThingsBoard is unreachable are kept in the bridge's memory and delivered with their own timestamps once the link is back; the buffer holds 2000 readings (about 33 hours), newer readings are dropped once it is full, and it is lost if the bridge restarts meanwhile.
- Marstek warns that enabling the Local API may disable some built-in features of the device to avoid command conflicts. Give the battery a static IP address and consider a UDP port between 49152 and 65535 instead of the default 30000.
- To start with discharging allowed, add `ALLOW_DISCHARGE: "true"` to the bridge environment. The dashboard switch overrides it afterwards.
- Daily and monthly grid input are computed by the bridge from the battery counter and kept in the `bridge-data` volume.
- The battery does not report whether grid power is present, and a full battery shows the same 0 W from the grid as a battery in an outage. The bridge works it out from the stored energy: without the grid the battery runs its own electronics and keeps losing energy. An outage with nothing plugged in is noticed within about 10 minutes, the return of grid power as soon as the battery starts charging. During an outage the Grid card reads Off and the battery card says since when it has been discharging.
- The demo data is simulated. Once the bridge sends real telemetry, the same dashboard shows your battery.

For more about dashboards see the [ThingsBoard documentation](${DOCS_BASE_URL}/docs/user-guide/dashboards/).
