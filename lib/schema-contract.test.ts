import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

// 2026-11-09 has already been applied to production and must not change; later
// fixes to the same area live in later patches.
const PATCH = "neon/patches/2026-11-09-avatar-path-and-display-names.sql";
const PATCHED_FUNCTIONS = ["update_my_trip_profile", "resolve_admin_request"];
const TRIGGER_PATCH = "neon/patches/2026-11-10-avatar-path-trigger.sql";
const TRIGGER_PATCHED_FUNCTIONS = ["check_trip_member_avatar_path", "grant_trip_member_by_email"];

// Text from "create [or replace] function public.<name>" through the closing "$$;".
function functionText(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`));
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", sql.indexOf("as $$", start));
  expect(end, `${name} has a closing $$;`).toBeGreaterThan(start);
  return sql.slice(start, end + 3);
}

// The "create trigger" statement for a trigger name, through its closing ";".
function triggerText(sql: string, name: string): string {
  const start = sql.indexOf(`create trigger ${name}`);
  expect(start, `${name} trigger is created`).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf(";", start) + 1);
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
    // The on conflict target and returns-table columns share names (trip_id,
    // user_id); without this directive every call fails as "ambiguous".
    expect(body).toMatch(/as \$\$\s*#variable_conflict use_column\s*declare/);
  });

  it("stores no display name when the account name is empty or is the email address", () => {
    const body = functionText(schema, "grant_trip_member_by_email");
    expect(body).toContain(`lower(btrim("name")) = lower(btrim(email)) then null`);
    expect(body).toContain(`btrim("name") ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then null`);
  });

  it("stops every API writer, admins included, from giving a member a foreign avatar path", () => {
    const body = functionText(schema, "check_trip_member_avatar_path");
    // Only API callers are checked; database owners, psql and neon/migration/ are not.
    expect(body).toMatch(/if nullif\(auth\.user_id\(\), ''\) is null then\s+return new;/);
    // The row's owner, not the caller, decides which prefix is allowed.
    expect(body).toContain("starts_with(new.avatar_path, new.user_id::text || '/')");
    expect(body).toContain("new.avatar_path is not distinct from old.avatar_path");
    // An unchanged path counts only while the owner is unchanged: moving a row to
    // another user_id and back must not leave it holding that user's key.
    expect(body).toMatch(/tg_op = 'UPDATE'\s+and new\.user_id = old\.user_id\s+and new\.avatar_path is not distinct from old\.avatar_path/);
    expect(body).toContain("errcode = '42501'");
    expect(triggerText(schema, "trip_members_check_avatar_path")).toMatch(
      /before insert or update of avatar_path, user_id\s+on public\.trip_members\s+for each row execute function public\.check_trip_member_avatar_path\(\)/,
    );
    // Leave the RLS policy alone: the trigger, not the policy, owns this rule.
    expect(schema).toMatch(/create policy "admins write trip memberships"\s+on public\.trip_members for all to authenticated\s+using \(public\.is_trip_admin\(trip_id\)\)\s+with check \(public\.is_trip_admin\(trip_id\)\)/);
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

  it("keeps the avatar-path trigger patch in step with schema.sql", () => {
    const patch = read(TRIGGER_PATCH);
    for (const name of TRIGGER_PATCHED_FUNCTIONS) {
      expect(patch).toContain(`create or replace function public.${name}(`);
      expect(normalise(functionText(patch, name)), `${name} matches schema.sql`).toBe(
        normalise(functionText(schema, name)),
      );
    }
    expect(patch).toContain("drop trigger if exists trip_members_check_avatar_path on public.trip_members;");
    expect(normalise(triggerText(patch, "trip_members_check_avatar_path"))).toBe(
      normalise(triggerText(schema, "trip_members_check_avatar_path")),
    );
    expect(patch).toContain("revoke execute on function public.grant_trip_member_by_email(text, text, text) from public, anonymous;");
    expect(patch).toContain("grant execute on function public.grant_trip_member_by_email(text, text, text) to authenticated;");
    // No data changes: outside function bodies there are no DML statements.
    const outsideBodies = patch.replace(/\$\$[\s\S]*?\$\$/g, "");
    expect(outsideBodies).not.toMatch(/^\s*(update|delete|insert)\b/im);
  });
});
