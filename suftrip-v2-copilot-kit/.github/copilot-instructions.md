# Suftrip V2 Copilot Instructions

- Suftrip is logistics-first; food is an extensible vertical.
- Treat Chowdeck only as a public product/UX benchmark.
- Never invent private Suftrip architecture or code.
- The core reusable abstraction is DeliveryJob.
- Start as a modular monolith.
- Every feature requires tests.
- Important architecture changes require documentation and Mermaid diagrams.
- Use backend authorization, not only frontend checks.
- Use idempotency for critical commands.
- Hide external vendors behind adapters/interfaces.
- AI must never be required for transactional correctness.
- Inspect code before modifying it.
- Make small, safe changes.
- Never delete or weaken tests to make them pass.
- Keep the project runnable at every milestone.
- If uncertain, state the uncertainty instead of guessing.
