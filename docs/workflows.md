# Workflows — Standard Commands

These define how Claude should behave for common tasks.

---

## /implement

Used when building a new feature.

Steps:
1. Load relevant docs
2. Follow development-protocol.md
3. Use decision-matrix.md for approach
4. Implement in small steps
5. Stop after each step

---

## /debug

Used for bug fixing.

Steps:
1. Follow debug-playbook.md
2. Start from event.json
3. Trace full pipeline
4. Identify root cause
5. Fix minimal layer only

---

## /review

Used for reviewing code or design.

Steps:
1. Check against:
   - architecture.md
   - data-model.md
   - performance.md
2. Identify:
   - violations
   - risks
   - inefficiencies
3. Suggest improvements (no code first)

---

## /refactor

Used for improving code without changing behavior.

Steps:
1. Confirm no behavior change
2. Identify duplication or complexity
3. Simplify structure
4. Maintain system rules

---

## /analyze

Used for deep system understanding.

Steps:
1. Break down system flow
2. Identify dependencies
3. Highlight risks and bottlenecks