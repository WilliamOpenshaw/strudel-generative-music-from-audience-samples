/**
 * server.js — Lightweight Express + WebSocket server for the Strudel Dashboard.
 *
 * In development:  Uses Vite in middleware mode (HMR still works).
 * In production:   Serves the built dist/ folder as static files.
 *
 * WebSocket bridge:
 *   /ws?role=operator   → receives audience actions
 *   /ws?role=audience   → sends action requests, receives lock updates
 */

import { createServer as createHttpServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, resolve, basename } from 'path';
import { writeFile, readFile, readdir, stat, unlink } from 'fs/promises';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import express from 'express';
import { WebSocketServer } from 'ws';
import { URL } from 'url';
import { MSG, RATE_LIMIT_MS, ACTIONS, DEFAULT_AUDIENCE_ACCESS, isActionAllowed } from './src/ws/protocol.js';
import { SAMPLE_LAYER_KEYS } from './src/samples/layers.js';

const execAsync = promisify(exec);

async function getWifiSSID() {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('netsh wlan show interfaces');
      const match = stdout.match(/^\s*SSID\s*:\s*(.+)$/m);
      if (match && match[1].trim()) return match[1].trim();
    } else if (process.platform === 'darwin') {
      try {
        const { stdout } = await execAsync('/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I');
        const match = stdout.match(/^\s*SSID:\s*(.+)$/m);
        if (match && match[1].trim()) return match[1].trim();
      } catch (e) {
        const { stdout } = await execAsync('networksetup -getairportnetwork en0');
        const match = stdout.match(/Current Wi-Fi Network:\s*(.+)/);
        if (match && match[1].trim()) return match[1].trim();
      }
    } else if (process.platform === 'linux') {
      try {
        const { stdout } = await execAsync('iwgetid -r');
        if (stdout.trim()) return stdout.trim();
      } catch (e) {
        const { stdout } = await execAsync("nmcli -t -f active,ssid dev wifi | grep '^yes'");
        const parts = stdout.split(':');
        if (parts[1] && parts[1].trim()) return parts[1].trim();
      }
    }
  } catch (err) {
    console.warn('[server] Failed to detect Wi-Fi SSID:', err.message);
  }
  return null;
}

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const [name, netList] of Object.entries(interfaces)) {
    if (!netList) continue;
    for (const net of netList) {
      const isIPv4 = net.family === 'IPv4' || net.family === 4;
      if (isIPv4 && !net.internal) {
        addresses.push({
          name,
          address: net.address,
          isWifi: /wi-?fi|wlan|wireless/i.test(name)
        });
      }
    }
  }
  addresses.sort((a, b) => {
    if (a.isWifi && !b.isWifi) return -1;
    if (!a.isWifi && b.isWifi) return 1;
    return 0;
  });
  return addresses;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ─── Express app ──────────────────────────────────────
const app = express();
// Allow large payloads for audio blobs
app.use(express.json({ limit: '50mb' }));

const SAMPLES_DIR = resolve(__dirname, 'public', 'samples');
const SAMPLE_EXTENSIONS = /\.(webm|wav|ogg|mp4|mp3)$/i;

// These endpoints are reachable by anyone on the venue Wi-Fi, so a filename from
// a request must be a plain audio file name inside the samples folder.
function isSafeSampleFilename(name) {
  return (
    typeof name === 'string' &&
    name === basename(name) &&
    !name.startsWith('.') &&
    SAMPLE_EXTENSIONS.test(name) &&
    resolve(SAMPLES_DIR, name).startsWith(SAMPLES_DIR)
  );
}

function emptyCatalog() {
  return { _base: './samples/', ...Object.fromEntries(SAMPLE_LAYER_KEYS.map((key) => [key, []])) };
}

