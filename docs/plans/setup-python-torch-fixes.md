# Setup fixes: flatland-rl 4.2.6 leftovers, and torch on the wrong Python

Status: plan, 2026-10-28, reviewed (decisions below). Branch `fix/flatland-430-leftovers-torch`, cut from `origin/main` at
2f4dbcb. Nothing built yet.

## Problem

Two setup failures came up while running `./start-demo.sh` on a Mac (session of 2026-10-26/28):

1. **`torch==2.8.0` not found.**
   - With Homebrew Python 3.14, pip offered only torch 2.9.0+. torch 2.8.0 has no 3.14 wheels; the first torch with
     3.14 wheels is 2.9.0.
   - With an Anaconda Python 3.13, the interpreter was an **x86_64** build (`macosx-10.15-x86_64`) running under
     Rosetta on Apple Silicon. torch publishes no Intel macOS wheels after 2.2.2.
   - `start-demo.sh` gave no hint about either. It also keeps reusing an existing `backend/.venv-run`, whatever Python
     that venv was built with.
2. **flatland-rl 4.2.6 leftovers.** `backend/requirements.txt` pins `flatland-rl==4.3.0` since the 4.3 upgrade, but
   some places still say 4.2.6.
   - `start-demo.sh` installs `flatland-rl==4.2.6` as a fallback.
   - Code comments and two `SOURCE.md` files still name 4.2.6 (or 4.2.5) as the version in use.

## Constraints, measured on PyPI (2026-10-28)

| Package | Wheels | Consequence |
|---|---|---|
| `numpy` 1.26.4 (`requirements.txt`: `numpy>=1.26.0,<2.0.0`) | cp39 – **cp312** | On 3.13+, pip builds numpy 1.26 from source, which fails or needs a toolchain. **Supported Python: 3.10 – 3.12.** |
| `flatland-rl` 4.3.0 | **sdist only**, `requires_python >=3.10` | Needs a C compiler on every platform (`flatland-43-upgrade.md` §7). On macOS that means the Xcode Command Line Tools. |
| `torch` 2.8.0 | macOS: **arm64 only**, cp39 – cp313 | No wheel on Intel macOS, and none on 3.14. |
| `torch`, Intel macOS | last release 2.2.2 (cp38 – cp312) | Intel Macs (and x86_64 Pythons on Apple Silicon) get torch ≤ 2.2.2 at best. |

CI (`ci.yml`, `copilot-setup-steps.yml`) and both Dockerfiles already use **Python 3.12**. The local scripts are the
odd ones out. `scripts/setup-dev.sh` even says "Needs Python 3.12+", which is wrong for 3.13+.

## Plan

### 1. One Python range for local setup: 3.10 – 3.12, native architecture

`start-demo.sh` and `scripts/setup-dev.sh` choose the interpreter the same way:

1. Use `$PYTHON` if it is set. Otherwise take the first of `python3.12`, `python3.11`, `python3.10`, `python3` that
   passes the check below.
2. **Check:** the version is 3.10 – 3.12. On macOS, the interpreter's architecture must also match the hardware: on
   Apple Silicon (`sysctl -n hw.optional.arm64` = 1), `platform.machine()` must be `arm64`, not `x86_64`.
3. If nothing passes, stop with one message:
   - what was found (version and architecture);
   - why it's unsupported: numpy 1.26 wheels stop at 3.12, and torch has no Intel macOS wheels;
   - the fix, e.g. `brew install python@3.12` and then `PYTHON=/opt/homebrew/bin/python3.12 ./start-demo.sh`.

An **existing venv** (`backend/.venv-run`, `backend/.venv`) gets the same check. If it fails, the scripts stop and
print the `rm -rf` command. They do **not** delete the venv themselves, because the user may have installed things
into it (decision 1).

The check lives in one helper, `scripts/python-env.sh` (`pick_python`, `check_python`), which both scripts source.
Keeping it in one place stops the two scripts from drifting apart.

### 2. torch: no exact pin, and never fatal in `start-demo.sh`

- Replace `torch==2.8.0` with the same spec as `requirements-dev.txt`, `torch>=2.2.0`. pip then picks the newest torch
  that has a wheel for the interpreter:
  - 2.14 on Python 3.12 / arm64 or Linux;
  - 2.2.2 on Intel macOS, which still satisfies `models/goal_directed/SOURCE.md` ("loadable with … `torch>=2.2.0`").
  The scripts and CI then install the same torch range.
- The torch install in `start-demo.sh` stops being fatal under `set -e`. If it fails, the script prints the existing
  "Director runs model-free" message and goes on. That is already the documented behaviour when the checkpoints are
  missing.
- **Verify:** load both checkpoints (`goal_directed_policy._load_models()`) with the newest torch and with 2.2.2 on
  Python 3.12. If 2.2.2 can't load them, keep `>=2.2.0` only if the SOURCE.md claim can be corrected; otherwise raise
  the floor and document the version that was actually tested.

### 3. flatland-rl: one source of truth

