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

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

export function app(req, res) {
  const path = req.url.split('?')[0];

  if (path === '/') {
    const body = 'This page is public.\n\nVisit /secret and log in as alice / wonderland.\n';
    return send(res, 200, body);
  }

  if (path === '/secret') {
    const credentials = parseBasicAuth(req.headers.authorization);

    if (!credentials || !checkCredentials(credentials)) {
      // The challenge: a 401 plus a WWW-Authenticate header saying "log in with Basic Auth".
      // This header is what makes a browser pop up its username/password dialog.
      return send(res, 401, 'You need to log in to see this page.\n', {
        'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      });
    }

    const body = [
      `Hello, ${credentials.username}!`,
      '',
      'Your request included this header:',
      '',
      `    Authorization: ${req.headers.authorization}`,
      '',
      'The part after "Basic " is just base64. Decoded, it reads:',
      '',
      `    ${credentials.username}:${credentials.password}`,
      '',
      'Base64 is an encoding, not encryption: anyone who can see the request can read',
      'the password. That is why Basic Auth should only ever be used over HTTPS.',
      '',
    ].join('\n');
    return send(res, 200, body);
  }

  return send(res, 404, 'Not found.\n');
}

if (import.meta.main) {
  const server = http.createServer((req, res) => {
    // Log every request, so you can watch the handshake: a browser first asks without
    // credentials (401), then retries with the ones you typed (200).
    res.on('finish', () => {
      const auth = req.headers.authorization ? 'with credentials' : 'no credentials';
      console.log(`${req.method} ${req.url} -> ${res.statusCode} (${auth})`);
    });
    app(req, res);
  });

  server.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT}/secret and log in as alice / wonderland`);
  });
}
