# schemas/

Reference JSON Schema documents for `docs/product/generated/`'s key JSON outputs, validated by `../lib/schemaValidator.js` — a small, dependency-free subset validator (`type`, `required`, `properties`, `items`, `enum`) rather than a full JSON Schema implementation. Adding `ajv` (or an equivalent) was considered and rejected per the Part 4 brief's "do not add runtime dependencies without approval" rule; this subset is sufficient to catch the failure mode that matters here (a generator change silently dropping or renaming a top-level field), not to validate arbitrary third-party JSON.

**Limitation**: no `$ref`, `oneOf`/`anyOf`/`allOf`, `pattern`, `format`, or numeric range keywords. If a future schema genuinely needs one of those, either extend `schemaValidator.js`'s subset deliberately (and document the addition here) or reconsider whether a real JSON Schema library has become worth the dependency.

| File | Validates |
|---|---|
| `feature-index.schema.json` | `docs/product/generated/feature-index.json` |
| `authority-index.schema.json` | `docs/product/generated/authority-index.json` |
| `subsystem-locator.schema.json` | `docs/product/generated/subsystem-locator.json` |
| `dependency-graph.schema.json` | `docs/product/generated/dependency-graph.json` |
| `roadmap-dashboard.schema.json` | `docs/product/generated/roadmap-dashboard.json` |
| `documentation-health.schema.json` | `docs/product/generated/documentation-health.json` |
| `change-report.schema.json` | `docs/product/generated/change-reports/*.json` |
| `manifest.schema.json` | `docs/product/generated/manifest.json` |
| `ownership-manifest.schema.json` | `docs/product/generated/ownership-manifest.json` |
| `engineering-conversation-packet.schema.json` | Part 8 import input — `.autoingest-docs/conversations/{inbox,imported}/*.json` (an ECP packet, never `docs/product/generated/` output; validated by `automation/conversation/ecp.js`, not `checkGeneratedSchemas`) |

Run `node scripts/product-docs/cli.js validate` to validate the current generated output against all of these.
