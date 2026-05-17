/**
 * Netlify Function: /api/login
 * ─────────────────────────────────────────────────────────────
 * Fetches users.json from GitHub API (server-side only).
 * The file is blocked from public access via netlify.toml.
 * Uses GITHUB_TOKEN env variable — same one used for save-config.
 */

const REPO = 'neaidasm/EVTHSArchive';

exports.handler = async (event) => {

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse request body
  let username, password;
  try {
    const body = JSON.parse(event.body || '{}');
    username   = (body.username || '').trim();
    password   = (body.password || '').trim();
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, message: 'Bad request' })
    };
  }

  if (!username || !password) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, message: 'Username and password are required' })
    };
  }

  // ── Fetch users.json securely via GitHub API ─────────────────
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  let users = [];

  try {
    const apiUrl = `https://api.github.com/repos/${REPO}/contents/data/users.json`;
    const headers = {
      Accept:       'application/vnd.github.v3+json',
      'User-Agent': 'EVTHS-Dashboard'
    };
    if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

    const resp = await fetch(apiUrl, { headers });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[Login] GitHub API error:', resp.status, errText);
      throw new Error(`GitHub API returned ${resp.status}`);
    }

    const data    = await resp.json();
    // GitHub returns file content as base64
    const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
    const parsed  = JSON.parse(decoded);
    users         = parsed.results || [];

  } catch (err) {
    console.error('[Login] Could not fetch users.json:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: 'User data unavailable. Please try again shortly.'
      })
    };
  }

  // ── Match username + password ─────────────────────────────────
  function getField(record, variants) {
    for (const v of variants) {
      if (record[v] !== undefined && record[v] !== null && String(record[v]).trim() !== '') {
        return String(record[v]).trim();
      }
    }
    return '';
  }

  const matched = users.find(u => {
    const uname = getField(u, ['User_Name', 'User Name', 'user_name', 'username', 'UserName']);
    const upass = getField(u, ['Password', 'password', 'pass']);
    return uname.toLowerCase() === username.toLowerCase() && upass === password;
  });

  if (!matched) {
    return {
      statusCode: 401,
      body: JSON.stringify({
        success: false,
        message: 'Invalid username or password. Please try again.'
      })
    };
  }

  // ── Return safe user info (password never sent back) ─────────
  const displayName = getField(matched,
    ['User_Display_Name', 'User Display Name', 'user_display_name', 'name']) || username;
  const userType = getField(matched,
    ['User_Type', 'User Type', 'user_type', 'role']).toLowerCase() || 'internal';

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success:     true,
      displayName: displayName,
      userType:    userType    // 'internal' | 'external' | 'admin'
    })
  };
};
