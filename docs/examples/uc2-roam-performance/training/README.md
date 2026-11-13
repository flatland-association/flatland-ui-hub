# Offline fit source archive

These are the executed offline scripts behind the UC2-3 projected-prior fit
and Tutorial C4 correction. They were previously private files; checkpoint
metadata alone contained hashes, not executable training code. The copies
here replace private directory literals with environment inputs, add the
required `os` imports, and let Tutorial's input identity check accept the
tensor-identical shipped C3 checkpoint. Training, collection, stopping rules
and audits are otherwise unchanged. [provenance.json](provenance.json)
records original and archived source hashes; reversing those substitutions reproduced every
original source byte during archiving.

All UC2-3 offset triples 0..6 and Tutorial offset pairs 0..9 are known
development/regression cases. The earlier C3 fresh40 Tutorial failure remains
a failure. These fits supply no new untouched confirmation.

| Fit | Inputs and supervision | Selected computation | Native result |
|---|---|---|---|
| UC2-3 | 91,633 frozen-neural-prior rows from 336 complete guarded episodes; 2,058 strict PP rows; seven separately identified safe STOP projections | Original `uc2_demo_ppo.pt`; seed17; Adam `1e-4`; prior KL10; correction CE1; PP CE0.02; 200 updates | 343/343 complete; lateness7922 vs PP17150; zero casewise PP lateness regressions |
| Tutorial C4 | 4,268 C3 frozen-neural-prior rows from 99 complete guarded episodes; 44 strict PP rows for `[0,8]`, emphasizing its single allowed LEFT1 disagreement | Exact C3 source checkpoint listed below; seed17; Adam `1e-4`; prior KL10; disagreement CE1; case PP CE0.02; 50 updates | 100/100 complete; lateness823 vs PP826; makespan sum2873 vs2881; zero casewise regressions in either metric |

The neural-prior rows are not PP/DLA demonstrations. UC2-3's projected labels
are also distinct from raw PP labels: when ROAM excludes PP straight2 and the
base actor proposes detour3, one certified STOP4 permits straight motion on
the following step. Its exact seven input observations/masks and complete
native missions were independently replayed. Tutorial needs no projection:
native and ROAM masks both allow the teacher's LEFT1 at step13. The archived
audits call the actual `UC2RoamPolicy` and compare every physical frame with
the independent uncached native reference. Offline case selection and teacher
interventions are not deployed policy rules.

## Dependencies and replay

Run from `backend/` in an environment matching the recorded execution:
Python3.12.13, Torch2.14.0, NumPy1.26.4, Flatland4.3.0, CPU with one Torch
thread. Original runs used macOS. The scripts reuse repository collectors,
the existing MLP and native ROAM implementation; they install nothing.

The large corpora are not vendored. Preparation scripts regenerate the
ordered inputs from the committed case manifests and the exact base model.
Dataset names, original hashes, sample counts, checkpoint dependencies and
published tensor hashes are in [provenance.json](provenance.json). UC2-3's
base is the unchanged repository `uc2_demo_ppo.pt`. Tutorial originally used
the earlier C3 source checkpoint
`tutorial-nativefix-disagreement64-focal1-s3-epoch-03000.pt`, SHA256
`46237ea9bdff9f4980d0fe26199080c3c51aefa7ead2d8ec266ef85e92fba600`.
Replay can recover the shipped C3 export directly from Git as shown below.
Its container SHA256 is
`25805b3ff1b7f78c8a3271ec1aa9e9cd88dd37a924930e2637b396aa1f9083c3`;
all16 model tensors were checked with `torch.equal` against the raw source.
The archived preparation assertion accepts exactly these two identities.
Neither is the current C4 Tutorial asset; no extra checkpoint is vendored.

For UC2-3:

```bash
export UC2_TRAINING_RUN_DIR="$(mktemp -d)"
export PYTHONPATH="$PWD"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
export ONLINE_LEARNING_AUTOSTART=0 STUDY_TRAJECTORIES_ENABLED=0
export MPLCONFIGDIR="$UC2_TRAINING_RUN_DIR/mpl"
cp ../docs/examples/uc2-roam-performance/training/uc23/*.py "$UC2_TRAINING_RUN_DIR/"
python "$UC2_TRAINING_RUN_DIR/prepare_data.py"
python "$UC2_TRAINING_RUN_DIR/counterfactual.py"
python "$UC2_TRAINING_RUN_DIR/train_projection.py" --kl 10 --steps 1000 --seed 17
python "$UC2_TRAINING_RUN_DIR/export_candidate.py"
python "$UC2_TRAINING_RUN_DIR/audit_frozen343.py"
python "$UC2_TRAINING_RUN_DIR/audit_projection_teacher7.py"
```

The original search evaluated updates100 and200; update200 was the first
all343 result without PP lateness regressions. The metadata-only export
helper therefore expects `projected-kl10-s17-step200.pt`. It corrects the
original script's epoch counter to four completed prior-sample-equivalent
epochs while retaining the exact200 updates. The exported tensor values
are unchanged.

For Tutorial, recover the tensor-identical C3 dependency into a fresh run
directory:

```bash
export UC2_TRAINING_RUN_DIR="$(mktemp -d)"
git show 23b68a94:backend/app/policies/learned/checkpoints/uc2_roam_tutorial.pt \
  > "$UC2_TRAINING_RUN_DIR/tutorial-c3-base.pt"
export UC2_TRAINING_BASE_CHECKPOINT="$UC2_TRAINING_RUN_DIR/tutorial-c3-base.pt"
export PYTHONPATH="$PWD"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
export ONLINE_LEARNING_AUTOSTART=0 STUDY_TRAJECTORIES_ENABLED=0
export MPLCONFIGDIR="$UC2_TRAINING_RUN_DIR/mpl"
cp ../docs/examples/uc2-roam-performance/training/tutorial/*.py "$UC2_TRAINING_RUN_DIR/"
python "$UC2_TRAINING_RUN_DIR/prepare_data.py"
python "$UC2_TRAINING_RUN_DIR/train_known100.py" --kl 10 --steps 800 --seed 17 --margin 0
python "$UC2_TRAINING_RUN_DIR/audit_frozen100.py"
```

The first evaluated Tutorial checkpoint, update50, already passed all100;
training and model choice stopped before its independent audit. It records
11 completed prior-sample-equivalent epochs and exact50 gradient updates.
The optional margin term in the existing script was zero in this fit.

Numeric/tensor reproducibility requires the same initial tensors, ordered
input arrays, software, CPU/platform behavior, seeds and thread settings.
Cross-platform bitwise replay is not asserted. Source hashes change because
of the declared portable I/O substitutions; regenerated ZIP/NPZ archives and
Torch containers may also differ through serialization and metadata. Do not
use checkpoint container SHA equality as a substitute for checking tensor
identity and native casewise results. The
[published export audit](../expert-export-roundtrip-candidate4.json) records
the original source-to-runtime tensor equality. Archiving performed syntax
and portability checks only; it did not rerun training or evaluation.
