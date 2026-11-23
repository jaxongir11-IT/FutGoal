const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const HTML_FILE = path.join(__dirname, 'index.html');

app.use(cors());

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache & active SSE clients
const apiCache = new Map();
const sseClients = new Set();

// Helper functions for reading and writing JSON DB files
function readDb(file, defaultValue = []) {
  const filePath = path.join(DATA_DIR, file);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error reading ${file}:`, err.message);
  }
  return defaultValue;
}

function writeDb(file, data) {
  const filePath = path.join(DATA_DIR, file);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing ${file}:`, err.message);
    return false;
  }
}

// Broadcast SSE event to all connected clients
function broadcastSSE(type, payload) {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(message);
    } catch (err) {
      sseClients.delete(res);
    }
  }
}

/* =========================================================
   SERVER-SENT EVENTS (SSE) REAL-TIME STREAM
   ========================================================= */
app.get('/api/live/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ message: 'FutGoal Realtime SSE Stream Connected', timestamp: new Date().toISOString() })}\n\n`);

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

/* =========================================================
   SYSTEM & HEALTH ENDPOINTS
   ========================================================= */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'FutGoal Portal Backend Engine',
    brand: 'FutGoal',
    architecture: 'Node.js Express REST + Realtime SSE',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()) + ' seconds'
  });
});

app.get('/api/status', (req, res) => {
  const matches = readDb('matches.json', []);
  const standings = readDb('standings.json', {});
  const transfers = readDb('transfers.json', []);
  const news = readDb('news.json', []);

  res.json({
    status: 'online',
    database: {
      type: 'Persistent JSON Store (Google Cloud Architecture Sync)',
      totalMatches: matches.length,
      liveMatches: matches.filter(m => m.status === 'LIVE').length,
      finishedMatches: matches.filter(m => m.status === 'FINISHED').length,
      scheduledMatches: matches.filter(m => m.status === 'SCHEDULED').length,
      totalLeagues: Object.keys(standings).length,
      totalTransfers: transfers.length,
      totalNews: news.length
    },
    realtime: {
      connectedClients: sseClients.size,
      sseEnabled: true
    },
    timestamp: new Date().toISOString()
  });
});

/* =========================================================
   MATCHES REST API
   ========================================================= */

// GET /api/matches (with query filters)
app.get('/api/matches', (req, res) => {
  let matches = readDb('matches.json', []);
  const { date, league, status, search, team } = req.query;

  if (date) {
    matches = matches.filter(m => m.date === date);
  }
  if (league && league !== 'all') {
    const l = league.toLowerCase();
    matches = matches.filter(m => 
      (m.tournament && m.tournament.toLowerCase().includes(l)) || 
      (m.tournamentName && m.tournamentName.toLowerCase().includes(l))
    );
  }
  if (status && status !== 'all') {
    matches = matches.filter(m => m.status === status);
  }
  if (team) {
    const tm = team.toLowerCase();
    matches = matches.filter(m => 
      m.home.toLowerCase().includes(tm) || 
      m.away.toLowerCase().includes(tm)
    );
  }
  if (search) {
    const q = search.toLowerCase();
    matches = matches.filter(m => 
      m.home.toLowerCase().includes(q) || 
      m.away.toLowerCase().includes(q) ||
      (m.tournamentName && m.tournamentName.toLowerCase().includes(q))
    );
  }

  res.json({
    count: matches.length,
    matches: matches
  });
});

// GET /api/matches/:id
app.get('/api/matches/:id', (req, res) => {
  const matches = readDb('matches.json', []);
  const match = matches.find(m => m.id === req.params.id);
  if (!match) {
    return res.status(404).json({ error: 'Match not found', id: req.params.id });
  }
  res.json(match);
});

