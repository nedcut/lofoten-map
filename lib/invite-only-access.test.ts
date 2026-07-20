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

  it("does not expose the legacy self-enrollment RPC in Neon", () => {
    const schema = read("neon/schema.sql");
    expect(schema).not.toContain("ensure_trip_membership");
  });

  it("retains public reads and the admin invitation RPC", () => {
    const schema = read("neon/schema.sql");
    expect(schema).toMatch(/create policy "public read trips"\s+on public\.trips for select to anonymous, authenticated using \(true\)/);
    expect(schema).toContain("create function public.grant_trip_member_by_email");
    expect(schema).toContain("grant execute on function public.grant_trip_member_by_email(text, text, text) to authenticated");
  });
});
