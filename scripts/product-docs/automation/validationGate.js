'use strict';

// The single place that decides whether a finalize is allowed to complete,
// as a function of automation mode:
//   STRICT   — blocks on any Part 4 validate error, any packet schema
//              error, or any unjustified-but-required record type.
//   STANDARD — blocks only on Part 4 validate errors and packet schema
//              errors; unjustified records are reported, not blocking.
//   OBSERVE  — never blocks; produces the same report for visibility only,
//              and canonicalUpdater is never invoked in this mode (see
//              orchestrator.js).

const { validatePacket } = require('./evidencePacket');
const { validateDocumentation } = require('./lifecycleUpdater');

function gate(packet, plan, mode) {
  const packetCheck = validatePacket(packet);
  const docValidation = validateDocumentation();
  const unjustified = [];
  for (const group of Object.values(plan)) {
    for (const item of group) {
      if (item.justified === false && item.type !== 'roadmap-transition-proposal') unjustified.push(item);
    }
  }

  const blockingErrors = [];
  if (!packetCheck.valid) blockingErrors.push(...packetCheck.errors.map((e) => `evidence-packet: ${e}`));
  if (!docValidation.ok) blockingErrors.push('docs/product/ validate reported an error-level finding — see documentation-health.md');

  if (mode === 'strict' && unjustified.length > 0) {
    blockingErrors.push(...unjustified.map((u) => `unjustified ${u.type}: ${u.reason}`));
  }

  return {
    mode,
    ok: mode === 'observe' ? true : blockingErrors.length === 0,
    packet_valid: packetCheck.valid,
    packet_errors: packetCheck.errors,
    documentation_validate_ok: docValidation.ok,
    documentation_validate_output: docValidation.output,
    unjustified_actions: unjustified,
    blocking_errors: blockingErrors,
  };
}

module.exports = { gate };
