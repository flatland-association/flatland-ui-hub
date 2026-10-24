# The playground Space, and updating it from a browser

`explore_db` is mirrored to a Hugging Face **Docker Space**.
`.github/workflows/deploy-hf-space.yml` pushes it there on every push to
`explore_db`, so the playground can be refreshed without a terminal — from
Claude Code on the web, the GitHub web editor, or a phone on a train.

`main` has no such workflow; if a stable demo Space is wanted alongside this
one, the same three files work unchanged apart from the branch name and the
target Space (see branch `hf-space-mirror`).

## Previews from forks

The same workflow deploys **any branch of a fork** to the fork owner's own
Space, once the fork sets the `HF_SPACE` variable and the `HF_TOKEN` secret and
enables Actions. Contributors get a live preview without a local install.
Upstream keeps its behaviour: only `explore_db`, and only the owner's pushes
or a manual run. A fork never falls back to the team's Space: without
`HF_SPACE` the job is skipped, and a manual run fails with a readable error.
The Space header and the commit name the branch. The step-by-step for
contributors is in [`start-contributing.md`](start-contributing.md#without-a-local-install).

Creating a Docker Space needs a paid HF plan (see below), so this route suits
contributors who have one. Everyone else can use a Codespace and link
screenshots instead.

## How the mirror works

The Space needs two things this repo does not carry at its root: YAML front
matter at the top of `README.md` (GitHub renders that block badly, so it stays
out of the branch) and a `Dockerfile` whose runtime user is UID 1000, because that
is what Spaces runs the container as. Both live in `deploy/hf/`, and the
workflow assembles them into a **single flattened commit**:

- `deploy/hf/README-header.md` is prepended to the repo README
- `deploy/hf/Dockerfile` replaces the root one
- `docs/media` and `.github` are dropped. The image copies `backend/app`,
  `backend/models` and the Angular build, so neither ever reaches the
  container; they would only bloat the Space repo
- the image installs **torch (CPU wheels)**, so the Director planner runs with
  its trained models (`backend/models`) and the learned PPO policy is offered
  (since 2026-10-19; before that the Space ran without torch, and both fell
  back or were hidden)
- the tree is **uploaded with `huggingface_hub.upload_folder`**, not pushed
  with git. The checkpoints are binary files, which the Space only accepts
  through its Xet storage, and a plain `git push` is rejected.
  `delete_patterns="*"` makes the Space an exact copy of the tree, as the
  force-push did
- history is discarded (Spaces do not need it)

Everything else already worked: `backend/app/main.py` serves the built SPA
same-origin with a fallback route, and the `CMD` honours `${PORT:-8000}`, which
`app_port: 8000` in the front matter points the proxy at.

## One-time setup

1. Create the Space on huggingface.co — SDK **Docker**, template **Blank**,
   hardware **CPU basic** (free).
2. In the GitHub repo → *Settings → Secrets and variables → Actions*:
   - secret `HF_TOKEN` — a Hugging Face **write** token
   - variable `HF_SPACE` — `<user>/<space-name>`, if it differs from the
     default in the workflow

Then every push to `explore_db` redeploys. `workflow_dispatch` re-runs it by hand.

### Re-running it by hand

`workflow_dispatch` is the manual route that needs no local token and does the
same assembly:

```bash
gh workflow run deploy-hf-space.yml --ref explore_db
```

Or on github.com: *Actions → Deploy to Hugging Face Space → Run
workflow* — which also works from a phone.

Note the workflow only fires on a push when `.github/workflows/` exists **in the
pushed commit**. Adding the workflow and pushing older commits on top of it in
one go therefore deploys nothing; the run appears from the next push onward.

### Deploying without GitHub Actions

Only needed when Actions is unavailable. **Do not just push the branch** —

```bash
# WRONG: produces a Space that does not start
git push --force space explore_db:main
```

— because the branch deliberately does not carry the two things the Space needs
(see *How the mirror works* above): the YAML front matter, without which the HF
proxy looks for the app on port 7860 while it listens on 8000, and the UID-1000
`Dockerfile`. Replicate the assembly instead:

```bash
# 1. export the branch to a scratch dir
rm -rf /tmp/hf-space && mkdir -p /tmp/hf-space
git archive explore_db | tar -x -C /tmp/hf-space

# 2. assemble the Space tree (same steps as the workflow)
cd /tmp/hf-space
rm -rf docs/media .pytest_cache.zip .github
cp deploy/hf/Dockerfile Dockerfile
cat deploy/hf/README-header.md README.md > README.hf
grep -v 'docs/media/' README.hf > README.md && rm README.hf
rm -rf deploy

# 3. upload the tree (binary checkpoints need the Xet upload, not git push)
pip install huggingface_hub
python -c "from huggingface_hub import HfApi; HfApi().upload_folder(folder_path='.', repo_id='<hf-user>/<space-name>', repo_type='space', commit_message='Flatland Dispatcher — explore_db manual', delete_patterns='*')"
```

`HF_TOKEN` must be a **write** token, exported in the shell, or log in once with
`hf auth login`. `delete_patterns='*'` removes what the Space still has from an
older tree, so it ends up as an exact copy of this one.

## Why the free hardware is enough

| | Render Free | HF CPU Basic | HF CPU Upgrade |
|---|---|---|---|
| CPU | 0.1 vCPU | 2 vCPU | 8 vCPU |
| RAM | 512 MB | 16 GB | 32 GB |
| Price | free, 750 h/mo | free hardware¹ | $0.03/h |
| Idle | spin-down after 15 min | sleeps after ~48 h | never |

¹ CPU Basic has no hourly cost, but creating a Space that runs *compute*
(Docker or Gradio) requires a paid account plan.

Measured on one core (2026-08-23, dev MacBook, `OMP_NUM_THREADS=1`). The play
loop in `backend/app/api/websockets.py` runs `act_many` → `env.step` →
`serialize_env` → broadcast synchronously on the event loop, so a step costs
the sum:

| scenario | act_many | env.step | serialize | per step | ceiling |
|---|---|---|---|---|---|
| 3 agents, 50×20 (UI default) | 0.4 ms | 0.2 ms | 2.9 ms | 3.5 ms | ~287 steps/s |
| 15 agents, 80×40 (study size) | 9.4 ms | 1.2 ms | 9.2 ms | 19.9 ms | ~50 steps/s |
| ECML 2026 scene 1, 150×120 | 4.8 ms | 0.2 ms | 57.8 ms | 63.3 ms | ~16 steps/s |

Serialization, not the simulation, dominates on large grids. The what-if
endpoints are the other hot spot: `GET /hmi/scenarios` costs 1254 ms cold and
returns 9.1 MB at study size (40 ms warm, via the hash cache in `hmi.py`);
`GET /hmi/recommendations` 1450 ms cold. Peak RSS in the same run: 111 MB after
import, ~31 MB per stepped session, 662 MB with four study-size sessions after
their rollouts — which is why Render's free 512 MB is an OOM rather than a slow
request, and why 0.1 vCPU (a tenth of the numbers above) stalls the play loop
whenever a rollout runs on the same thread.

## Constraints to keep in mind

- **One uvicorn worker, always.** Sessions live in `SessionManager._sessions`
  in-process; a second worker would answer requests for sessions it does not
  hold. The 2 vCPU therefore buy headroom for one session plus its rollouts,
  not for parallel participants. For a study with concurrent participants, give
  each their own Space.
- **Disk is wiped on restart.** HF's old persistent storage is gone; the
  replacement is an attached Storage Bucket (paid, mounted at `/data` at
  runtime). The Dockerfile makes `/app/data` writable so the carried-over
  operator profiles in `operator_model.py` work within a container's lifetime,
  but they do not survive a rebuild. For study data that must outlive the
  container, write into a Dataset repo with `huggingface_hub` — that also fits
  D3.1's "structured, traceable decision record" better than a JSON file in a
  container.
- **No authentication.** A public Space means anyone can create sessions and
  run rollouts on that single worker. Keep it private while it is only for
  showing to people you can add, or accept the shared CPU.