// POST /api/matches (Add match from CMS or Admin)
app.post('/api/matches', (req, res) => {
  const matches = readDb('matches.json', []);
  const b = req.body;

  if (!b.home || !b.away) {
    return res.status(400).json({ error: 'home and away team names are required' });
  }

  const newMatch = {
    id: b.id || ('m_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)),
    home: b.home,
    away: b.away,
    homeScore: Number(b.homeScore || 0),
    awayScore: Number(b.awayScore || 0),
    minute: Number(b.minute || (b.status === 'FINISHED' ? 90 : 0)),
    status: b.status || 'SCHEDULED',
    date: b.date || new Date().toISOString().split('T')[0],
    tournament: b.tournament || 'EPL',
    tournamentName: b.tournamentName || 'Premier League',
    country: b.country || 'Xalqaro',
    flag: b.flag || '⚽',
    time: b.time || '20:00',
    homeXg: Number(b.homeXg || 1.10),
    awayXg: Number(b.awayXg || 0.90),
    homeScorers: b.homeScorers || '',
    awayScorers: b.awayScorers || '',
    venue: b.venue || 'Asosiy Stadion',
    events: Array.isArray(b.events) ? b.events : []
  };

  matches.unshift(newMatch);
  writeDb('matches.json', matches);

  broadcastSSE('MATCH_CREATED', newMatch);
  res.status(201).json({ success: true, match: newMatch });
});

// PUT /api/matches/:id (Update match)
app.put('/api/matches/:id', (req, res) => {
  const matches = readDb('matches.json', []);
  const idx = matches.findIndex(m => m.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Match not found' });
  }

  const existing = matches[idx];
  const updated = {
    ...existing,
    ...req.body,
    id: existing.id // protect ID
  };

  matches[idx] = updated;
  writeDb('matches.json', matches);

  broadcastSSE('MATCH_UPDATED', updated);
  res.json({ success: true, match: updated });
});

// POST /api/matches/:id/events (Add match event: Goal, Card, Sub)
app.post('/api/matches/:id/events', (req, res) => {
  const matches = readDb('matches.json', []);
  const match = matches.find(m => m.id === req.params.id);
  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }

  const { type, team, player, minute, description } = req.body;
  if (!type || !team || !player) {
    return res.status(400).json({ error: 'type, team and player are required' });
  }

  const eventMinute = minute ? Number(minute) : (match.minute || 45);
  const event = {
    id: 'ev_' + Date.now(),
    type, // 'goal', 'yellow', 'red', 'sub', 'var'
    team, // 'home' or 'away'
    player,
    minute: eventMinute,
    description: description || ''
  };

  if (!match.events) match.events = [];
  match.events.push(event);

  // If goal, update score automatically
  if (type === 'goal') {
    if (team === 'home') {
      match.homeScore = (match.homeScore || 0) + 1;
      const scorerEntry = `${player} ${eventMinute}'`;
      match.homeScorers = match.homeScorers ? `${match.homeScorers}, ${scorerEntry}` : scorerEntry;
    } else {
      match.awayScore = (match.awayScore || 0) + 1;
      const scorerEntry = `${player} ${eventMinute}'`;
      match.awayScorers = match.awayScorers ? `${match.awayScorers}, ${scorerEntry}` : scorerEntry;
    }
  }

  writeDb('matches.json', matches);
  broadcastSSE('MATCH_EVENT', { matchId: match.id, event, match });

  res.json({ success: true, event, match });
});

// DELETE /api/matches/:id
app.delete('/api/matches/:id', (req, res) => {
  let matches = readDb('matches.json', []);
  const initialLen = matches.length;
  matches = matches.filter(m => m.id !== req.params.id);
  if (matches.length === initialLen) {
    return res.status(404).json({ error: 'Match not found' });
  }

  writeDb('matches.json', matches);
  broadcastSSE('MATCH_DELETED', { id: req.params.id });
  res.json({ success: true, deletedId: req.params.id });
});

/* =========================================================
   LEAGUES REST API (TOP 20 LEAGUES)
   ========================================================= */

