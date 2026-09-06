import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'vite';
const rootRequire = createRequire(new URL('../../../../package.json', import.meta.url));
const kitRequire = createRequire(rootRequire.resolve('@sveltejs/kit/package.json'));
const cookiePath = kitRequire.resolve('cookie');
const { parse, serialize } = kitRequire('cookie');
assert.equal(kitRequire('cookie/package.json').version, '0.7.2');
const token = 'audit.token+/%value';
const header = serialize('__Secure-better-auth.session_token', token, {
  path: '/', domain: 'example.test', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 3600,
  expires: new Date('2030-01-01T00:00:00Z')
});
assert.equal(parse(header.split(';')[0])['__Secure-better-auth.session_token'], token);
for (const field of ['Path=/', 'Domain=example.test', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=3600', 'Expires=Tue, 01 Jan 2030 00:00:00 GMT']) assert.ok(header.includes(field));
assert.throws(() => serialize('bad;name', token), TypeError);
assert.throws(() => serialize('session', token, { path: '/;bad' }), TypeError);
assert.throws(() => serialize('session', token, { domain: 'bad;domain' }), TypeError);
console.log(JSON.stringify({ cookiePath, header, serializer: 'passed' }));
const server = await createServer({configFile: resolve('vite.config.ts'), server:{middlewareMode:true}, appType:'custom'});
try {
  const { get_cookies } = await server.ssrLoadModule(resolve('node_modules/@sveltejs/kit/src/runtime/server/cookie.js'));
  const { getToken } = await server.ssrLoadModule('@mmailaender/convex-better-auth-svelte/sveltekit');
  const { JWT_COOKIE_NAME } = await server.ssrLoadModule('@convex-dev/better-auth/plugins');
  const name = `better-auth.${JWT_COOKIE_NAME}`;
  const secureName = `__Secure-${name}`;
  const url = new URL('https://example.test/project/audit');
  const extract = (cookie) => getToken(get_cookies(new Request(url,{headers:{cookie}}),url).cookies);
  assert.equal(extract(''), undefined);
  assert.equal(extract(serialize(name, token)), token);
  assert.equal(extract(serialize(secureName, token)), token);
  assert.equal(extract(`${serialize(name,'fallback')}; ${serialize(secureName,token)}`), token);
  console.log(JSON.stringify({integration:'real Kit Cookies to real Svelte adapter getToken', cases:4, result:'passed'}));
} finally { await server.close(); }
