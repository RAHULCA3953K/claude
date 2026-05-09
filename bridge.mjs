// Harveer Drycleaners — Cloud WhatsApp Bridge (Baileys, no Chromium)
// Deploy this to Render / Railway / Fly.io. It connects outbound (WSS) to
// Lovable Cloud and forwards QR / pairing code / messages live to the admin tab.
//
// Required env vars:
//   WS_URL    e.g. wss://<project>.functions.supabase.co/wa-bridge-ws
//   WS_TOKEN  pairing token from Admin → WhatsApp Hub → Generate pairing token
// Optional:
//   PAIR_PHONE  E.164 number (e.g. 919876543210) to request 8-digit pair code on first run
//
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import WebSocket from "ws";
import pino from "pino";
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from "@whiskeysockets/baileys";

const WS_URL = process.env.WS_URL;
const WS_TOKEN = process.env.WS_TOKEN;
const PAIR_PHONE = process.env.PAIR_PHONE;
const AUTH_DIR = process.env.AUTH_DIR || "./.wa-auth";

if (!WS_URL || !WS_TOKEN) {
  console.error("❌ WS_URL and WS_TOKEN env vars are required");
  process.exit(1);
}
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

const logger = pino({ level: "warn" });
const wsFullUrl = `${WS_URL}?token=${encodeURIComponent(WS_TOKEN)}`;

let ws = null;
let wsReady = false;
const outbox = [];
let sock = null;

function send(obj) {
  if (ws && wsReady) {
    try { ws.send(JSON.stringify(obj)); return; } catch {}
  }
  outbox.push(obj);
}

function connectWS() {
  console.log("🔌 Cloud connecting →", WS_URL);
  ws = new WebSocket(wsFullUrl);
  ws.on("open", () => {
    wsReady = true;
    console.log("✅ Cloud connected");
    while (outbox.length) ws.send(JSON.stringify(outbox.shift()));
  });
  ws.on("message", async (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === "ping") return send({ type: "pong" });
    if (m.type === "request_qr") return; // emitted automatically
    if (m.type === "request_pair_code") {
      try {
        if (!sock) return send({ type: "pair_code", error: "socket not ready" });
        const code = await sock.requestPairingCode(String(m.phone).replace(/\D/g, ""));
        send({ type: "pair_code", code, phone: m.phone });
      } catch (e) {
        send({ type: "pair_code", error: String(e?.message || e) });
      }
      return;
    }
    if (m.type === "logout") { try { await sock?.logout(); } catch {}; return; }
    if (m.type === "restart") { process.exit(0); }
    if (m.type === "send") {
      const id = m.id;
      try {
        const jid = String(m.to).replace(/\D/g, "") + "@s.whatsapp.net";
        if (m.mediaUrl) {
          const res = await fetch(m.mediaUrl);
          const buf = Buffer.from(await res.arrayBuffer());
          const mime = res.headers.get("content-type") || "";
          const isVideo = /^video\//.test(mime);
          await sock.sendMessage(jid, isVideo
            ? { video: buf, caption: m.caption || m.body || "" }
            : { image: buf, caption: m.caption || m.body || "" });
        } else {
          await sock.sendMessage(jid, { text: m.body || "" });
        }
        send({ type: "message_sent", id, ok: true });
      } catch (e) {
        send({ type: "message_sent", id, ok: false, error: String(e?.message || e) });
      }
    }
  });
  ws.on("close", () => { wsReady = false; console.log("⚠️  Cloud closed, retrying in 3s"); setTimeout(connectWS, 3000); });
  ws.on("error", (e) => console.log("WS err:", e.message));
}

async function startWA() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: Browsers.macOS("Chrome"),
    syncFullHistory: false,
  });

  // Optional: request pairing code on first run if not registered
  if (PAIR_PHONE && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PAIR_PHONE.replace(/\D/g, ""));
        console.log("🔢 Pairing code:", code);
        send({ type: "pair_code", code, phone: PAIR_PHONE });
      } catch (e) { console.log("pair err", e?.message); }
    }, 3000);
  }

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr, { width: 320 });
      console.log("📱 QR ready (also shown in admin panel)");
      send({ type: "qr", qr: dataUrl });
    }
    if (connection === "open") {
      const me = sock.user?.id?.split(":")[0] || null;
      console.log("✅ WhatsApp ready:", me);
      send({ type: "ready", phone: me });
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      console.log("⚠️ Disconnected", code, "reconnect:", reconnect);
      send({ type: "disconnected", reason: String(code) });
      if (reconnect) setTimeout(startWA, 2000);
    }
  });
  sock.ev.on("messages.upsert", ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      if (msg.key.remoteJid?.endsWith("@g.us")) continue;
      const body =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        "";
      send({
        type: "message_in",
        from: msg.key.remoteJid?.replace("@s.whatsapp.net", ""),
        body,
        id: msg.key.id,
      });
    }
  });
}

connectWS();
startWA().catch((e) => { console.error("Fatal:", e); process.exit(1); });
