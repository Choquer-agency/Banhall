# Q8 runtime preflight

Read-only preparation. No tests, builds, installs, source edits or dependency mutations were performed. Commands and fixture sketches below are for Q8 execution after its dependency changes.

## Existing coverage and the important limitation

`ChatFeedback.component.test.ts:36` mounts the real AgentChatPanel and checks plain assistant text. Its auth/Convex data is stubbed. `vitest.component.config.ts` aliases the Svelte auth adapter to `convex-auth-stub.ts`; these tests cannot prove a real session-cookie roundtrip. Searches across source/Convex/tests found no cookie/session_token/sessionToken test references. Existing AI instrument/providers/pipeline.compare and Tiptap/editor tests remain useful compatibility checks, not security exploit proofs.

**Production does not currently opt into SVG diagrams.** `MessageContent.svelte` renders `<Streamdown content={text} />`. Installed Streamdown3.1.2 `Elements/Element.svelte:19` chooses `components?.mermaid ?? MermaidFallback`; its README519–551 documents opt-in heavy components. The default MermaidFallback displays a code block. Do not enable Mermaid in production to make an audit pass. Qualify the earlier dependency report: Mermaid is in the installed dependency graph, but this production component does not establish an executable diagram path or exploit.

## Two small browser cases

Use audit-only files under `.audit/quality-pass/Q8/runtime/`. Create a temporary config that imports existing component config with `../../../../vitest.component.config.ts`, spreads its top-level/test settings, and **replaces** `test.include` with the explicit audit-test path and `test.browser.instances` with one `{ browser: 'chromium' }`. Do not merge arrays using mergeConfig here: it can retain all existing suites. Keep existing plugins/setup/aliases. Never add sveltekit() to the component config. Run:

```
npx vitest run --config .audit/quality-pass/Q8/runtime/component.config.ts
```

One `.svelte` fixture can import actual MessageContent through `$lib` and a separate opt-in dependency control:

```svelte
<script>
  import MessageContent from '$lib/components/chat/primitives/MessageContent.svelte';
  import { Streamdown } from 'svelte-streamdown';
  import Mermaid from 'svelte-streamdown/mermaid';
  let { content } = $props();
</script>
<section data-case="production"><MessageContent markdown text={content} /></section>
<section data-case="dependency"><Streamdown {content} components={{ mermaid: Mermaid }} /></section>
```

Mount with `vitest-browser-svelte` and content containing a normal bold paragraph and a completed fenced Mermaid `flowchart TD` with `A[Alpha] --> B[Beta]`. Assert production has the rendered strong text, a `[data-streamdown-mermaid] pre code` containing diagram source, and zero `[data-mermaid-svg]`. For the explicit dependency control, poll for `[data-mermaid-svg] g.node` count2 and labels Alpha/Beta. Merely finding an SVG element is insufficient: Mermaid creates an empty SVG before async rendering and catches rendering errors as console warnings. Preserve warning/error output; require real graph children and labels. The actual dependency uses dynamic import onMount and calls Mermaid.render under strict security defaults.

Then update/rerender content from an incomplete normal markdown sentence to completed bold text, asserting the final text and formatting. Keep diagram input complete and stable for the SVG control to avoid conflating partial diagram parsing with the upgrade. Record this as opt-in library compatibility, not an existing application SVG feature. No mock for Streamdown/Mermaid/DOMPurify.

Audit test suffixes can trip discovery guards if left as unregistered test files. After capturing evidence, archive fixture/test/config bytes as `.txt` or equivalent non-discoverable audit artifacts and remove temporary executable test/config files before root's canonical gate.

## Resolve the cookie that Kit actually loads

Do not `import 'cookie'` from the audit script and assume it is Kit's overridden copy. Use a require anchored to the installed Kit package:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const rootRequire = createRequire(new URL('../../../../package.json', import.meta.url));
const kitRequire = createRequire(rootRequire.resolve('@sveltejs/kit/package.json'));
const cookiePath = kitRequire.resolve('cookie');
const { parse, serialize } = kitRequire('cookie');
assert.equal(kitRequire('cookie/package.json').version, '0.7.2');
const token = 'audit.token+/%value';
const header = serialize('__Secure-better-auth.session_token', token, {
  path: '/', domain: 'example.test', httpOnly: true, secure: true, sameSite: 'lax'
});
assert.equal(parse(header.split(';')[0])['__Secure-better-auth.session_token'], token);
for (const field of ['Path=/', 'Domain=example.test', 'HttpOnly', 'Secure', 'SameSite=Lax'])
  assert.ok(header.includes(field));
