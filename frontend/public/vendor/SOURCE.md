# flatland-drawing-tool.html — source and licence

Vendored verbatim from
[`flatland-association/flatland-scenarios`](https://github.com/flatland-association/flatland-scenarios),
**MIT licensed**, commit `88c5c3cbfa78a820c791f3186d1e60428f8651e1` (2026-07-20),
path
[`scenario_generator/flatland_environment_drawing_tool.html`](https://github.com/flatland-association/flatland-scenarios/blob/main/scenario_generator/flatland_environment_drawing_tool.html).

Copied 2026-09-23. Same pinned commit as
`backend/app/core/vendor/scenario_generator/SOURCE.md`, which vendors the
Python-side counterpart (`model/scenario.py`) that reads this tool's JSON
export.

Self-contained: ~3,500 lines of vanilla JS/CSS, no external scripts/CDNs, no
build step — served as-is as a static asset and embedded in an iframe by
`frontend/src/app/features/scenario-drawing-tool/`.

Kept unmodified so future re-vendoring is a plain file diff against upstream.