// GET /api/leagues (Summary of all 20 leagues + Leaders)
app.get('/api/leagues', (req, res) => {
  const standings = readDb('standings.json', {});
  const scorers = readDb('scorers.json', {});
  const assists = readDb('assists.json', {});
  const order = readDb('leagues_order.json', Object.keys(standings));

  const list = order.map(code => {
    const l = standings[code] || {};
    const table = l.table || [];
    const leader = table[0] || null;
    const topScorer = (scorers[code] || [])[0] || null;
    const topAssist = (assists[code] || [])[0] || null;

    return {
      code,
      name: l.name || code,
      country: l.country || 'Xalqaro',
      flag: l.flag || '🏆',
      season: l.season || '2025/2026',
      totalTeams: table.length,
      leader: leader ? {
        team: leader.team,
        pts: leader.pts,
        played: leader.p,
        wins: leader.w,
        draws: leader.d,
        losses: leader.l,
        gf: leader.gf,
        ga: leader.ga,
        gd: leader.gd
      } : null,
      topScorer: topScorer ? {
        name: topScorer.name,
        team: topScorer.team,
        goals: topScorer.goals
      } : null,
      topAssist: topAssist ? {
        name: topAssist.name,
        team: topAssist.team,
        assists: topAssist.assists
      } : null
    };
  });

  res.json({
    totalLeagues: list.length,
    leagues: list
  });
});

// GET /api/leagues/:code (Detailed league hub)
app.get('/api/leagues/:code', (req, res) => {
  const code = req.params.code;
  const standings = readDb('standings.json', {});
  const scorers = readDb('scorers.json', {});
  const assists = readDb('assists.json', {});
  const matches = readDb('matches.json', []);

  // Find league by code (case-insensitive)
  const key = Object.keys(standings).find(k => k.toLowerCase() === code.toLowerCase());
  if (!key) {
    return res.status(404).json({ error: 'League not found', code });
  }

  const leagueData = standings[key];
  const leagueMatches = matches.filter(m => 
    (m.tournament && m.tournament.toLowerCase() === key.toLowerCase()) ||
    (m.tournamentName && m.tournamentName.toLowerCase().includes(leagueData.name.toLowerCase()))
  );

  res.json({
    code: key,
    name: leagueData.name,
    country: leagueData.country,
    flag: leagueData.flag,
    season: leagueData.season,
    standings: leagueData.table || [],
    scorers: scorers[key] || [],
    assists: assists[key] || [],
    fixtures: leagueMatches
  });
});

// GET /api/leagues/:code/standings
app.get('/api/leagues/:code/standings', (req, res) => {
  const standings = readDb('standings.json', {});
  const key = Object.keys(standings).find(k => k.toLowerCase() === req.params.code.toLowerCase());
  if (!key) return res.status(404).json({ error: 'League not found' });
  res.json(standings[key].table || []);
});

// GET /api/leagues/:code/scorers
app.get('/api/leagues/:code/scorers', (req, res) => {
  const scorers = readDb('scorers.json', {});
  const key = Object.keys(scorers).find(k => k.toLowerCase() === req.params.code.toLowerCase());
  if (!key) return res.status(404).json({ error: 'Scorers not found for league' });
  res.json(scorers[key] || []);
});

// GET /api/leagues/:code/assists
app.get('/api/leagues/:code/assists', (req, res) => {
  const assists = readDb('assists.json', {});
  const key = Object.keys(assists).find(k => k.toLowerCase() === req.params.code.toLowerCase());
  if (!key) return res.status(404).json({ error: 'Assists not found for league' });
  res.json(assists[key] || []);
});

/* =========================================================
   TRANSFERS REST API
   ========================================================= */

