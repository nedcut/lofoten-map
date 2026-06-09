import { describe, expect, it } from "vitest";
import { isMissingSchemaObjectError } from "./schema-errors";

describe("isMissingSchemaObjectError", () => {
  it("returns false for no error", () => {
    expect(isMissingSchemaObjectError(null, "admin_requests")).toBe(false);
    expect(isMissingSchemaObjectError(undefined, "admin_requests")).toBe(false);
  });

  it("returns false for unrelated errors", () => {
    expect(isMissingSchemaObjectError({ message: "permission denied for table admin_requests" }, "admin_requests")).toBe(false);
    expect(isMissingSchemaObjectError({ message: "Could not find the table 'public.admin_requests' in the schema cache" }, "avatar_path")).toBe(false);
  });

  it("detects a PostgREST missing table", () => {
    expect(isMissingSchemaObjectError(
      { code: "PGRST205", message: "Could not find the table 'public.admin_requests' in the schema cache" },
      "admin_requests",
    )).toBe(true);
  });

  it("detects a PostgREST missing column", () => {
    expect(isMissingSchemaObjectError(
      { code: "PGRST204", message: "Could not find the 'avatar_path' column of 'trip_members' in the schema cache" },
      "avatar_path",
    )).toBe(true);
  });

  it("detects direct Postgres missing column and relation errors", () => {
    expect(isMissingSchemaObjectError(
      { code: "42703", message: "column trip_members.avatar_path does not exist" },
      "avatar_path",
    )).toBe(true);
    expect(isMissingSchemaObjectError(
      { code: "42P01", message: 'relation "public.admin_requests" does not exist' },
      "admin_requests",
    )).toBe(true);
  });
});