assert.throws(() => serialize('bad;name', token), TypeError);
assert.throws(() => serialize('session', token, { path: '/;bad' }), TypeError);
assert.throws(() => serialize('session', token, { domain: 'bad;domain' }), TypeError);
console.log(JSON.stringify({ cookiePath, header, result: 'passed' }));
```

Run `node .audit/quality-pass/Q8/runtime/cookie-check.mjs`. These are synthetic non-secret values. This proves the real overridden API, not login/network integration.

For the application's actual hook path, supplement through an audit-only Vite SSR loader using the existing Vite config: `createServer({configFile: absoluteExistingConfig, server:{middlewareMode:true}, appType:'custom'})`, then `server.ssrLoadModule` for the installed Kit `src/runtime/server/cookie.js` absolute path and real `@mmailaender/convex-better-auth-svelte/sveltekit` module. Close the server in finally. Set public placeholder env values using the gate's existing preflight defaults. Plain Node import of the SvelteKit adapter fails on `$env/static/public`, so do not waste time trying it.

Use `get_cookies(new Request(url,{headers:{cookie: serializedPair}}),new URL(url)).cookies` and pass that real Cookies object to the adapter's cookie-only `getToken(cookies)` overload. Derive the JWT name from real `JWT_COOKIE_NAME` in `@convex-dev/better-auth/plugins`; test secure and unprefixed `better-auth.${JWT_COOKIE_NAME}` names, no-cookie undefined, and secure-name priority when both exist. `src/hooks.server.ts:10` uses exactly this overload, so it needs neither createAuth nor a remote service. Keep session-token serialization and Convex JWT extraction distinct; neither proves actual authentication against a server.

## Client module evidence without changing production config

Existing Vite config exports a static object and includes Tailwind, SvelteKit's Vercel adapter/runes settings, version polling and SSR noExternal. Reuse it; do not reconstruct plugins. A temporary audit `.ts` config can import it and export `{...base, plugins:[...base.plugins, observer]}`. Run with the same public placeholder environment as normal build:

```
npx vite build --config .audit/quality-pass/Q8/runtime/vite-observe.config.ts
```

Observer sketch:

```js
const observer = {
  name: 'q8-client-evidence',
  applyToEnvironment: environment => environment.name === 'client',
  generateBundle(options, bundle) {
    const chunks = Object.values(bundle).filter(output => output.type === 'chunk');
    const rows = chunks.flatMap(chunk => Object.entries(chunk.modules).map(([id, m]) => ({
      chunk: chunk.fileName, id, renderedLength: m.renderedLength
    })));
    if (!chunks.length || !rows.some(row => row.renderedLength > 0))
      this.error('No rendered client module evidence');
    const forbidden = /node_modules\/(?:react(?:-dom)?\/|@convex-dev\/better-auth\/dist\/(?:react|react-start|nextjs)\/)/;
    if (rows.some(row => forbidden.test(row.id.replaceAll('\\', '/'))))
      this.error('React runtime or adapter entered client module graph');
    // Write rows, output directory and per-chunk SHA256(code) under audit only.
  }
};
```

Vite8 installed types support applyToEnvironment; Rolldown's installed RenderedModule declaration includes renderedLength. Assert the audit evidence file was actually created by this invocation, with nonempty rows and at least one rendered application module. This prevents a vacuous pass if Kit's build invocation fails to carry the plugin to its client environment. Exclude SSR by environment, not filename guesses. Record full IDs even when renderedLength is0; absence from the emitted client module graph is stronger than scanning minified strings. Hash emitted chunk code and compare corresponding files after build; fail if another write changes them. Do not reuse stale evidence. These are observations of the current app build, separate from the opt-in component fixture.

The observer must not emit code, alter chunks, configure externals, or supply fake React aliases. After evidence capture remove temporary configuration. Root remains owner of the complete final gate.
