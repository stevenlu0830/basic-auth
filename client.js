// The client side of Basic Auth: what a program (rather than a browser) does.
// Start the server first with `npm start`, then run `npm run client`.

const url = `http://localhost:${process.env.PORT ?? 3000}/secret`;

// 1. Ask without credentials. The server refuses, and its WWW-Authenticate header
//    says how to log in.
const anonymous = await fetch(url);
console.log(`Without credentials: ${anonymous.status} ${anonymous.statusText}`);
console.log(`WWW-Authenticate: ${anonymous.headers.get('www-authenticate')}\n`);

// 2. Ask again with an Authorization header: "Basic " + base64("username:password").
//    Browsers and `curl -u` build this header for you; here we build it by hand.
const token = Buffer.from('alice:wonderland').toString('base64');
const res = await fetch(url, { headers: { Authorization: `Basic ${token}` } });
console.log(`With "Authorization: Basic ${token}": ${res.status} ${res.statusText}`);
