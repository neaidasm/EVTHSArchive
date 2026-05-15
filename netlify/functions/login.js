/**
 * Netlify Function: /api/login
 * ─────────────────────────────────────────────────────────────
 * Reads users.json from the deployed site (server-side only —
 * the file is blocked from public access via netlify.toml).
 * Validates username + password and returns the user's role.
 */

const fs   = require('fs');
const path = require('path');

exports.handler = async (event) => {

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let username, password;
  try {
    const body = JSON.parse(event.body || '{}');
    username   = (body.username || '').trim();
    password   = (body.password || '').trim();
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Bad request' }) };
  }

  if (!username || !password) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, message: 'Username and password are required' })
    };
  }

  // ── Read users.json from the deployed files ──────────────────
  // Path: netlify/functions/login.js  →  ../../data/users.json
  let users = [];
  try {
    const filePath = path.join(__dirname, '..', '..', 'data', 'users.json');
    const raw      = fs.readFileSync(filePath, 'utf8');
    const parsed   = JSON.parse(raw);
    users          = parsed.results || [];
  } catch (err) {
    console.error('[Login] Could not read users.json:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'User data unavailable. Try again shortly.' })
    };
  }

  // ── Match user (case-insensitive username, exact password) ───
  function getField(record, variants) {
    for (const v of variants) {
      if (record[v] !== undefined && record[v] !== null && record[v] !== '') {
        return String(record[v]);
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
      body: JSON.stringify({ success: false, message: 'Invalid username or password. Please try again.' })
    };
  }

  // ── Return safe user info (no password) ──────────────────────
  const displayName = getField(matched, ['User_Display_Name', 'User Display Name', 'user_display_name', 'name']) || username;
  const userType    = getField(matched, ['User_Type', 'User Type', 'user_type', 'role']).toLowerCase() || 'internal';

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success:     true,
      displayName: displayName,
      userType:    userType   // 'internal' | 'external' | 'admin'
    })
  };
};
