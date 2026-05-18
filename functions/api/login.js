/**
 * Cloudflare Pages Function: /api/login
 * ─────────────────────────────────────────────────────────────
 * Fetches users.json from GitHub API server-side.
 * GITHUB_TOKEN is stored in Cloudflare environment variables.
 */

const REPO = 'neaidasm/EVTHSArchive';

export async function onRequestPost(context) {
  const { request, env } = context;

  // Parse request body
  let username, password;
  try {
    const body = await request.json();
    username   = (body.username || '').trim();
    password   = (body.password || '').trim();
  } catch {
    return Response.json({ success: false, message: 'Bad request' }, { status: 400 });
  }

  if (!username || !password) {
    return Response.json(
      { success: false, message: 'Username and password are required' },
      { status: 400 }
    );
  }

  // ── Fetch users.json securely via GitHub API ─────────────────
  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  let users = [];

  try {
    const apiUrl = `https://api.github.com/repos/${REPO}/contents/data/users.json`;
    const headers = {
      Accept:       'application/vnd.github.v3+json',
      'User-Agent': 'EVTHS-Dashboard'
    };
    if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

    const resp = await fetch(apiUrl, { headers });
    if (!resp.ok) throw new Error(`GitHub API returned ${resp.status}`);

    const data    = await resp.json();
    // GitHub returns file content as base64
    const decoded = atob(data.content.replace(/\n/g, ''));
    const parsed  = JSON.parse(decoded);
    users         = parsed.results || [];

  } catch (err) {
    console.error('[Login] Could not fetch users.json:', err.message);
    return Response.json(
      { success: false, message: 'User data unavailable. Please try again shortly.' },
      { status: 500 }
    );
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
    const uname = getField(u, ['User_Name','User Name','user_name','username','UserName']);
    const upass = getField(u, ['Password','password','pass']);
    return uname.toLowerCase() === username.toLowerCase() && upass === password;
  });

  if (!matched) {
    return Response.json(
      { success: false, message: 'Invalid username or password. Please try again.' },
      { status: 401 }
    );
  }

  // ── Return safe user info (password never sent back) ─────────
  const displayName = getField(matched,
    ['User_Display_Name','User Display Name','user_display_name','name']) || username;
  const userType = getField(matched,
    ['User_Type','User Type','user_type','role']).toLowerCase() || 'internal';

  return Response.json({
    success:     true,
    displayName: displayName,
    userType:    userType   // 'internal' | 'external' | 'admin'
  });
}

// Block all non-POST requests
export async function onRequest(context) {
  if (context.request.method === 'POST') {
    return onRequestPost(context);
  }
  return new Response('Method Not Allowed', { status: 405 });
}
