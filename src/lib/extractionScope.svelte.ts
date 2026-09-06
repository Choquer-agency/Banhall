/** Capture the owner before async work. Reused components must not attach a
 * previous project's file to whichever project happens to be current later. */
export function createExtractionScope(getOwner: () => unknown) {
  let lifetime = new AbortController();
  $effect(() => {
    getOwner();
    lifetime.abort();
    const controller = new AbortController();
    lifetime = controller;
    return () => controller.abort();
  });
  return {
    capture() {
      const owner = getOwner();
      const controller = lifetime;
      return {
        signal: controller.signal,
        throwIfAborted() {
          // Also protects the interval before Svelte flushes an owner change.
          if (getOwner() !== owner) controller.abort();
          controller.signal.throwIfAborted();
        },
      };
    },
  };
}
