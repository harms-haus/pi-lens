/**
 * Shared runtime helpers for pi-lens
 */

/**
 * Type guard: checks if a value is a non-null object that is not an array.
 * Returns `true` for plain objects, class instances, etc.
 * Returns `false` for `null`, arrays, primitives, and functions.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Map a check status to a unicode icon.
 */
export function statusToIcon(status: string): string {
  switch (status) {
    case "clean":
      return "✅";
    case "issues":
      return "⚠";
    case "error":
      return "✗";
    case "skipped":
      return "⊘";
    case "running":
    case "pending":
      return "●";
    default:
      return "●";
  }
}
