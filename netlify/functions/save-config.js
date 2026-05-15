/**
 * Netlify Function: /api/save-config
 * ─────────────────────────────────────────────────────────────
 * Saves dashboard_config.json to the GitHub repo using the
 * GITHUB_TOKEN environment variable stored in Netlify.
 * The token is NEVER exposed in the repo or to the browser.
 *
 * Set this in Netlify → Site configuration → Environment variables:
 *   Key:   GITHUB_TOKEN
 *   Value: (your fine-grained GitHub token with Contents read+write)
 */

const REPO        = 'neaidasm/EVTHSArchive';
const CONFIG_PATH = 'data/dashboard_config.json';
const BRANCH      = 'main';

exports.handler = async (event) => {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── Check token is configured ────────────────────────────────
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    console.error('[SaveConfig] GITHUB_TOKEN environment variable is not set');
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'GitHub token not configured on server. Ask admin to set GITHUB_TOKEN in Netlify.' })
    };
  }

  let config;
  try {
    const body = JSON.parse(event.body || '{}');
    config     = body.config;
    if (!config) throw new Error('No config provided');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid request body' }) };
  }

  const headers = {
    Authorization:  `token ${GITHUB_TOKEN}`,
    Accept:         'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent':   'EVTHS-Dashboard'
  };

  // ── Step 1: Get current file SHA (needed for updates) ────────
  let currentSHA = null;
  try {
    const getResp = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${CONFIG_PATH}?ref=${BRANCH}`,
      { headers }
    );
    if (getResp.ok) {
      const data = await getResp.json();
      currentSHA = data.sha;
    }
  } catch (err) {
    console.warn('[SaveConfig] Could not fetch current SHA:', err.message);
    // Proceed anyway — GitHub will reject if needed
  }

  // ── Step 2: Commit updated config ────────────────────────────
  const content   = Buffer.from(JSON.stringify(config, null, 2)).toString('base64');
  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const commitBody = {
    message: `Dashboard config update · ${timestamp}`,
    content,
    branch: BRANCH,
    ...(currentSHA ? { sha: currentSHA } : {})
  };

  try {
    const putResp = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${CONFIG_PATH}`,
      { method: 'PUT', headers, body: JSON.stringify(commitBody) }
    );

    if (putResp.ok) {
      const result = await putResp.json();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          sha:     result.content.sha,
          message: 'Config saved to GitHub successfully'
        })
      };
    } else {
      const err = await putResp.json();
      console.error('[SaveConfig] GitHub API error:', err);
      return {
        statusCode: putResp.status,
        body: JSON.stringify({ success: false, error: err.message || 'GitHub rejected the update' })
      };
    }
  } catch (err) {
    console.error('[SaveConfig] Network error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Network error when contacting GitHub' })
    };
  }
};
