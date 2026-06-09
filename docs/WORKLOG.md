# Work Log

Chronological notes for meaningful project checkpoints. Keep entries short:
what changed, why it mattered, and any verification worth remembering.

## 2026-06-09

- Added this work log and a separate todo list so ongoing polish does not get
  buried in chat history.
- Refreshed README feature/roadmap wording to match the current app: public
  reads, public photo URLs, admin request workflow, and current admin tools.
- Latest verified baseline before this doc pass: `npm run lint`,
  `npm run typecheck`, `npm run test`, and `NEXT_PUBLIC_LOCAL_DEMO_MODE=1 npm run build`.

## Recent Checkpoints

- `23e00e3` - Photo popups no longer render broken empty images when a photo URL
  is missing or not resolved.
- `8f55bf9` - Added in-app admin request workflow for non-admin members.
- `923ff03` - Made the trip publicly viewable while keeping editing gated behind
  sign-in and membership.
- `81804e2` - Simplified photo import by removing the name step and tightening
  placement/upload behavior.
- `b591c9b` / later schema updates - Moved photo rows to storage paths and then
  public URL resolution for reliable guest viewing.
