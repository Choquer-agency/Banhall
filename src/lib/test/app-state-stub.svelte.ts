/**
 * Component-test stub for SvelteKit's `$app/state`. The component config runs
 * without the Kit plugin, but the workspace shell components read `page.url`
 * reactively. The stub mirrors Kit's real contract: `page` is a fine-grained
 * reactive object whose `url` is replaced on real navigations (`goto`) but
 * NOT on shallow `pushState`/`replaceState` — see @sveltejs/kit
 * `src/runtime/client/client.js` (`clone_page()` carries the old `url`
 * forward). Tests drive it through the helpers below.
 */
const INITIAL_URL = "http://localhost:3001/dashboard";

export const page = $state({
  url: new URL(INITIAL_URL),
  params: {} as Record<string, string>,
  route: { id: "/dashboard" as string | null },
  status: 200,
  error: null as unknown,
  data: {} as Record<string, unknown>,
  form: null as unknown,
  state: {} as Record<string, unknown>,
});

export function __setPageUrl(href: string) {
  page.url = new URL(href, INITIAL_URL);
}

/** Route params for dynamic routes (e.g. `/project/[id]` reads `page.params.id`). */
export function __setPageParams(params: Record<string, string>) {
  page.params = params;
}

export function __resetPage() {
  page.url = new URL(INITIAL_URL);
  page.params = {};
  page.state = {};
}

export const navigating = {
  to: null as unknown,
  from: null as unknown,
  type: null as unknown,
  complete: null as unknown,
};

export const updated = { current: false, check: async () => false };
