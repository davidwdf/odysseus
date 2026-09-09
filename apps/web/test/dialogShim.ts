// jsdom's `<dialog>` gap, shimmed once.
//
// **Not a test file** — `vitest.config.ts` collects `test/**/*.test.{ts,tsx,mjs}`, so this is a module that
// two suites import. It began inside `route-detail-states.test.tsx` and moved here the moment a second
// suite needed to mount a sheet: a stub of a platform behaviour is exactly the kind of thing that is right
// in one copy and subtly different in the second.

/**
 * jsdom implements `<dialog>` but not `showModal()`/`close()`, so a component that opens itself modally
 * throws `showModal is not a function` on mount.
 *
 * **Worth a paragraph because of what it explains**: this shim did not exist before WP6-8's blocker fix, and
 * the reason is that **no test in this repo had ever opened a `<dialog>`**. `RouteFactSheet` has been the
 * four fact sheets' container since WP6-6c and is reached only by pressing a pill, which no suite did — so
 * the sheets' content is projected from `routeFactSheet` in the corpus and their *container* has never been
 * mounted. That is the same blind spot this whole row is about: a component behind an interaction is a
 * component no state projection reaches.
 *
 * The shim is deliberately the smallest honest one — `open` on, `open` off — rather than a fake modal: what
 * these tests assert is which actions the sheet offers and what pressing them writes, and focus trapping and
 * inertness are the browser's job and not something a stub could prove anything about.
 */
export function stubDialog(): void {
  const proto = window.HTMLDialogElement?.prototype
  if (!proto || typeof proto.showModal === 'function') return
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
}
