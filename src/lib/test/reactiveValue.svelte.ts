/**
 * A reactive value a component test can change WITHOUT flushing Svelte, so an
 * event dispatched in the same synchronous block still reaches the handlers
 * of the DOM the component rendered before the change. Pass it to a component
 * through a prop getter (`get canEdit() { return capability.value; }`): the
 * component reads the new value at once, while its DOM updates only on the
 * next flush. This models a server update that lands between a user's
 * interaction and the dispatch it triggers.
 */
export function reactiveValue<T>(initial: T) {
  let value = $state(initial);
  return {
    get value() {
      return value;
    },
    set value(next: T) {
      value = next;
    },
  };
}
