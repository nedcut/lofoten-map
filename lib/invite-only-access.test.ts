import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("invite-only contribution contract", () => {
  it("does not auto-enroll signed-in visitors from the data-loading client", () => {
    const source = read("lib/hooks/useTripData.ts");
    expect(source).not.toContain('rpc("ensure_trip_membership"');
  });

  it("removes the legacy self-enrollment RPC from fresh and upgraded databases", () => {
    const schema = read("supabase/schema.sql");
    const migration = read("supabase/migrations/20260711120000_invite_only_contributions.sql");

    expect(schema).toContain("drop function if exists public.ensure_trip_membership(text)");
    expect(schema).not.toContain("create or replace function public.ensure_trip_membership");
    expect(schema).not.toContain("grant execute on function public.ensure_trip_membership");
    expect(migration).toContain("drop function if exists public.ensure_trip_membership(text)");
  });

  it("retains public reads and the admin invitation RPC", () => {
    const schema = read("supabase/schema.sql");
    expect(schema).toContain('create policy "public read trips" on trips for select to anon, authenticated using (true)');
    expect(schema).toContain("create or replace function public.grant_trip_member_by_email");
    expect(schema).toContain("grant execute on function public.grant_trip_member_by_email(text, text, text) to authenticated");
  });
});
