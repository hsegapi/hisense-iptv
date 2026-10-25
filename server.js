const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const os = require('os');

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '192.168.0.32';
}

const PORT = 5000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const PLAYLIST_FILE = path.join(__dirname, 'playlist.json');
const INFO_FILE = path.join(__dirname, 'channels_info.json');
const REFRESH_SCRIPT = path.join(__dirname, 'refresh_channels.py');
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // Auto-refresh every 24 hours

let isRefreshing = false;

// Convert GitHub web blob links to raw content links automatically
function normalizeM3UUrl(inputUrl) {
  let target = inputUrl.trim();
  if (target.includes('github.com/') && target.includes('/blob/')) {
    target = target.replace('github.com/', 'raw.githubusercontent.com/').replace('/blob/', '/');
  } else if (target.includes('github.com/') && target.includes('/raw/')) {
    target = target.replace('github.com/', 'raw.githubusercontent.com/').replace('/raw/', '/');
  }
  return target;
}

function getSavedPlaylist() {
  try {
    if (fs.existsSync(PLAYLIST_FILE)) {
      return JSON.parse(fs.readFileSync(PLAYLIST_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading playlist:', e);
  }
  return [];
}

function getChannelsInfo() {
  try {
    if (fs.existsSync(INFO_FILE)) {
      return JSON.parse(fs.readFileSync(INFO_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading channels info:', e);
  }
  return null;
}

function savePlaylist(data) {
  try {
    fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(data, null, 2), 'utf8');
    const pubFile = path.join(PUBLIC_DIR, 'playlist.json');
    fs.writeFileSync(pubFile, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving playlist:', e);
    return false;
  }
}

// Auto-Refresh Runner via Python script
function triggerChannelRefresh(callback) {
  if (isRefreshing) {
    if (callback) callback({ status: 'in_progress', message: 'Refresh already in progress' });
    return;
  }

  isRefreshing = true;
  console.log(`[${new Date().toISOString()}] 🔄 Starting auto-refresh from https://iptv-org.github.io/...`);

  exec(`python3 "${REFRESH_SCRIPT}"`, { cwd: __dirname }, (error, stdout, stderr) => {
    isRefreshing = false;
    if (error) {
      console.error(`[ERROR] Refresh failed: ${error.message}`);
      if (callback) callback({ status: 'error', error: error.message });
      return;
    }

    console.log(`[${new Date().toISOString()}] ✅ Refresh completed successfully!`);
    const info = getChannelsInfo();
    if (callback) callback({ status: 'success', info });
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m3u': 'audio/x-mpegurl; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: Get current playlist (JSON)
  if (pathname === '/api/playlist' && req.method === 'GET') {
    const list = getSavedPlaylist();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }

  // API: Get channel info / metadata
  if (pathname === '/api/info' && req.method === 'GET') {
    const info = getChannelsInfo() || { total_channels: 0, status: 'unknown' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info));
    return;
  }

  // API: Trigger auto-refresh of all channels from iptv-org
  if ((pathname === '/api/refresh' || pathname === '/api/reload') && (req.method === 'GET' || req.method === 'POST')) {
    triggerChannelRefresh((result) => {
      res.writeHead(result.status === 'error' ? 500 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // API: Direct M3U Stream endpoints for Smart TV / Hisense IPTV apps
  if (pathname === '/playlist.m3u' || pathname === '/hisense_iptv.m3u' || pathname === '/all_channels.m3u') {
    const m3uFile = path.join(PUBLIC_DIR, 'hisense_iptv.m3u');
    if (fs.existsSync(m3uFile)) {
      res.writeHead(200, {
        'Content-Type': 'audio/x-mpegurl; charset=utf-8',
        'Content-Disposition': 'inline; filename="hisense_iptv.m3u"'
      });
      fs.createReadStream(m3uFile).pipe(res);
      return;
    }
  }

  // API: Save new playlist or channels
  if (pathname === '/api/playlist' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (Array.isArray(data)) {
          savePlaylist(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', count: data.length }));
          return;
        }
      } catch (err) {
        console.error('Invalid JSON posted:', err);
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid playlist data format' }));
    });
    return;
  }

  // API: Fetch M3U from URL (resolves GitHub links & CORS issues)
  if (pathname === '/api/fetch-m3u' && req.method === 'GET') {
    let targetUrl = reqUrl.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }

    targetUrl = normalizeM3UUrl(targetUrl);

    function fetchWithRedirect(targetReqUrl, maxRedirects = 5) {
      if (maxRedirects <= 0) {
        res.writeHead(500);
        res.end('Too many redirects');
        return;
      }

      const client = targetReqUrl.startsWith('https') ? https : http;
      const requestOptions = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      };

      client.get(targetReqUrl, requestOptions, (proxyRes) => {
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
          let nextUrl = proxyRes.headers.location;
          if (!nextUrl.startsWith('http')) {
            const parsed = new URL(targetReqUrl);
            nextUrl = new URL(nextUrl, parsed.origin).href;
          }
          fetchWithRedirect(nextUrl, maxRedirects - 1);
          return;
        }

        res.writeHead(proxyRes.statusCode, {
          'Content-Type': 'text/plain; charset=utf-8'
        });
        proxyRes.pipe(res);
      }).on('error', (err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    }

    fetchWithRedirect(targetUrl);
    return;
  }

  // Static File Serving
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404);
        res.end('404 Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const info = getChannelsInfo();
  const count = info ? info.total_channels : 0;
  const localIp = getLocalIp();
  console.log(`=======================================================`);
  console.log(`📺 Hisense VIDAA TV IPTV Server running!`);
  console.log(`Local Access:   http://localhost:${PORT}`);
  console.log(`VIDAA Browser: http://${localIp}:${PORT}`);
  console.log(`M3U Playlist:  http://${localIp}:${PORT}/hisense_iptv.m3u`);
  console.log(`Loaded Channels: ${count}`);
  console.log(`Auto-Refresh:  Scheduled every 24 hours`);
  console.log(`=======================================================`);
});

// Periodic automatic refresh every 24 hours
setInterval(() => {
  console.log(`[Auto-Refresh Schedule] Triggering periodic 24-hour channel refresh...`);
  triggerChannelRefresh();
}, REFRESH_INTERVAL_MS);

// Check if refresh is needed on startup
const existingInfo = getChannelsInfo();
if (!existingInfo) {
  console.log(`[Startup] No channels info found. Running initial channel download...`);
  triggerChannelRefresh();
} else {
  const lastUpdated = new Date(existingInfo.last_updated).getTime();
  const ageHours = (Date.now() - lastUpdated) / (1000 * 60 * 60);
  if (ageHours > 24) {
    console.log(`[Startup] Channel list is ${ageHours.toFixed(1)} hours old. Refreshing...`);
    triggerChannelRefresh();
  }
}
