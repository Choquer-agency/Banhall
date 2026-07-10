# Svelte migration — conventions + status

Branch: `svelte-migration`. Old React app (`src/app/`, `src/components/`) stays
on disk as the porting reference until parity; SvelteKit app lives in
`src/routes/` + `src/lib/`. Backend (`convex/`) unchanged.

## Stack

- SvelteKit 2.63 / Svelte 5 (runes, forced on) / Vite 8 / bun / TS
- Kit config lives in `vite.config.ts` plugin options (no svelte.config.js)
- `@sveltejs/adapter-vercel`, Tailwind v4 via `@tailwindcss/vite`
- `convex-svelte` 0.14 (queries/mutations), `@mmailaender/convex-auth-svelte`
  (Convex Auth; server hooks + cookie SSR state)
- `bits-ui` (headless primitives), manual `components.json` for shadcn-svelte add
- `svelte-tiptap` (editor + SvelteNodeViewRenderer), `svelte-streamdown`
  (chat markdown), `svelte-exmarkdown` (static markdown), plain `gsap` + $effect

## Port conventions (React → Svelte 5)

| React | Svelte |
|---|---|
| `useState(x)` | `let v = $state(x)` |
| computed consts in render | `const d = $derived(...)` (or `$derived.by`) |
| `useEffect(fn, deps)` | `$effect(() => { ...; return cleanup })` (deps auto-tracked) |
| `useRef<HTMLX>` + `.current` | `let el: HTMLX \| null = $state(null)` + `bind:this={el}` |
| `useState(new Set())` | `new SvelteSet()` from `svelte/reactivity` |
| props | `let { a, b = fallback, ...rest }: Props = $props()` |
| `children` / render props | snippets: `Snippet` type, `{@render children?.()}` |
| `className=` | `class=` |
| `onClick/onChange/onSubmit` | `onclick` / `oninput` or `bind:value` / `onsubmit` (call `e.preventDefault()`) |
| `next/link` `<Link href>` | plain `<a href>` |
| `next/image` `<Image>` | plain `<img>` (assets in `static/`) |
| `useRouter().replace(x)` | `goto(x, { replaceState: true })` from `$app/navigation` |
| `useParams()` / route params | `page.params` from `$app/state` (or `let { data } = $props()` from load) |
| `strokeWidth={2}` etc (JSX SVG) | `stroke-width="2"`, `stroke-linecap`, kebab-case |
| conditional JSX | `{#if}` / `{:else if}` / `{/if}`; lists `{#each xs as x (key)}` |
| `process.env.NEXT_PUBLIC_X` | `PUBLIC_X` via `$env/static/public` (or `$env/dynamic/public` if optional) |

## Convex idioms

```svelte
<script lang="ts">
  import { useQuery, useMutation, useConvexClient } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { api } from "../../../convex/_generated/api"; // relative — no alias for convex/
  import type { Doc, Id } from "../../../convex/_generated/dataModel";

  const auth = useAuth(); // { isLoading, isAuthenticated, signIn, signOut }

  // ARGS ARE A GETTER. Gate authed queries on auth state with "skip".
  const projectsQ = useQuery(api.projects.listProjects, () =>
    auth.isAuthenticated ? {} : "skip");
  // read: projectsQ.data / .isLoading / .error   (undefined while loading)

  const doThing = useMutation(api.projects.updateProjectTitle);
  // await doThing({ ... })

  // Auth guard (replaces the useEffect redirect):
  import { goto } from "$app/navigation";
  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) goto("/login", { replaceState: true });
  });
</script>
```

- React `useQuery(api.x.y)` returned data directly; convex-svelte returns
  `{ data, isLoading, error }` — old `x === undefined` loading checks map to
  `xQ.data === undefined` (or `xQ.isLoading`).
- Actions: `useConvexClient()` then `client.action(api...)`, or `useAction`.

## Layout / files

- Route pages: `src/routes/<path>/+page.svelte` (dynamic: `src/routes/project/[id]/+page.svelte`)
- Components: `src/lib/components/**/*.svelte` — PascalCase filenames, default import
  (`import Button from "$lib/components/ui/Button.svelte"`)
- Already ported (use, don't recreate): ui/Button, ui/Badge, ui/Input, ui/ChatIcon,
  ui/IconAction, ui/MenuToggleIcon, ui/Header, BuildStamp, dashboard/ProjectCard;
  routes: `/` `/login` `/dashboard`; layout with setupConvex + setupConvexAuth.
- Pure TS libs stayed at `$lib`: parseDocument, contextCategories, exportTemplateDocx,
  tiptapConfig, utils(cn).
- Global CSS: `src/routes/layout.css` (tokens: canvas/chrome/navy/primary/gap-*;
  tiptap + chat styles already ported).

## Verify

- `bun run check` → must end `0 ERRORS` (a11y warnings: fix them, usually aria-label)
- Dev server usually already running on :3001 (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/<route>`) — don't start/kill it; if down: `bun run dev`
- Don't touch `convex/**` (only exception: type-only import fixes if svelte-check
  flags one, keeping `npx tsc --noEmit -p convex/tsconfig.json` green)
- Don't commit.

## Status — MIGRATION COMPLETE (2026-07-02)

- [x] Scaffold, theme, primitives, auth, login, dashboard
- [x] All routes (admin×3, alerts, review, questionnaire, new, financial, project/[id])
- [x] Editor, chat panels (streaming agent chat incl.), comments, generation UX
- [x] Cutover: React app deleted, next/react deps removed, adapter-vercel build green,
      12/12 routes 200 under `npm run dev` (scripts point at vite — npm/bun/pnpm all work)

## Post-cutover notes

- `$lib/exportTemplateDocx` is NOT SSR-safe — always lazy `await import(...)` in handlers.
- `$lib/chat/agentInternal.ts` deep-imports @convex-dev/agent dist internals —
  re-verify paths on any agent version bump.
- Vercel dashboard (user action at deploy): framework preset → SvelteKit,
  env var renames NEXT_PUBLIC_CONVEX_URL→PUBLIC_CONVEX_URL,
  NEXT_PUBLIC_CONVEX_SITE_URL→PUBLIC_CONVEX_SITE_URL,
  NEXT_PUBLIC_AGENT_CHAT→PUBLIC_AGENT_CHAT, NEXT_PUBLIC_BUILD_TIME→PUBLIC_BUILD_TIME.
- Old NEXT_PUBLIC_* lines in .env.local are inert; PUBLIC_* variants added.