// ─── Strudel Catalog Sync Helper ─────────────────────
async function syncStrudelCatalog(newLayer, newFilename) {
  const strudelJsonPath = resolve(__dirname, 'public', 'strudel.json');
  const samplesDir = SAMPLES_DIR;
  let catalog = {};
  try {
    const content = await readFile(strudelJsonPath, 'utf-8');
    catalog = JSON.parse(content);
  } catch (e) {
    catalog = emptyCatalog();
  }

  if (newLayer && newFilename) {
    if (!catalog[newLayer]) catalog[newLayer] = [];
    if (!catalog[newLayer].includes(newFilename)) {
      catalog[newLayer].unshift(newFilename);
    }
  }

  let existingFiles = new Set();
  try {
    existingFiles = new Set(await readdir(samplesDir));
  } catch (e) {
    console.warn('[server] Could not read samples directory:', e);
  }

  for (const key of SAMPLE_LAYER_KEYS) {
    if (catalog[key]) {
      catalog[key] = catalog[key].filter((f) => existingFiles.has(f));
    } else {
      catalog[key] = [];
    }
  }

  // Drop per-file sound names whose file is gone (deleted or renamed).
  for (const [key, value] of Object.entries(catalog)) {
    if (!key.startsWith('_') && typeof value === 'string' && !existingFiles.has(value)) {
      delete catalog[key];
    }
  }

  // Register each existing file as its own sound name (without extension)
  for (const file of existingFiles) {
    if (file === 'README.md' || file.startsWith('.')) continue;
    const baseName = file.replace(/\.[^.]+$/, '');
    catalog[baseName] = file;
  }

  catalog._base = './samples/';
  await writeFile(strudelJsonPath, JSON.stringify(catalog, null, 2), 'utf-8');
  return catalog;
}

