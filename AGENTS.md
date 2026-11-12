# Lofoten Logbook: agent instructions

## Verified means

A change is verified when `npm run verify` passes and, for anything a person sees or touches, you have used it in a browser yourself. `package.json` defines what `verify` runs; the pre-push hook and CI run the same scripts.

- **Map and Journey Mode changes need the real map.** Markers, popups, camera moves, placing things by clicking, and the Journey mini-map only exist with a Mapbox token. The `desktop` and `mobile` Playwright projects run without one and cannot see any of it. The `map` project (`e2e/map.spec.ts`) can: run it, and put the regression test for map behaviour there. Playwright prints a warning when it skips the `map` project for lack of a token; treat that run as mapless and say so.
- **Use it by hand** on desktop and at phone width before calling UI work done. Run the app in demo mode (`NEXT_PUBLIC_LOCAL_DEMO_MODE=1`, data is in memory and resets on reload). State in the PR what you did and saw.
- **A bug fix starts red.** Write the test, watch it fail for the right reason, then fix.
- **Specs import `test` from `e2e/fixtures.ts`.** It fails a test on any uncaught exception or console error.
- The unit-coverage floor in `vitest.config.ts` is a ratchet. Raise it when coverage grows; lower it only with a reason in the PR.

## Traps this codebase has already fallen into

- **The main map is `display: none` while Journey Mode is open.** Its canvas then measures 0x0 and Mapbox may fire no events when it returns. Code that reads canvas size or waits on a map event has to handle both.
- **A press can change the layout before the click lands.** Journey dismisses its title card on pointer-down; anything that moves or re-stacks in response can steal the pointer-up from the control under it.
- **Times are trip time (Norway), never the browser's zone.** Use `lib/trip-time.ts`. Run time tests under another zone (`TZ=America/New_York`) to prove it.
- **The Mapbox token is inlined at build time.** A different token needs a different build and dist dir, which is why Playwright serves two.

## Production

https://lofoten-logbook.vercel.app is the live trip with real photos. Look at it signed out, read-only. Uploads, edits, deletes, and SQL against the production database need the owner's explicit go-ahead each time.
