import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const PATCH = "neon/patches/2026-11-09-avatar-path-and-display-names.sql";
const PATCHED_FUNCTIONS = [
  "update_my_trip_profile",
  "grant_trip_member_by_email",
  "resolve_admin_request",
];

// Text from "create [or replace] function public.<name>" through the closing "$$;".
function functionText(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`));
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", sql.indexOf("as $$", start));
  expect(end, `${name} has a closing $$;`).toBeGreaterThan(start);
  return sql.slice(start, end + 3);
}

const normalise = (text: string) =>
  text.replace(/create or replace function/, "create function").replace(/\s+/g, " ").trim();

describe("Neon schema contract: avatar paths and public display names", () => {
  const schema = read("neon/schema.sql");

  it("only lets a member set an avatar path that is null, unchanged, or under their own id", () => {
    const body = functionText(schema, "update_my_trip_profile");
    expect(body).toContain("'Avatar path must belong to you'");
    expect(body).toContain("auth.user_id() || '/'");
    expect(body).toContain("is distinct from current_avatar_path");
    expect(body).toContain("Join the trip before editing your profile");
  });

  it("does not copy an email address into a member's public display name when granting access", () => {
    const body = functionText(schema, "grant_trip_member_by_email");
    expect(body).not.toContain(`coalesce(nullif("name", ''), email)`);
  });

  it("does not copy an email-shaped admin request name into trip_members", () => {
    const body = functionText(schema, "resolve_admin_request");
    expect(body).not.toMatch(/'admin',\s*req\.display_name\s*\)/);
    expect(body).toContain("req.display_name is distinct from req.email");
  });

  it("keeps the upgrade patch in step with schema.sql", () => {
    const patch = read(PATCH);
    for (const name of PATCHED_FUNCTIONS) {
      expect(patch).toContain(`create or replace function public.${name}(`);
      expect(normalise(functionText(patch, name)), `${name} matches schema.sql`).toBe(
        normalise(functionText(schema, name)),
      );
    }
  });
});
