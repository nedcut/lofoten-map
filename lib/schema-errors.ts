export type SchemaError = { code?: string; message: string } | null | undefined;

/**
 * Detect a query failure caused by the deployed database schema lagging the
 * app: a table or column the code expects does not exist yet (or PostgREST's
 * schema cache has not picked it up). Callers use this to degrade gracefully —
 * hide the dependent UI and prompt for a migration push — instead of treating
 * a behind schema as a hard sync failure.
 *
 * Matches the three phrasings these failures arrive in:
 * - PostgREST missing table:  "Could not find the table 'public.admin_requests' in the schema cache"
 * - PostgREST missing column: "Could not find the 'avatar_path' column of 'trip_members' in the schema cache"
 * - Direct Postgres:          "column trip_members.avatar_path does not exist" / "relation ... does not exist"
 */
export function isMissingSchemaObjectError(error: SchemaError, objectName: string): boolean {
  if (!error) return false;
  const message = error.message.toLowerCase();
  if (!message.includes(objectName.toLowerCase())) return false;
  return message.includes("schema cache") || message.includes("could not find") || message.includes("does not exist");
}
