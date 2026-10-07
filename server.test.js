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

async function get(path, authorization) {
  const res = await fetch(baseUrl + path, {
    headers: authorization ? { authorization } : {},
    signal: AbortSignal.timeout(2000), // fail fast instead of hanging if the server never answers
  });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

test('the public page needs no credentials', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
});

test('a request without credentials gets a 401 challenge', async () => {
  const res = await get('/secret');
  assert.equal(res.status, 401);
  assert.equal(
    res.headers.get('www-authenticate'),
    'Basic realm="Basic Auth Demo", charset="UTF-8"',
  );
});

test('valid credentials unlock the secret page', async () => {
  const res = await get('/secret', basic('alice', 'wonderland'));
  assert.equal(res.status, 200);
  assert.match(res.body, /Hello, alice!/);
});

test('passwords can contain colons', async () => {
  const res = await get('/secret', basic('bob', 'yes:we:can'));
  assert.equal(res.status, 200);
  assert.match(res.body, /Hello, bob!/);
});

test('the scheme name is case-insensitive', async () => {
  const res = await get('/secret', basic('alice', 'wonderland').replace('Basic', 'basic'));
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

  for (const [name, header] of Object.entries(badHeaders)) {
    await t.test(name, async () => {
      const res = await get('/secret', header);
      assert.equal(res.status, 401);
      assert.ok(res.headers.has('www-authenticate'));
    });
  }
});
