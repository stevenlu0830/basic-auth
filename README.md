# basic-auth

A tiny Node.js app that shows what HTTP Basic Authentication looks like in code. It uses only Node's built-in modules (no frameworks, no dependencies), so every step of the protocol is visible in [`server.js`](server.js).

## Run it

You need Node.js 24.2 or newer.

```bash
npm start
```

Open <http://localhost:3000/secret>. Your browser shows a login dialog; sign in with one of the demo accounts:

| Username | Password     |
| -------- | ------------ |
| `alice`  | `wonderland` |
| `bob`    | `yes:we:can` |

<http://localhost:3000/> is public and never asks for a password. The secret page has a **Log out** button, which takes a workaround because Basic Auth has no logout of its own (see [Logging out](#logging-out)).

## What happens

The terminal running the server logs each of these steps.

1. The browser asks for the page without credentials:

   ```http
   GET /secret HTTP/1.1
   ```

2. The server refuses with `401` and a `WWW-Authenticate` header. This is the "challenge": it says "log in using the Basic scheme", and it is what makes the browser show its login dialog.

   ```http
   HTTP/1.1 401 Unauthorized
   WWW-Authenticate: Basic realm="Basic Auth Demo", charset="UTF-8"
   ```

3. You type a username and password, and the browser repeats the request with an `Authorization` header: the word `Basic`, a space, and `username:password` encoded as base64.

   ```http
   GET /secret HTTP/1.1
   Authorization: Basic YWxpY2U6d29uZGVybGFuZA==
   ```

4. The server decodes the header, checks the username and password, and returns the page (`200 OK`), or another `401` if they're wrong.

Basic Auth has no sessions or cookies. The browser remembers what you typed and sends the same `Authorization` header with every later request to the site, and the server checks it every time.

The header is not encrypted. Decode it yourself:

```bash
echo YWxpY2U6d29uZGVybGFuZA== | base64 --decode
```

## Logging out

Basic Auth has no logout. The browser keeps resending the saved password until you quit it, and a resent password looks exactly like one you just typed, so the server can't tell them apart.

The app works around this with one browser behavior: when the server rejects a password the browser saved, the browser forgets it and shows the login dialog again. So:

1. **Log out** sends `POST /logout`, which sets a `logged_out=1` cookie.
2. The next request for `/secret` arrives with the saved password *and* the cookie. The server answers `401` anyway, and deletes the cookie.
3. The browser forgets the saved password and shows the login dialog. What you type next is accepted, because the cookie is gone.

The secret page is also sent with `Cache-Control: no-store`, so after logging out the Back button can't show it from the cache.

You can see the server's side with curl: the right password gets a `401` when the cookie is present.

```bash
curl -i -u alice:wonderland -b logged_out=1 http://localhost:3000/secret
```

## Try it from the terminal

With the server running, in another terminal:

```bash
# No credentials: 401 plus the WWW-Authenticate challenge
curl -i http://localhost:3000/secret

# -u makes curl build the Authorization header for you
curl -i -u alice:wonderland http://localhost:3000/secret

# ...which is the same as building it by hand
curl -i -H "Authorization: Basic $(printf 'alice:wonderland' | base64)" http://localhost:3000/secret

# Wrong password: 401 again
curl -i -u alice:wrong http://localhost:3000/secret
```

Add `-v` to any of these to see the exact headers curl sends.

[`client.js`](client.js) does the same from JavaScript with `fetch`:

```bash
npm run client
```

## Where to look in the code

In [`server.js`](server.js):

- `parseBasicAuth()` reads the `Authorization` header: it checks for the `Basic` scheme, decodes the base64, and splits on the first `:`. A username can't contain a colon but a password can, which is why bob's password has some.
- `checkCredentials()` and `safeEqual()` compare the credentials in constant time, so how long the server takes to answer doesn't leak hints about the password.
- `sendChallenge()` sends the `401` challenge. The `/secret` branch of `app()` calls it when the credentials are missing or wrong, or right after a logout.
- The `/logout` branch of `app()` and the cookie check at the top of the `/secret` branch implement logging out.

## Before you use Basic Auth for real

- **Use HTTPS.** Base64 is an encoding, not encryption, so anyone who can see the traffic can read the password. This demo uses plain HTTP only because it runs on localhost.
- **Store password hashes, not passwords.** A real app keeps a slow hash (bcrypt, scrypt or argon2) and compares against that. This demo keeps plaintext passwords in the source to stay readable.
- **Logout is a workaround.** It relies on how browsers react to a rejected password, not on any standard, and the browser still holds the password until your next visit to `/secret`.
- **It suits machines and internal tools best**: scripts calling an API, a staging site, an admin page. For login on a user-facing site, sessions or tokens give you logout, expiry and a proper login page.

## Tests

```bash
npm test
```
