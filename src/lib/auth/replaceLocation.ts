/** Full-page replace (no Back entry). Its own module so component tests can stub it. */
export function replaceLocation(url: string): void {
  window.location.replace(url);
}
