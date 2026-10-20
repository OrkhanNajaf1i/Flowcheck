# packages/shared — contracts

Zod schemas, TS types, error codes and constants shared by web, server, runner and engine.
Spec: PROJECT_RULES §5, §6, §7, §11, §18.

## Rules
- Runtime dependency: **zod only**. No Node APIs, no Playwright, no Fastify, no DB. Must work in the browser (apps/web imports it).
- `api.ts` holds the hand-written REST contract. It is the only API contract — never derive it from Drizzle types.
- All object schemas are strict (`z.strictObject`): unknown keys are rejected so no code can be smuggled into a definition.
- `ERROR_CODES` in `errors.ts` is the single enum of error codes. Adding a code also means adding it to PROJECT_RULES §18.

## Test definition versioning (`definition.ts`)
- `schemaVersion` 1 is current. Each revision is validated with the schema of **its own** version via `parseDefinition`.
- Only step types the engine really executes are in the schema. A new step type or optional field is added to v1 only when the engine implements it (additive change, old revisions stay valid).
- A breaking change needs a new version and a new entry in `DEFINITION_SCHEMAS`. Old revisions are never migrated silently.
- Feature gates live in the schema: e.g. `{{outputs.*}}` and `{{secrets.*}}` are rejected until phase 3 implements them. Remove the gate in the same change that implements the feature.

## Templates (`templates.ts`)
- Grammar `{{namespace.name}}`; namespaces `inputs | run | outputs | secrets`; no expressions, no escape syntax.
- Names matching `__proto__`, `constructor`, `prototype` are invalid.
- Secrets are not allowed in URL/path/query/assertion fields (checked in `testDefinitionV1Schema`).

## Tests
`pnpm --filter @flowcheck/shared test` — definition validation, templates, error-code uniqueness.