// ─── Sample Upload Endpoint ───────────────────────────
app.post('/upload-sample', async (req, res) => {
  try {
    const { layer, dataUri } = req.body;
    if (!layer || !dataUri) {
      return res.status(400).json({ error: 'Missing layer or dataUri' });
    }
    // The layer becomes part of the filename, so only known layers are allowed.
    if (!SAMPLE_LAYER_KEYS.includes(layer)) {
      return res.status(400).json({ error: 'Unknown layer' });
    }

    const matches = dataUri.match(/^data:(.+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ error: 'Invalid dataUri format' });
    }

    const mime = matches[1];
    const base64Data = matches[2];
    const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'wav';

    const timestamp = Date.now();
    const filename = `${layer}_${timestamp}.${ext}`;
    const filePath = resolve(__dirname, 'public', 'samples', filename);

    // Save the file
    const buffer = Buffer.from(base64Data, 'base64');
    await writeFile(filePath, buffer);

    // Sync strudel.json
    await syncStrudelCatalog(layer, filename);

    res.json({ success: true, filename });
  } catch (err) {
    console.error('[server] Error uploading sample:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Sample Replace Endpoint ──────────────────────────
app.post('/replace-sample', async (req, res) => {
  try {
    const { filename, dataUri } = req.body;
    if (!filename || !dataUri) {
      return res.status(400).json({ error: 'Missing filename or dataUri' });
    }

    const matches = dataUri.match(/^data:(.+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ error: 'Invalid dataUri format' });
    }

    if (!isSafeSampleFilename(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const base64Data = matches[2];
    const filePath = resolve(SAMPLES_DIR, filename);
    try {
      await stat(filePath);
    } catch (e) {
      return res.status(404).json({ error: 'Sample file not found' });
    }

    // Overwrite the file
    const buffer = Buffer.from(base64Data, 'base64');
    await writeFile(filePath, buffer);

    await syncStrudelCatalog();

    res.json({ success: true, filename });
  } catch (err) {
    console.error('[server] Error replacing sample:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Sample Rename Endpoint ───────────────────────────
app.post('/rename-sample', async (req, res) => {
  try {
    const { oldFilename, newName } = req.body;
    if (!oldFilename || !newName) {
      return res.status(400).json({ error: 'Missing oldFilename or newName' });
    }

    if (!isSafeSampleFilename(oldFilename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const samplesDir = SAMPLES_DIR;
    const oldPath = resolve(samplesDir, oldFilename);

    // Check if old file exists
    try {
      await stat(oldPath);
    } catch (e) {
      return res.status(404).json({ error: 'Old sample file not found' });
    }

    // Extract original extension
    const extMatch = oldFilename.match(/\.[^.]+$/);
    const ext = extMatch ? extMatch[0] : '.webm';

    // Sanitize new name: remove illegal chars, replace spaces with underscores
    let cleanName = newName.trim().replace(/[\\/?:*"<>|]/g, '').replace(/\s+/g, '_');
    if (!cleanName) {
      return res.status(400).json({ error: 'Invalid new name' });
    }

    // Ensure it ends with original extension
    if (!cleanName.endsWith(ext)) {
      cleanName += ext;
    }

    if (!isSafeSampleFilename(cleanName)) {
      return res.status(400).json({ error: 'Invalid new name' });
    }

    const newPath = resolve(samplesDir, cleanName);

    if (oldFilename !== cleanName) {
      // Renaming onto an existing file would silently overwrite that recording.
      const taken = await stat(newPath).then(() => true, () => false);
      if (taken) {
        return res.status(409).json({ error: 'A sample with that name already exists' });
      }
      const { rename } = await import('fs/promises');
      await rename(oldPath, newPath);
    }

    // Update strudel.json
    const strudelJsonPath = resolve(__dirname, 'public', 'strudel.json');
    let catalog = {};
    try {
      const content = await readFile(strudelJsonPath, 'utf-8');
      catalog = JSON.parse(content);
    } catch (e) {
      catalog = emptyCatalog();
    }

    for (const key of SAMPLE_LAYER_KEYS) {
      if (catalog[key]) {
        catalog[key] = catalog[key].map((f) => (f === oldFilename ? cleanName : f));
      }
    }

    // Remove old base sound key
    const oldBaseName = oldFilename.replace(/\.[^.]+$/, '');
    delete catalog[oldBaseName];

    await writeFile(strudelJsonPath, JSON.stringify(catalog, null, 2), 'utf-8');
    await syncStrudelCatalog();

    res.json({ success: true, oldFilename, newFilename: cleanName });
  } catch (err) {
    console.error('[server] Error renaming sample:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Sample Delete Endpoint ───────────────────────────
app.post('/delete-sample', async (req, res) => {
  try {
    const { filename } = req.body;
    if (!isSafeSampleFilename(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    try {
      await unlink(resolve(SAMPLES_DIR, filename));
    } catch (e) {
      return res.status(404).json({ error: 'Sample file not found' });
    }
    await syncStrudelCatalog(); // drops it from the layer lists and its sound name
    res.json({ success: true, filename });
  } catch (err) {
    console.error('[server] Error deleting sample:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Host Messages (host.html) ────────────────────────
// Recorded host announcements, played in order of the number their filename starts
// with ("01 welcome.mp3", "2 rules.wav", "10 thanks.m4a"). Served straight from the
// folder so files added later work without a rebuild.
const HOST_MESSAGES_DIR = resolve(__dirname, 'public', 'host-messages');
const HOST_AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|webm|m4a|mp4|aac|flac)$/i;

app.use('/host-messages', express.static(HOST_MESSAGES_DIR));

app.get('/api/host-messages', async (req, res) => {
  try {
    const files = await readdir(HOST_MESSAGES_DIR).catch(() => []);
    const leadingNumber = (name) => {
      const match = /^\s*(\d+)/.exec(name);
      return match ? Number(match[1]) : Infinity; // unnumbered files go last
    };
    const messages = files
      .filter((name) => HOST_AUDIO_EXTENSIONS.test(name) && !name.startsWith('.'))
      .sort((a, b) => leadingNumber(a) - leadingNumber(b) || a.localeCompare(b, undefined, { numeric: true }))
      .map((filename) => ({ filename, url: `/host-messages/${encodeURIComponent(filename)}` }));
    res.json(messages);
  } catch (err) {
    console.error('[server] Error listing host messages:', err);
    res.status(500).json({ error: 'Failed to list host messages' });
  }
});

// ─── Sample Dates Endpoint ────────────────────────────
// Creation time survives renames and trim/ADSR re-saves, so it reflects when a
// sample was originally recorded.
app.get('/api/sample-dates', async (req, res) => {
  try {
    const samplesDir = resolve(__dirname, 'public', 'samples');
    const entries = await readdir(samplesDir, { withFileTypes: true });
    const dates = {};
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const info = await stat(resolve(samplesDir, entry.name));
          dates[entry.name] = info.birthtimeMs || info.mtimeMs;
        }),
    );
    res.json(dates);
  } catch (err) {
    console.error('[server] Error reading sample dates:', err);
    res.status(500).json({ error: 'Failed to read sample dates' });
  }
});

// ─── Network Info Endpoint ────────────────────────────
app.get('/api/network-info', async (req, res) => {
  try {
    const ssid = await getWifiSSID();
    const interfaces = getLocalIpAddresses();
    const primaryIp = interfaces.length > 0 ? interfaces[0].address : 'localhost';
    const port = PORT;
    const audienceUrl = `http://${primaryIp}:${port}/audience.html`;

    res.json({
      ssid,
      interfaces,
      primaryIp,
      port,
      audienceUrl,
    });
  } catch (err) {
    console.error('[server] Error retrieving network info:', err);
    res.status(500).json({ error: 'Failed to retrieve network info' });
  }
});

const server = createHttpServer(app);

// ─── WebSocket server ─────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

/** Connected clients, tagged by role. Displays are read-only pad screens (pads.html). */
const operators = new Set();
const audiences = new Set();
const displays = new Set();

/** Latest pad layout from the operator, replayed to clients that connect later. */
let lastPadSync = null;

/** Which audience controls the operator has switched on. Lives here so it's enforced even for stale phone pages. */
let audienceAccess = { ...DEFAULT_AUDIENCE_ACCESS };

/** Per-client rate-limit tracking (audience only). */
const lastActionTime = new WeakMap();

// Phones unlock after RATE_LIMIT_MS by their own clock, but this side measures
// arrival times; network jitter could make an on-time press look early and get
// silently dropped while the phone reports success. Allow a little slack.
const RATE_LIMIT_GRACE_MS = 500;

function broadcast(clients, data) {
  const json = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) ws.send(json);
  }
}

function sendAudienceCount() {
  const payload = { type: MSG.STATUS, audienceCount: audiences.size };
  broadcast(operators, payload);
}

/** Send the current audience access to one client, or to every phone and dashboard. */
function sendAccessState(target) {
  const payload = { type: MSG.ACCESS_UPDATE, access: audienceAccess };
  if (target) {
    if (target.readyState === 1) target.send(JSON.stringify(payload));
  } else {
    broadcast(audiences, payload);
    broadcast(operators, payload);
  }
}

// Handle upgrade manually so we can read ?role from the URL
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws._role = url.searchParams.get('role') || 'audience';
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  const role = ws._role;

  if (role === 'operator') {
    operators.add(ws);
    sendAudienceCount();
    sendAccessState(ws); // the dashboard's switches show the server's real state
    console.log(`[ws] Operator connected (total operators: ${operators.size})`);
  } else if (role === 'display') {
    displays.add(ws);
    if (lastPadSync) ws.send(JSON.stringify(lastPadSync));
    console.log(`[ws] Pad display connected (total displays: ${displays.size})`);
  } else {
    audiences.add(ws);
    sendAudienceCount();
    sendAccessState(ws); // tell this phone which controls are on
    if (lastPadSync) ws.send(JSON.stringify(lastPadSync));
    console.log(`[ws] Audience connected (total audience: ${audiences.size})`);
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (role === 'audience' && msg.type === MSG.ACTION_REQUEST) {
      // ── Validate & access check (before rate limiting, so a refused press doesn't cost a cooldown) ──
      if (!Object.values(ACTIONS).includes(msg.action)) return;
      if (!isActionAllowed(msg.action, audienceAccess)) return; // switched off by the operator

      // ── Rate limit ──
      const now = Date.now();
      const last = lastActionTime.get(ws) || 0;
      if (now - last < RATE_LIMIT_MS - RATE_LIMIT_GRACE_MS) return; // silently drop
      lastActionTime.set(ws, now);

      // Forward to operators
      broadcast(operators, {
        type: MSG.AUDIENCE_ACTION,
        action: msg.action,
        timestamp: now,
      });
    }

    if (role === 'operator' && msg.type === MSG.SET_ACCESS) {
      const { all, music } = msg.access || {};
      if (typeof all === 'boolean') audienceAccess.all = all;
      if (typeof music === 'boolean') audienceAccess.music = music;
      sendAccessState();
    }

    if (role === 'operator' && msg.type === MSG.SYNC_PADS) {
      lastPadSync = {
        type: MSG.SYNC_PADS,
        padLabels: msg.padLabels,
        padKinds: msg.padKinds,
        bankTitle: msg.bankTitle,
      };
      broadcast(audiences, lastPadSync);
      broadcast(displays, lastPadSync);
    }
  });

  ws.on('close', () => {
    operators.delete(ws);
    audiences.delete(ws);
    displays.delete(ws);
    sendAudienceCount();
    console.log(`[ws] ${role} disconnected (operators: ${operators.size}, audience: ${audiences.size}, displays: ${displays.size})`);
  });
});

// ─── Vite / static serving ────────────────────────────
async function startServer() {
  if (isProd) {
    // Production: serve built files
    app.use(express.static(resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      // SPA fallback for operator page; audience.html is a separate entry
      if (req.path.startsWith('/audience')) {
        res.sendFile(resolve(__dirname, 'dist', 'audience.html'));
      } else {
        res.sendFile(resolve(__dirname, 'dist', 'index.html'));
      }
    });
  } else {
    // Development: use Vite middleware for HMR
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'mpa', // multi-page app
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, () => {
    console.log(`\n  Strudel Dashboard server running at:`);
    console.log(`    ➜  Operator:  http://localhost:${PORT}/`);
    console.log(`    ➜  Audience:  http://localhost:${PORT}/audience.html`);
    console.log(`    ➜  Mode:      ${isProd ? 'production' : 'development'}\n`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
