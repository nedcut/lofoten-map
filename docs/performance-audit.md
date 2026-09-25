# Performance audit — September 25, 2026

Audited the production build, initial client imports, trip refreshes, map effects,
media loading, and journey playback against `0d51241` on `main`.

## Changes and measured results

| Finding | Change | Evidence |
| --- | --- | --- |
| Sign-in, single-item editors, and admin tools were in the initial client import graph, even for viewers who never render them. | Load these components dynamically at their existing conditional render boundaries, on both desktop and mobile. | Initial HTML script payload: **1,308,734 → 1,258,557 bytes**; gzip estimate: **377,953 → 363,517 bytes** (3.8% reduction). |
| A poll changing any record replaced all collections. Day filtering then allocated new arrays, invalidating photo-marker effects even when only a note changed. | Reuse each unchanged collection, memoize day filters independently, and return the source array for All days. | Regression tests verify updated content, unchanged collection identity, and silent-poll behavior. This removes unnecessary photo-marker effect invalidation for note-only refreshes; actual rendering time was not measured. |
| Location checking scanned every photo for every candidate, even across unrelated days. | Advance a window over the sorted timestamps and compare only nearby photos. Preserve inclusive boundaries, ordering, duplicate-ID exclusion, and the existing outlier calculation. | For 10,000 synthetic photos, median **451.1 → 32.9 ms** over seven runs after warm-up (13.7× faster); complete outputs match. |

The location-check fixture has one photo per minute, with every 97th photo moved
away from the cluster. It is a scaling probe, not a measurement of the live trip.
Dense clusters still require processing all neighbors in the time window; this
change does not eliminate that worst case.

## Reproduction

Both builds used the same installed dependencies (Next 16.3.5, React 19.3.0),
Node 24.21.0, local demo mode, and an empty Mapbox token. The baseline was built
before editing; its output was preserved outside the checkout.

```sh
NEXT_PUBLIC_LOCAL_DEMO_MODE=1 NEXT_PUBLIC_MAPBOX_TOKEN='' NEXT_DIST_DIR=.next-e2e npm run build
node scripts/performance-audit.mjs 0d51241 .next-e2e
```

The script checks output equivalence and measures old/new location checking in
the same process. It also totals unique `<script src>` files from the supplied
build's home-page HTML, both raw and gzip-compressed. Run it against a preserved
baseline build to compare bundle totals. Timings vary by machine and load.
This baseline and current implementation use the same unchanged `geo.ts` helpers.

Script payload is not total network traffic: it excludes later dynamic chunks,
media, map tiles, and API responses. Admin viewers still download admin tools
when rendered. These are byte and computation measurements, not Core Web Vitals.

## Verification and limits

- `npm run ci`: lint, typecheck, and all 335 tests passed.
- Production build passed; all 11 desktop/mobile Playwright tests passed.
- Local browser inspected the demo shell and deferred editor behavior.
- Boundary and regression tests cover outlier windows and collection reuse.

Existing optimizations include dynamic Mapbox/journey loading, resized media and
thumbnails, limited photo-editor rendering, React Compiler, and polling that
pauses in hidden tabs. They remain in place.

Live backend latency, real media transfer sizes, mobile-device Core Web Vitals,
and Mapbox/WebGL frame rates were not measured. The local run had no Mapbox
token and used synthetic/demo data. Vercel analytics endpoints returned the
same local-only 404s before and after.

Further profiling should focus on the remaining backend SDK payload and journey
camera work: `pointAlongLeg` traverses route vertices each animation frame, and
the mini-map resends multiple GeoJSON sources when its active item changes.
These are candidates for a separate map-enabled profile; no frame-rate gain is
claimed here. Replacing the backend SDK or rewriting the animation without that
evidence would broaden this change substantially.
