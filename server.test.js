import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { app } from './server.js';

let server;
let baseUrl;

before(async () => {
  server = http.createServer(app).listen(0); // port 0: let the OS pick a free port
  await once(server, 'listening');
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => server.close());

// What a client puts in the Authorization header: "Basic " + base64("username:password").
function basic(username, password) {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

async function request(method, path, headers = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    signal: AbortSignal.timeout(2000), // fail fast instead of hanging if the server never answers
  });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

const alice = { authorization: basic('alice', 'wonderland') };

test('the public page needs no credentials', async () => {
  const res = await request('GET', '/');
  assert.equal(res.status, 200);
});

test('a request without credentials gets a 401 challenge', async () => {
  const res = await request('GET', '/secret');
  assert.equal(res.status, 401);
  assert.equal(
    res.headers.get('www-authenticate'),
    'Basic realm="Basic Auth Demo", charset="UTF-8"',
  );
});

test('valid credentials unlock the secret page', async () => {
  const res = await request('GET', '/secret', alice);
  assert.equal(res.status, 200);
  assert.match(res.body, /Hello, alice!/);
});

test('passwords can contain colons', async () => {
  const res = await request('GET', '/secret', { authorization: basic('bob', 'yes:we:can') });
  assert.equal(res.status, 200);
  assert.match(res.body, /Hello, bob!/);
});

test('the scheme name is case-insensitive', async () => {
  const authorization = basic('alice', 'wonderland').replace('Basic', 'basic');
  const res = await request('GET', '/secret', { authorization });
  assert.equal(res.status, 200);
});

test('bad credentials get another challenge', async (t) => {
  const badHeaders = {
    'wrong password': basic('alice', 'nope'),
    'unknown user': basic('mallory', 'wonderland'),
    "another user's password": basic('alice', 'yes:we:can'),
    'empty username and password': basic('', ''),
    'inherited property name': basic('constructor', ''),
    'different scheme': 'Bearer ' + Buffer.from('alice:wonderland').toString('base64'),
    'no colon': 'Basic ' + Buffer.from('alicewonderland').toString('base64'),
    'not base64': 'Basic !!!',
  };

  for (const [name, authorization] of Object.entries(badHeaders)) {
    await t.test(name, async () => {
      const res = await request('GET', '/secret', { authorization });
      assert.equal(res.status, 401);
      assert.ok(res.headers.has('www-authenticate'));
    });
  }
});

test('logging out makes the browser ask for the password again', async () => {
  // The secret page has a logout button, and isn't cached, so Back can't bring it back.
  const page = await request('GET', '/secret', alice);
  assert.match(page.body, /<form method="post" action="\/logout">/);
  assert.equal(page.headers.get('cache-control'), 'no-store');

  // Clicking it sets a cookie.
  const logout = await request('POST', '/logout', alice);
  assert.equal(logout.status, 200);
  const cookie = logout.headers.get('set-cookie').split(';')[0];
  assert.equal(cookie, 'logged_out=1');

  // The browser still sends alice's password, but with the cookie it's rejected once,
  // and that rejection deletes the cookie.
  const rejected = await request('GET', '/secret', { ...alice, cookie });
  assert.equal(rejected.status, 401);
  assert.ok(rejected.headers.has('www-authenticate'));
  assert.match(rejected.headers.get('set-cookie'), /^logged_out=;.*Max-Age=0/);

  // The password typed into the login dialog is then accepted again.
  const again = await request('GET', '/secret', alice);
  assert.equal(again.status, 200);
});
