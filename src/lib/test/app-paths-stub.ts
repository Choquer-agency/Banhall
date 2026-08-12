/**
 * Component-test stub for SvelteKit's `$app/paths`. The component config
 * deliberately runs without the Kit plugin, but presentational components may
 * still build hrefs with `resolve()` (required by svelte-autofixer). This
 * mirrors resolve()'s param interpolation with an empty base path.
 */
export function resolve(id: string, params?: Record<string, string>): string {
  return id.replace(/\[{1,2}([^\]=]+?)(?:=[^\]]+)?\]{1,2}/g, (_match, key: string) => {
    const name = key.replace(/^\.\.\./, "");
    return params?.[name] ?? "";
  });
}

export const base = "";
export const assets = "";
