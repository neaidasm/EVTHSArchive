/**
 * EVTHS Dashboard — Cloudflare Worker
 * ─────────────────────────────────────────────────────────────
 * Handles:
 *   POST /api/login       → validates user from users.json via GitHub API
 *   POST /api/save-config → saves dashboard_config.json to GitHub
 *   GET  /data/users.json → blocked (returns 404 for security)
 *   Everything else       → served as static file from repo
 */

const REPO        = 'neaidasm/EVTHSArchive';
const CONFIG_PATH = 'data/dashboard_config.json';
const BRANCH      = 'main';

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // ── Block direct access to users.json ──────────────────────
    if (path === '/data/users.json') {
      return new Response('Not Found', { status: 404 });
    }

    // ── API: Login ─────────────────────────────────────────────
    if (path === '/api/login') {
      if (method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      return handleLogin(request, env);
    }

    // ── API: Save Config ───────────────────────────────────────
    if (path === '/api/save-config') {
      if (method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      return handleSaveConfig(request, env);
    }

    // ── Everything else: serve static files ───────────────────
    return env.ASSETS.fetch(request);
  }
};

/* ═══════════════════════════════════════════════════════════
   LOGIN HANDLER
═══════════════════════════════════════════════════════════ */
async function handleLogin(request, env) {
  let username, password;
  try {
    const body = await request.json();
    username   = (body.username || '').trim();
    password   = (body.password || '').trim();
  } catch {
    return jsonResponse({ success: false, message: 'Bad request' }, 400);
  }

  if (!username || !password) {
    return jsonResponse({ success: false, message: 'Username and password are required' }, 400);
  }

  // Fetch users.json from GitHub API (never exposed publicly)
  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  let users = [];

  try {
    const resp = await fetch(
      `https://api.github.com/repos/${REPO}/contents/data/users.json`,
      {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept':        'application/vnd.github.v3+json',
          'User-Agent':    'EVTHS-Dashboard'
        }
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[Login] GitHub API error:', resp.status, errText);
      return jsonResponse({ success: false, message: `GitHub API error ${resp.status}` }, 500);
    }

    const data    = await resp.json();
    const decoded = atob(data.content.replace(/\n/g, ''));
    const parsed  = JSON.parse(decoded);
    users         = parsed.results || [];

  } catch (err) {
    console.error('[Login] Fetch error:', err.message);
    return jsonResponse({ success: false, message: 'Could not load user data: ' + err.message }, 500);
  }

  // Find matching user
  const matched = users.find(u => {
    const uname = pick(u, ['User_Name', 'User Name', 'user_name', 'username', 'UserName']);
    const upass = pick(u, ['Password', 'password', 'pass']);
    return uname.toLowerCase() === username.toLowerCase() && upass === password;
  });

  if (!matched) {
    return jsonResponse({ success: false, message: 'Invalid username or password. Please try again.' }, 401);
  }

  const displayName = pick(matched, ['User_Display_Name', 'User Display Name', 'user_display_name', 'name']) || username;
  const userType    = pick(matched, ['User_Type', 'User Type', 'user_type', 'role']).toLowerCase() || 'internal';

  return jsonResponse({ success: true, displayName, userType });
}

/* ═══════════════════════════════════════════════════════════
   SAVE CONFIG HANDLER
═══════════════════════════════════════════════════════════ */
async function handleSaveConfig(request, env) {
  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    return jsonResponse({ success: false, error: 'GITHUB_TOKEN not configured on server' }, 500);
  }

  let config;
  try {
    const body = await request.json();
    config     = body.config;
    if (!config) throw new Error('No config in body');
  } catch (err) {
    return jsonResponse({ success: false, error: 'Invalid request: ' + err.message }, 400);
  }

  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept':        'application/vnd.github.v3+json',
    'Content-Type':  'application/json',
    'User-Agent':    'EVTHS-Dashboard'
  };

  // Get current file SHA (needed for updates)
  let currentSHA = null;
  try {
    const getResp = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${CONFIG_PATH}?ref=${BRANCH}`,
      { headers: ghHeaders }
    );
    if (getResp.ok) {
      const d = await getResp.json();
      currentSHA = d.sha;
    }
  } catch (err) {
    console.warn('[SaveConfig] Could not get SHA:', err.message);
  }

  // Commit updated config
  const content   = btoa(unescape(encodeURIComponent(JSON.stringify(config, null, 2))));
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  try {
    const putResp = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${CONFIG_PATH}`,
      {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify({
          message: `Dashboard config update · ${timestamp}`,
          content,
          branch: BRANCH,
          ...(currentSHA ? { sha: currentSHA } : {})
        })
      }
    );

    if (putResp.ok) {
      const result = await putResp.json();
      return jsonResponse({ success: true, sha: result.content.sha });
    } else {
      const err = await putResp.json();
      return jsonResponse({ success: false, error: err.message || 'GitHub rejected the update' }, putResp.status);
    }
  } catch (err) {
    return jsonResponse({ success: false, error: 'Network error: ' + err.message }, 500);
  }
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function pick(record, keys) {
  for (const k of keys) {
    if (record[k] != null && String(record[k]).trim() !== '') {
      return String(record[k]).trim();
    }
  }
  return '';
}
