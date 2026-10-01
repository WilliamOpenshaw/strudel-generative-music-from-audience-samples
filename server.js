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
import { dirname, resolve } from 'path';
import { writeFile, readFile, readdir, stat } from 'fs/promises';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import express from 'express';
import { WebSocketServer } from 'ws';
import { URL } from 'url';
import { MSG, RATE_LIMIT_MS, ACTIONS } from './src/ws/protocol.js';

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

// ─── Strudel Catalog Sync Helper ─────────────────────
async function syncStrudelCatalog(newLayer, newFilename) {
  const strudelJsonPath = resolve(__dirname, 'public', 'strudel.json');
  const samplesDir = resolve(__dirname, 'public', 'samples');
  let catalog = {};
  try {
    const content = await readFile(strudelJsonPath, 'utf-8');
    catalog = JSON.parse(content);
  } catch (e) {
    catalog = { _base: './samples/', audience_lead: [], audience_bass: [], audience_chord: [], audience_drum: [] };
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

  for (const key of ['audience_lead', 'audience_bass', 'audience_chord', 'audience_drum']) {
    if (catalog[key]) {
      catalog[key] = catalog[key].filter((f) => existingFiles.has(f));
    } else {
      catalog[key] = [];
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

    const base64Data = matches[2];
    const filePath = resolve(__dirname, 'public', 'samples', filename);

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

    const samplesDir = resolve(__dirname, 'public', 'samples');
    const oldPath = resolve(samplesDir, oldFilename);

    // Check if old file exists
    try {
      await readFile(oldPath);
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

    const newPath = resolve(samplesDir, cleanName);

    if (oldFilename !== cleanName) {
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
      catalog = { _base: './samples/', audience_lead: [], audience_bass: [], audience_chord: [], audience_drum: [] };
    }

    for (const key of ['audience_lead', 'audience_bass', 'audience_chord', 'audience_drum']) {
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

/** Actions currently locked by the operator. */
const lockedActions = new Set();

/** Per-client rate-limit tracking (audience only). */
const lastActionTime = new WeakMap();

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

function sendLockState(target) {
  const payload = { type: MSG.LOCK_UPDATE, locked: [...lockedActions] };
  if (target) {
    if (target.readyState === 1) target.send(JSON.stringify(payload));
  } else {
    broadcast(audiences, payload);
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
    console.log(`[ws] Operator connected (total operators: ${operators.size})`);
  } else if (role === 'display') {
    displays.add(ws);
    if (lastPadSync) ws.send(JSON.stringify(lastPadSync));
    console.log(`[ws] Pad display connected (total displays: ${displays.size})`);
  } else {
    audiences.add(ws);
    sendAudienceCount();
    sendLockState(ws); // tell this audience client what's locked
    if (lastPadSync) ws.send(JSON.stringify(lastPadSync));
    console.log(`[ws] Audience connected (total audience: ${audiences.size})`);
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (role === 'audience' && msg.type === MSG.ACTION_REQUEST) {
      // ── Rate limit ──
      const now = Date.now();
      const last = lastActionTime.get(ws) || 0;
      if (now - last < RATE_LIMIT_MS) return; // silently drop
      lastActionTime.set(ws, now);

      // ── Lock check ──
      if (lockedActions.has(msg.action)) return; // operator vetoed

      // ── Validate action ──
      if (!Object.values(ACTIONS).includes(msg.action)) return;

      // Forward to operators
      broadcast(operators, {
        type: MSG.AUDIENCE_ACTION,
        action: msg.action,
        timestamp: now,
      });
    }

    if (role === 'operator' && msg.type === MSG.TOGGLE_LOCK) {
      const action = msg.action;
      if (!Object.values(ACTIONS).includes(action)) return;
      if (lockedActions.has(action)) {
        lockedActions.delete(action);
      } else {
        lockedActions.add(action);
      }
      sendLockState(); // broadcast new lock state to all audience clients
      // Also confirm to operators
      broadcast(operators, { type: MSG.LOCK_UPDATE, locked: [...lockedActions] });
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
