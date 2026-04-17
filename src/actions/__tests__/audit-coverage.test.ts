import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Audit-coverage guard.
 *
 * For every exported async function in src/actions/*.ts that performs a
 * mutating Supabase call (.insert / .update / .delete / .upsert / .rpc),
 * require a corresponding audit call (recordAuditLogEntry or logAuthEvent)
 * within the same function scope.
 *
 * Any exception must be added to AUDIT_COVERAGE_ALLOWLIST with a reason.
 * The allowlist must shrink, not grow.
 *
 * This catches the v1-spec regression where a new server action shipped
 * without audit and its audit writes failed silently at the CHECK level.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ACTIONS_DIR = join(__dirname, "..");

// Set of `<file>.ts:<functionName>` entries that are intentionally exempt.
// Add with a one-line reason; remove when the underlying gap is closed.
const AUDIT_COVERAGE_ALLOWLIST = new Set<string>([
  // Wave 3 — pre-event proposal + approval delegate all DB mutations to
  // SECURITY DEFINER RPCs that insert audit rows internally
  // (create_multi_venue_event_proposals, pre_approve_event_proposal).
  "pre-event.ts:proposeEventAction",
  "pre-event.ts:preApproveEventAction",
  // Wave 5 — upload request inserts the attachment row but the audit for
  // attachment.uploaded fires on confirmation (confirmAttachmentUploadAction)
  // once the object is actually in storage. Pending rows are not audited.
  "attachments.ts:requestAttachmentUploadAction"
]);

const MUTATION_PATTERN = /\.(insert|update|delete|upsert|rpc)\s*\(/;
const AUDIT_PATTERN = /(recordAuditLogEntry|logAuthEvent)\s*\(/;

type FunctionBlock = {
  name: string;
  body: string;
};

/**
 * Scans TypeScript source for exported async functions and returns each
 * function's body as a string. Uses brace-counting starting from the
 * signature's opening `{` so nested arrows/blocks don't break the slice.
 */
function extractExportedAsyncFunctions(source: string): FunctionBlock[] {
  const blocks: FunctionBlock[] = [];
  const declRegex = /export\s+async\s+function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = declRegex.exec(source)) !== null) {
    const name = match[1];
    // Find the opening brace of the function body after the parameter list.
    // Walk forward from match.index, counting parentheses to find the close
    // of the parameter list, then scan for the next `{`.
    let idx = match.index + match[0].length;
    let parenDepth = 1;
    while (idx < source.length && parenDepth > 0) {
      const ch = source[idx];
      if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth--;
      idx++;
    }
    // Skip return type annotation and whitespace to the body-opening brace.
    while (idx < source.length && source[idx] !== "{") idx++;
    if (source[idx] !== "{") continue;
    const bodyStart = idx;
    let braceDepth = 1;
    idx++;
    while (idx < source.length && braceDepth > 0) {
      const ch = source[idx];
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
      idx++;
    }
    const bodyEnd = idx;
    blocks.push({ name, body: source.slice(bodyStart, bodyEnd) });
  }

  return blocks;
}

describe("audit coverage guard (Wave 0.4)", () => {
  const files = readdirSync(ACTIONS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => {
      const full = join(ACTIONS_DIR, f);
      return statSync(full).isFile();
    });

  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    const path = join(ACTIONS_DIR, file);
    const source = readFileSync(path, "utf8");
    const blocks = extractExportedAsyncFunctions(source);

    for (const { name, body } of blocks) {
      it(`${file}:${name} — mutating actions audit`, () => {
        const key = `${file}:${name}`;
        const mutates = MUTATION_PATTERN.test(body);
        if (!mutates) return; // read-only or delegates entirely to helpers — nothing to check

        const audits = AUDIT_PATTERN.test(body);
        if (audits) return;

        if (AUDIT_COVERAGE_ALLOWLIST.has(key)) return;

        expect.fail(
          `${key} performs a mutation (.insert/.update/.delete/.upsert/.rpc) but does not call ` +
            `recordAuditLogEntry or logAuthEvent in the same function scope. ` +
            `Add an audit call, or add "${key}" to AUDIT_COVERAGE_ALLOWLIST with a reason.`
        );
      });
    }
  }
});
