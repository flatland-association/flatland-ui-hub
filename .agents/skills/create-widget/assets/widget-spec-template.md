# Widget spec — `<Widget name>`

> Copy to `docs/plans/widget-<id>-<slug>.md`. Fill **all eight** sections. The spec
> is the discourse — it forces the three axes (what function, how per mode, how it
> touches the system) and usually surfaces a backend gap before any code.
> Mirrors the template in `docs/reference/widget-authoring-process.md`.

## 1. Identity
- **Name:** …
- **`kind`:** event | context | prediction | decision-support | control | capitalization | trust
- **`granularity`:** overview | detail | overview-detail
- **Default zone:** left | center | right | bottom | floating
- **Panel `type`:** `<kebab-type>` (the `@switch` key / palette id)
- **Catalog id (if any):** A1 | B1 | … or new
- **Source(s):** [D3.1] | [D3.2] | [UIX] | [DB] | …
- **Grounding reference:** a consortium deliverable / paper / control-room practice
  (name it — no generic-dashboard widgets). If a consortium reference implementation
  exists (A3S, RL_agent_failure_forecast, Tokener, T2.3…), it is the reuse target.
- **Source origin:** where any reused *source code* comes from — e.g.
  `Source: AI4REALNET/InteractiveAI — frontend/src/components/organisms/Graph.vue`,
  or `Source: from-scratch, deliberately` when none. This is distinct from the
  grounding reference above (conceptual) and from `Source(s)` (deliverables): it
  names the upstream code path so the "reuse, don't reinvent" guardrail is auditable.

## 2. Promise
> One sentence: what the operator can now *do*.

## 3. Per-mode behaviour
State **availability and behaviour** for each mode. For Decision-Support widgets,
state the Assessment ↔ Recommendation ↔ suppressed framing explicitly.

- **Recommendation (WP 3.1):** …
- **Co-Learning (WP 3.3):** …
- **Director (WP 3.4):** …

(Use `null` / "not offered" where the widget does not appear in a mode — this maps
to `availableModes` in the registry.)

## 4. System interaction
- **Data in** — store signals / API endpoints consumed: …
- **Actions out** — store methods called: …
- **Backend table:**

| Field / capability | Available now | To build (flagged) |
|--------------------|:-------------:|:------------------:|
| … | ✓ | |
| … | | ✓ (flagged extension — do not fake) |

## 5. Allocation & accountability touchpoints
- **Loop stage:** context | notification | decision | capitalization
- **Owner per mode (`allocation`):** human | ai | shared, per mode
- **Decision events emitted:** which events feed the accountability seam /
  interaction log (`accountableOwner`, lifecycle)?

## 6. Acceptance scenario
> One concrete walkthrough + a **measurable** success criterion tied to a core
> question (Q1 distinct modes · Q2 calibrated trust · Q3 accountability · Q4
> allocation · Q5 study value).

## 7. Effort & changes
- **Effort:** S (≤150k tok / ≤1d) | M (150–400k / 1–3d) | L (>400k / 3–5+d)
- **Files / seams to touch:** (see registration-checklist.md)

## 8. Open questions / risks
> Especially study-relevant unknowns. **If you are building an algorithm from
> scratch instead of reusing an AI4REALNET implementation, say so here explicitly**
> — that is an allowed but deliberate decision, never a silent divergence.
