// A tiny web server that protects one page with HTTP Basic Authentication.
// It uses only Node's built-in `http` and `crypto` modules, so every step is visible.
//
//   npm start  ->  open http://localhost:3000/secret  ->  log in as alice / wonderland

import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT ?? 3000);

// Names the protected area. The server announces it in the 401 challenge below.
const REALM = 'Basic Auth Demo';

// Demo accounts. A real app would load users from a database and store only a slow
// password hash (bcrypt, scrypt or argon2), never the password itself.
// A Map rather than a plain object, so a username like "constructor" can't match
// a property every object inherits.
const USERS = new Map([
  ['alice', 'wonderland'],
  ['bob', 'yes:we:can'], // a password with colons in it, see parseBasicAuth()
]);

/**
 * Reads an Authorization header and returns { username, password },
 * or null if it isn't well-formed Basic Auth.
 *
 *   Authorization: Basic YWxpY2U6d29uZGVybGFuZA==
 *                  ^^^^^ ^^^^^^^^^^^^^^^^^^^^^^^^
 *                 scheme  base64("alice:wonderland")
 */
function parseBasicAuth(header) {
  // "Basic", one or more spaces, then a base64 string. The scheme is case-insensitive.
  const match = /^Basic +([A-Za-z0-9+/]+={0,2})$/i.exec(header ?? '');
  if (!match) return null;

  const decoded = Buffer.from(match[1], 'base64').toString('utf8');

  // Split on the FIRST colon: a username can't contain ":", but a password can.
  const colon = decoded.indexOf(':');
  if (colon === -1) return null;

  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

function checkCredentials({ username, password }) {
  const expected = USERS.get(username);
  // Compare even when the user doesn't exist, so response times don't reveal
  // which usernames are real.
  const passwordMatches = safeEqual(password, expected ?? '');
  return expected !== undefined && passwordMatches;
}

// `===` stops at the first character that differs, so an attacker timing the responses could
// guess a password one character at a time. timingSafeEqual() always takes the same time,
// but it needs inputs of equal length, so we compare fixed-length hashes of the strings.
function safeEqual(a, b) {
  const sha256 = (text) => crypto.createHash('sha256').update(text).digest();
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

// The challenge: a 401 plus a WWW-Authenticate header saying "log in with Basic Auth".
// This header is what makes a browser pop up its username/password dialog.
function sendChallenge(res, headers = {}) {
  const html = `
    <h1>Please log in</h1>
    <p>This page needs a username and password.
    <a href="/secret">Try again</a> or go <a href="/">home</a>.</p>`;
  sendPage(res, 401, html, {
    'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
    ...headers,
  });
}

function sendPage(res, status, html, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Basic Auth Demo</title>
<style>body { font-family: system-ui; max-width: 40rem; margin: 2rem auto; padding: 0 1rem }</style>
${html}
`);
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

// The Cookie header looks like "theme=dark; logged_out=1".
function hasCookie(req, cookie) {
  return (req.headers.cookie ?? '').split(/; */).includes(cookie);
}

export function app(req, res) {
  const path = req.url.split('?')[0];

  if (path === '/') {
    const html = `
      <h1>Basic Auth Demo</h1>
      <p>This page is public. The <a href="/secret">secret page</a> needs a password:
      log in as <code>alice</code> / <code>wonderland</code>.</p>`;
    return sendPage(res, 200, html);
  }

  if (path === '/secret') {
    // Logging out. Basic Auth has no logout: the browser remembers the password and
    // resends it with every request, and the server can't tell a resent password from
    // a freshly typed one. So "Log out" sets a cookie, and the next request here gets a
    // 401 even if its password is right. Browsers forget a password that gets rejected,
    // so the login dialog comes back. The 401 also deletes the cookie, so the password
    // typed into that dialog is accepted.
    if (hasCookie(req, 'logged_out=1')) {
      return sendChallenge(res, { 'Set-Cookie': 'logged_out=; Path=/; Max-Age=0' });
    }

    const credentials = parseBasicAuth(req.headers.authorization);
    if (!credentials || !checkCredentials(credentials)) {
      return sendChallenge(res);
    }

    const { username, password } = credentials;
    const html = `
      <h1>Hello, ${escapeHtml(username)}!</h1>
      <p>Your request included this header:</p>
      <pre>Authorization: ${escapeHtml(req.headers.authorization)}</pre>
      <p>The part after "Basic" is just base64. Decoded, it reads:</p>
      <pre>${escapeHtml(username)}:${escapeHtml(password)}</pre>
      <p>Base64 is an encoding, not encryption: anyone who can see the request can read
      the password. That is why Basic Auth should only ever be used over HTTPS.</p>
      <form method="post" action="/logout"><button>Log out</button></form>`;
    // no-store, so that after logging out, the Back button can't show this page from cache.
    return sendPage(res, 200, html, { 'Cache-Control': 'no-store' });
  }

  if (path === '/logout' && req.method === 'POST') {
    // Set the cookie that the next visit to /secret acts on (see above).
    const html = `
      <h1>You're logged out</h1>
      <p>Your browser will ask for your password the next time you open
      <a href="/secret">the secret page</a>.</p>`;
    return sendPage(res, 200, html, {
      'Set-Cookie': 'logged_out=1; Path=/; HttpOnly; SameSite=Lax',
    });
  }

  return sendPage(res, 404, '<h1>Not found</h1>');
}

if (import.meta.main) {
  const server = http.createServer((req, res) => {
    // Log every request, so you can watch the handshake: a browser first asks without
    // credentials (401), then retries with the ones you typed (200).
    res.on('finish', () => {
      const notes = [req.headers.authorization ? 'with credentials' : 'no credentials'];
      if (hasCookie(req, 'logged_out=1')) notes.push('logged-out cookie');
      console.log(`${req.method} ${req.url} -> ${res.statusCode} (${notes.join(', ')})`);
    });
    app(req, res);
  });

  server.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT}/secret and log in as alice / wonderland`);
  });
}
