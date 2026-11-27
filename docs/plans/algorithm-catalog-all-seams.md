# Algorithm catalog — every seam, not only the policy registry

Status: plan and build, 2026-10-18.

## The problem

The Algorithm Gallery (`#/algorithms`, `features/algorithms-gallery`) reads
`GET /policies`, which serves `app/policies/registry.py`. That registry holds
the **policies** — what drives every train each step: DLA, Shortest Path,
Random, Forward Only, Do Nothing, Director Planner, Scripted Plan.

Since then, algorithms have arrived at two further seams that the gallery
does not know about:

| Seam | Registry | Built-in |
|---|---|---|
| Proposal agent — the "KI" column of Plan / KI / Mensch | `app/core/proposal_agents/registry.py` | `pp_replan`: Prioritized Planning (AI4REALNET `flatland-blackbox`, vendored in `app/planners/blackbox/`, MIT) |
| Intervention recommender — the tactical "who is affected, reroute or hold" | `app/core/recommenders/registry.py` | `proximity`: Phase-1 path/ETA intersection with the blocked cell |

PP is also what the contention strategies `pp` and `priority`
(`app/core/contention_strategies.py`) run, and what the Director's timed
reroute uses (`app/planners/replan.py`). So the one search-based algorithm
the playground actually runs is absent from its algorithm catalog, while the
gallery's own family text names "CBS, prioritised planning" as the example of
search-based.

Two smaller gaps in the policy registry itself: **Scripted Plan** has no
catalog metadata (no conflict behaviour, provenance or licence; its family is
"rule-based" only by default), and **CBS** appears only in comments — only PP
is vendored.

## Decisions

- **One catalog over three registries, still no second copy.** The catalog
  metadata stays next to the runtime code: `PolicySpec` already carries it;
  `ProposalAgent` and `InterventionRecommender` get the same fields as class
  attributes. A small collector (`app/core/algorithm_catalog.py`) reads all
  three registries; nothing is listed by hand.
- **A new endpoint, `GET /policies/catalog`.** `GET /policies` keeps serving
  only policies, because the policy picker and the session flow read it and
  must not offer a proposal agent as a policy. The catalog entries carry a
  `layer`: `policy` | `proposal-agent` | `recommender`.
- **Layer is a facet, family stays the grouping.** The gallery still groups by
  how an algorithm decides (rule-based / search-based / hybrid / learned);
  layer is a second facet and a pill on each row, because the same family
  appears at several seams.
- **`used_in` names the other places an algorithm runs** (e.g. PP in the
  contention strategies and the timed reroute), so a reader sees where a
  study condition would actually change behaviour.
- **CBS is not added.** It is not in the code; listing it would be a claim
  about what runs. The family text names PP and CBS as examples of the family,
  which stays true.
- Naming follows today's code (`/algorithms`, `AlgorithmsGallery`). Issue #63
  (PR #113) renames the gallery to the strategy catalog; this change touches
  the same files only lightly and moves with the rename.

## Work

1. Catalog fields (`family`, `deterministic`, `role`, `observation`,
   `at_conflict`, `provenance`, `licence`, `grounding`, `used_in`) on
   `ProposalAgent` and `InterventionRecommender`; filled for `pp_replan` and
   `proximity`.
2. Catalog metadata for Scripted Plan in `registry.py`.
3. `app/core/algorithm_catalog.py` and `GET /policies/catalog`, with a test
   that every registered policy, proposal agent and recommender appears
   exactly once with a valid family, role and layer.
4. Gallery reads the catalog endpoint; Layer facet, layer pill, `used_in` in
   the expanded row; the totals count all layers.

## Acceptance

- `#/algorithms` lists PP replan (search-based, proposal agent, MIT) and the
  proximity recommender beside the seven policies.
- Registering a new proposal agent or recommender makes it appear in the
  gallery with no frontend change.
- The policy picker still offers only policies.
- `pytest` green, including the new catalog test.

## Open questions

1. Should the contention strategies (`keep`, `policy:<id>`, `pp`, `priority`)
   become a registry of their own? Today they are a fixed set in one module;
   `used_in` covers them until a second engine appears there.