- `start-demo.sh`: drop the separate `flatland-rl==4.2.6` step. `requirements.txt` already installs flatland-rl.
  - The step only ran when `import flatland` failed after the requirements install. In that case it silently
    installed the wrong version over a half-installed env.
  - Instead, check `import flatland` after the requirements step and stop with a clear message. The likely cause is
    the 4.3.0 sdist build, so the message points to the compiler or Xcode CLT.
- Check that `start-demo.sh`'s "fastapi already importable → skip requirements" shortcut can't leave an old 4.2.6
  venv in place. If the installed version is not the one `requirements.txt` asks for, reinstall the requirements.

### 4. Version references in code and data docs

Edit only text that **claims a current state**. Dated records stay as written.

| File | Change |
|---|---|
| `backend/app/core/conflict_detector.py` (module doc, `_malfunction_counter`) | "Flatland 4.2.6" → "flatland-rl ≥ 4.2.6 (checked on 4.3.0)", once the API names are confirmed on 4.3.0 |
| `backend/app/core/scenario_runner.py` | Same, for `RailEnvPersister.save/load_new` |
| `backend/app/policies/base.py`, `deadlock_avoidance_policy.py`, `examples/deadlock_avoidance_policy.py` | "adapted to Flatland 4.2.6" stays: it records where the port started. Add "runs on the pinned 4.3.0". |
| `backend/app/utils/shortest_distance_walker.py` | Check which `get_transitions` signature 4.3.0 actually has, then correct the "4.2.6 expects …" docstring and comment |
| `backend/tests/test_conflict_detector_e2e.py` | "Flatland 4.2.5 PolicyRunner" → version-neutral |
| `backend/app/fixtures/olten/SOURCE.md` | Keep the 2026-08-28 4.2.6 record. Add a dated line for 4.3.0 once a test loads Olten on 4.3.0. |
| `backend/models/goal_directed/SOURCE.md` | "loadable with the pinned `flatland-rl==4.2.6`" → the pinned 4.3.0 and the torch range from step 2, once verified |

**Not touched:**
- `docs/plans/*`, `docs/reading/*` and `docs/archive/*`. They are dated plans and research notes, and
  `flatland-43-upgrade.md` *is* the 4.2.6 → 4.3.0 record.
- Exception (decision 2): plans whose current-state statements name 4.2.6 as the version in use, e.g. "all in
  `flatland-rl==4.2.6` today" in `flatland-ecosystem-reuse-plan.md`, get a one-line status note under their title:
  "Superseded in part: the backend runs flatland-rl 4.3.0 since 2026-08-26, see `flatland-43-upgrade.md`." Their text
  stays as written.

### 5. Docs

- `README.md` (backend setup) and `CONTRIBUTING.md`: say "Python 3.10 – 3.12 (CI uses 3.12)", with a short
  troubleshooting entry for macOS:
  - check `python -c "import sysconfig; print(sysconfig.get_platform())"`;
  - an `x86_64` result on Apple Silicon (e.g. an Intel Anaconda) can't install torch;
  - the 4.3.0 sdist needs the Xcode Command Line Tools.
- `scripts/setup-dev.sh` header: "Needs Python 3.12+" → "Needs Python 3.10 – 3.12 (numpy < 2)".

## Commits

| # | Commit | Contents |
|---|---|---|
| 1 | `docs(plans): setup fixes for flatland-rl leftovers and torch` | This file |
| 2 | `fix(scripts): pick a supported, native Python for local setup` | `scripts/python-env.sh`; used by `start-demo.sh` and `setup-dev.sh`, including the existing-venv check |
| 3 | `fix(start-demo): install torch from the requirements range, non-fatal` | Step 2 |
| 4 | `fix(start-demo): install flatland-rl only from requirements.txt` | Step 3 |
| 5 | `docs(backend): flatland-rl version references match the 4.3.0 pin` | Step 4, each change checked against 4.3.0 |
| 5b | `docs(plans): note where plans predate the flatland-rl 4.3.0 upgrade` | One-line status notes (decision 2) |
| 6 | `docs: supported Python range and macOS troubleshooting` | Step 5 |

## Verification

- **CI:** backend tests and the frontend checks, unchanged. No backend code behaviour changes.
- **Script logic,** in a container and locally:
  - `start-demo.sh` with Python 3.12 → runs;
  - with 3.13 and 3.14 → stops with the message, or picks `python3.12` if it is installed;
  - with an existing 3.14 `.venv-run` → stops with the `rm -rf` hint.
- **On your Mac:**
  - the Intel Anaconda Python → rejected with the architecture message;
  - Homebrew `python3.12` → demo starts, torch installs, and the Director strategy tiles show numbers.
- **Checkpoints** load with torch 2.2.2 and with the newest torch (step 2).

## Decisions (review 2026-10-28)

| # | Question | Decision |
|---|---|---|
| 1 | A venv built with an unsupported Python | Keep it; the scripts stop and print the instructions (`rm -rf …` and the command to recreate it). No automatic deletion, not even of `.venv-run`. |
| 2 | Plans that still name 4.2.6 as current | Add a one-line status note under the title; leave the text as written. |
| 3 | `numpy<2` | Keep it, so Python stays 3.10 – 3.12. Lifting it is a separate change: numpy 2 support is already on flatland-rl `main`, to be released with 5.0.0. |
