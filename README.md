# Harveer WhatsApp — Cloud Bridge (Baileys, no Chromium)

Deploy once to a free cloud host. Pair your WhatsApp from the admin panel.
**No PC needed, runs 24/7.**

Why this exists: WhatsApp's protocol needs a persistent backend. Edge/serverless
can't keep a WhatsApp socket alive. Baileys is pure WebSocket → fits free tiers.

---

## ⚡ One-time setup

### 1. Generate a pairing token
Admin → **WhatsApp Hub → Bot → Generate pairing token**.
Copy the **WS URL** and **token**.

### 2. Pick a host (free tier)

#### Option A — Render (easiest, free)
1. Push this `cloud-bridge/` folder to a GitHub repo (or fork the project repo).
2. Go to https://render.com → **New → Blueprint** → pick the repo.
3. Render reads `render.yaml`. Fill the env vars when prompted:
   - `WS_URL` = the WS URL from step 1
   - `WS_TOKEN` = the token from step 1
   - `PAIR_PHONE` = (optional) your number in E.164, e.g. `919876543210`
4. Deploy. First run logs the pairing code. Or scan the QR shown live in the admin tab.

#### Option B — Fly.io (also free tier)
```bash
cd cloud-bridge
fly launch --no-deploy           # accept fly.toml
fly volumes create wa_auth --size 1 --region bom
fly secrets set WS_URL=wss://... WS_TOKEN=... PAIR_PHONE=919876543210
fly deploy
fly logs                          # watch for QR / pairing code
```

#### Option C — Railway
1. New project → Deploy from GitHub → pick repo, root = `cloud-bridge/`.
2. Add env vars `WS_URL`, `WS_TOKEN`, `PAIR_PHONE`.
3. Add a volume mounted at `/data` (1 GB).

### 3. Link your WhatsApp
- **QR**: open Admin → WhatsApp Hub → Bot → **Show QR / pair code**. The QR streams
  in live. Phone → WhatsApp → Linked Devices → Link a Device → scan.
- **8-digit code**: if you set `PAIR_PHONE`, the code shows in deploy logs and the
  admin tab. Phone → Linked Devices → Link with phone number → enter code.

Status pill flips to **Connected · +91…** ✅

---

## Re-pair / reset
Delete the `wa_auth` volume (or `/data/.wa-auth/`) and redeploy.

## Updating the token
Just update the `WS_TOKEN` env var on the host and restart the service.

## Troubleshooting
- **"Cloud closed, retrying"** → wrong/expired token. Regenerate in admin, update env, restart.
- **QR doesn't appear** → check the host logs. Token issue is most common.
- **Service sleeps on Render free** → upgrade to $7/mo Starter, or use Fly.io.