// GET /api/transfers
app.get('/api/transfers', (req, res) => {
  let transfers = readDb('transfers.json', []);
  const { category, search } = req.query;

  if (category && category !== 'all') {
    if (category === 'confirmed') {
      transfers = transfers.filter(t => t.type === 'done' || (t.probability && t.probability === 100));
    } else if (category === 'rumors') {
      transfers = transfers.filter(t => t.type === 'rumor' || (t.probability && t.probability < 100));
    } else if (category === 'uzbek') {
      transfers = transfers.filter(t => 
        (t.player && (t.player.includes('Abbosbek') || t.player.includes('Eldor') || t.player.includes('Oston') || t.player.includes('Abduqodir') || t.player.includes('Fayzullayev'))) ||
        (t.summary && (t.summary.includes('O\'zbekiston') || t.summary.includes('Superliga') || t.summary.includes('Toshkent')))
      );
    } else if (category === 'top5') {
      transfers = transfers.filter(t => 
        (t.fee && (t.fee.includes('100') || t.fee.includes('130') || t.fee.includes('80') || t.fee.includes('70') || t.fee.includes('90'))) ||
        (t.probability && t.probability >= 80)
      );
    }
  }

  if (search) {
    const q = search.toLowerCase();
    transfers = transfers.filter(t => 
      t.player.toLowerCase().includes(q) ||
      t.from.toLowerCase().includes(q) ||
      t.to.toLowerCase().includes(q) ||
      (t.summary && t.summary.toLowerCase().includes(q))
    );
  }

  res.json({
    count: transfers.length,
    transfers
  });
});

// POST /api/transfers
app.post('/api/transfers', (req, res) => {
  const transfers = readDb('transfers.json', []);
  const b = req.body;

  if (!b.player || !b.from || !b.to) {
    return res.status(400).json({ error: 'player, from and to are required' });
  }

  const newTransfer = {
    id: b.id || ('tr_' + Date.now()),
    player: b.player,
    position: b.position || 'Hujumchi',
    age: b.age ? Number(b.age) : 24,
    from: b.from,
    to: b.to,
    fee: b.fee || 'Mavhum',
    probability: Number(b.probability || 70),
    status: b.status || 'Muzokaralar olib borilmoqda',
    type: b.type || (Number(b.probability) === 100 ? 'done' : 'rumor'),
    source: b.source || 'FutGoal Insayder',
    summary: b.summary || `${b.player} ${b.from} jamoasidan ${b.to} safiga o'tishi kutilmoqda.`,
    date: b.date || 'Bugun',
    image: b.image || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=150&q=80'
  };

  transfers.unshift(newTransfer);
  writeDb('transfers.json', transfers);

  broadcastSSE('TRANSFER_CREATED', newTransfer);
  res.status(201).json({ success: true, transfer: newTransfer });
});

/* =========================================================
   NEWS REST API
   ========================================================= */

// GET /api/news
app.get('/api/news', (req, res) => {
  let news = readDb('news.json', []);
  const { category, search } = req.query;

  if (category && category !== 'all') {
    news = news.filter(n => n.category === category);
  }
  if (search) {
    const q = search.toLowerCase();
    news = news.filter(n => 
      n.title.toLowerCase().includes(q) || 
      n.excerpt.toLowerCase().includes(q)
    );
  }

  res.json({
    count: news.length,
    news
  });
});

// GET /api/news/:id
app.get('/api/news/:id', (req, res) => {
  const news = readDb('news.json', []);
  const article = news.find(n => n.id === req.params.id);
  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }

  // Increment views
  article.views = (article.views || 100) + 1;
  writeDb('news.json', news);

  res.json(article);
});

// POST /api/news
app.post('/api/news', (req, res) => {
  const news = readDb('news.json', []);
  const b = req.body;

  if (!b.title || !b.excerpt) {
    return res.status(400).json({ error: 'title and excerpt are required' });
  }

  const newArticle = {
    id: b.id || ('news_' + Date.now()),
    title: b.title,
    excerpt: b.excerpt,
    category: b.category || 'superliga',
    categoryName: b.categoryName || 'Superliga',
    date: b.date || 'Hozirgina',
    reads: '100+ o\'qildi',
    views: 100,
    author: b.author || 'FutGoal Muharririyati',
    image: b.image || 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?auto=format&fit=crop&w=600&q=80',
    content: b.content || b.excerpt
  };

  news.unshift(newArticle);
  writeDb('news.json', news);

  broadcastSSE('NEWS_CREATED', newArticle);
  res.status(201).json({ success: true, article: newArticle });
});

/* =========================================================
   LIVE API PROXY (FotMob & External endpoints)
   ========================================================= */
