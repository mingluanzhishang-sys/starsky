const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
// DATA_DIR: set via env var for persistent volumes (e.g. Railway); falls back to /tmp
const DATA_DIR = process.env.DATA_DIR || path.join('/tmp', 'starsky-data');
const DB_FILE  = path.join(DATA_DIR, 'db.json');

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error('❌ Cannot create data dir:', DATA_DIR, e.message);
  process.exit(1);
}

// ── Simple JSON store (sync reads/writes — safe in Node's single thread) ──
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { skies: {}, stars: [], nextStarId: 1 }; }
}
function writeDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db), 'utf8');
  } catch (e) {
    console.error('❌ writeDB failed:', e.message);
    throw e;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genId(len = 6) {
  const b = crypto.randomBytes(len);
  return Array.from(b, x => ID_CHARS[x % ID_CHARS.length]).join('');
}
function clean(v, max = 60) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function clamp(v, lo, hi) {
  const n = parseFloat(v);
  return isNaN(n) ? lo : Math.max(lo, Math.min(hi, n));
}
function ts() { return Math.floor(Date.now() / 1000); }

// ── Middleware ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── API ───────────────────────────────────────────────────────────────────

// Create sky
app.post('/api/sky', (req, res) => {
  try {
    const db = readDB();
    let id;
    do { id = genId(); } while (db.skies[id]);
    db.skies[id] = { id, ownerToken: crypto.randomUUID(), createdAt: ts() };
    writeDB(db);
    res.json({ skyId: id, ownerToken: db.skies[id].ownerToken });
  } catch (e) {
    console.error('/api/sky POST error:', e.message);
    res.status(500).json({ error: 'storage error: ' + e.message });
  }
});

// Get sky
app.get('/api/sky/:id', (req, res) => {
  const db  = readDB();
  const sky = db.skies[req.params.id];
  if (!sky) return res.status(404).json({ error: 'sky not found' });
  const stars = db.stars.filter(s => s.skyId === sky.id);
  res.json({ skyId: sky.id, stars });
});

// Add star (owner only)
app.post('/api/sky/:id/star', (req, res) => {
  try {
    const db  = readDB();
    const sky = db.skies[req.params.id];
    if (!sky) return res.status(404).json({ error: 'sky not found' });
    if (sky.ownerToken !== req.body.ownerToken) return res.status(403).json({ error: 'unauthorized' });

    const star = {
      id:         db.nextStarId++,
      skyId:      sky.id,
      name:       clean(req.body.name, 20) || '无名星',
      wish:       clean(req.body.wish, 60),
      x:          clamp(req.body.x, 0, 1),
      y:          clamp(req.body.y, 0, 1),
      size:       clamp(req.body.size, 4, 22),
      color:      clean(req.body.color, 20),
      brightness: clamp(req.body.brightness, 0.1, 1),
      lighters:   [],
      createdAt:  ts(),
    };
    db.stars.push(star);
    writeDB(db);
    res.json({ star });
  } catch (e) {
    console.error('/api/sky/:id/star POST error:', e.message);
    res.status(500).json({ error: 'storage error' });
  }
});

// Light a star (anyone)
app.post('/api/star/:id/light', (req, res) => {
  try {
    const db   = readDB();
    const id   = parseInt(req.params.id);
    const star = db.stars.find(s => s.id === id);
    if (!star) return res.status(404).json({ error: 'star not found' });

    const name = clean(req.body.lighterName, 20);
    if (!name) return res.status(400).json({ error: 'name required' });
    if (star.lighters.includes(name)) return res.status(409).json({ error: 'already lit' });

    star.lighters.push(name);
    star.brightness = Math.min(1.0, star.brightness + 0.08);
    star.size       = Math.min(22,  star.size + 0.8);
    writeDB(db);
    res.json({ star });
  } catch (e) {
    console.error('/api/star/:id/light POST error:', e.message);
    res.status(500).json({ error: 'storage error' });
  }
});

// Clear stars (owner only)
app.delete('/api/sky/:id/stars', (req, res) => {
  try {
    const db  = readDB();
    const sky = db.skies[req.params.id];
    if (!sky) return res.status(404).json({ error: 'sky not found' });
    if (sky.ownerToken !== req.body.ownerToken) return res.status(403).json({ error: 'unauthorized' });
    db.stars = db.stars.filter(s => s.skyId !== sky.id);
    writeDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'storage error' });
  }
});

// Global stats
app.get('/api/stats', (req, res) => {
  const db = readDB();
  const lightCount = db.stars.reduce((n, s) => n + s.lighters.length, 0);
  res.json({
    skyCount:   Object.keys(db.skies).length,
    starCount:  db.stars.length,
    lightCount,
  });
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`✨ StarSky → http://localhost:${PORT}`);
  console.log(`📂 Data dir: ${DATA_DIR}`);
});