app.get('/api/fotmob/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || !targetUrl.startsWith('https://www.fotmob.com/api/')) {
    return res.status(400).json({ error: 'Invalid or missing target URL. Must start with https://www.fotmob.com/api/' });
  }

  if (apiCache.has(targetUrl) && (Date.now() - apiCache.get(targetUrl).time < 60000)) {
    res.setHeader('X-Cache', 'HIT');
    return res.json(JSON.parse(apiCache.get(targetUrl).data));
  }

  https.get(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    }
  }, (proxyRes) => {
    let body = '';
    proxyRes.on('data', chunk => { body += chunk; });
    proxyRes.on('end', () => {
      if (proxyRes.statusCode === 200) {
        apiCache.set(targetUrl, { time: Date.now(), data: body });
        res.setHeader('X-Cache', 'MISS');
        try {
          res.json(JSON.parse(body));
        } catch(e) {
          res.send(body);
        }
      } else {
        res.status(proxyRes.statusCode || 500).json({ error: 'Remote server returned ' + proxyRes.statusCode });
      }
    });
  }).on('error', (err) => {
    res.status(502).json({ error: 'Proxy request failed: ' + err.message });
  });
});

/* =========================================================
   BACKGROUND REALTIME MATCH TICKER (SIMULATOR)
   Increments minute on active LIVE matches & pushes SSE
   ========================================================= */
setInterval(() => {
  try {
    const matches = readDb('matches.json', []);
    let updated = false;

    for (const m of matches) {
      if (m.status === 'LIVE') {
        m.minute = (m.minute || 1) + 1;
        if (m.minute >= 90) {
          m.status = 'FINISHED';
          m.minute = 90;
        }

        // Small random chance of a live goal during tick (5% chance)
        if (m.status === 'LIVE' && Math.random() < 0.05) {
          const scoringTeam = Math.random() > 0.5 ? 'home' : 'away';
          const scorerName = scoringTeam === 'home' ? (m.home + ' Hujumchisi') : (m.away + ' Hujumchisi');
          if (scoringTeam === 'home') {
            m.homeScore = (m.homeScore || 0) + 1;
          } else {
            m.awayScore = (m.awayScore || 0) + 1;
          }
          if (!m.events) m.events = [];
          const goalEv = {
            id: 'ev_' + Date.now(),
            type: 'goal',
            team: scoringTeam,
            player: scorerName,
            minute: m.minute,
            description: `GOL! ${scorerName} ajoyib zarba bilan darvozani ishg'ol qildi!`
          };
          m.events.push(goalEv);
          broadcastSSE('MATCH_EVENT', { matchId: m.id, event: goalEv, match: m });
        }

        updated = true;
      }
    }

    if (updated) {
      writeDb('matches.json', matches);
      broadcastSSE('MATCHES_TICK', { timestamp: new Date().toISOString() });
    }
  } catch (e) {
    // silently continue
  }
}, 30000); // tick every 30 seconds

/* =========================================================
   SERVE STATIC CLIENT APP (index.html)
   ========================================================= */
app.use((req, res) => {
  // If requesting a static file that exists on disk
  if (req.path !== '/' && req.path !== '/index.html') {
    const possibleFile = path.join(__dirname, req.path);
    if (fs.existsSync(possibleFile) && fs.statSync(possibleFile).isFile()) {
      return res.sendFile(path.resolve(possibleFile));
    }
  }
  
  // Serve index.html SPA
  try {
    const htmlData = fs.readFileSync(HTML_FILE, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlData);
  } catch (err) {
    res.status(500).send('Server Error: Faylni o\'qib bo\'lmadi');
  }
});

// Start Express Server
const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(`🚀 FutGoal Complete Backend Server Running!`);
  console.log(`📡 URL: http://localhost:${PORT}/`);
  console.log(`📊 REST API: http://localhost:${PORT}/api/status`);
  console.log(`⚡ Real-Time SSE: http://localhost:${PORT}/api/live/stream`);
  console.log(`=======================================================`);
});
