"""Exact independent native proof of the seven offline projected teacher labels.
This is teacher collection replay, NOT runtime policy logic or new selection.
"""
import os
from pathlib import Path
import json,torch,hashlib,numpy as np
from lab.marl.pf_ch_episode import load_cases
from lab.marl.collect_pp_demonstrations import create_teacher
import lab.marl.evaluate_uc2_roam_runtime as runtime
from app.policies.learned.uc2_roam_policy import UC2RoamPolicy
P=Path(os.environ['UC2_TRAINING_RUN_DIR']);B=Path.cwd();BASE=B/'app/policies/learned/checkpoints/uc2_demo_ppo.pt';CP=P/'uc23_projected_prior.pt';sha=lambda q:hashlib.sha256(Path(q).read_bytes()).hexdigest();frozen=sha(CP);torch.set_num_threads(1);state={};labels=[];tracedir=P/'projected7-teacher-reference-traces'
def factory(name,env):
 p=UC2RoamPolicy(env,checkpoint=BASE,specialists=False);used=False
 def act_many(handles,observations=None,**kwargs):
  nonlocal used
  prep=p.prepare_inference(handles);hs,ob,w=prep;prop=p.infer_prepared(prep)
  if not used and env.agents[1].current_configuration==((3,66),1) and prop[1]==3 and ob[hs.index(1),w+4]>=.5:
   teacher=create_teacher(env,preset='uc2-3',max_orders=4,replan_on_incidents=True,max_replans=8,executor='trainruns');raw=teacher[0].act_many(hs)[1]
   assert raw==2 and ob[hs.index(1),w+2]==0
   labels.append(dict(case_id=state['case'].case_id,step_before=int(env._elapsed_steps),step_after=int(env._elapsed_steps)+1,handle=1,before_configuration=env.agents[1].current_configuration,obs=ob[hs.index(1),:w].tolist(),mask=ob[hs.index(1),w:].tolist(),raw_current_state_pp_action=raw,frozen_neural_action_before_projection=prop[1],projected_teacher_action=4,current_state_pp_proof=teacher[1]));prop[1]=4;used=True
  return p.finalize_actions(prop)
 p.act_many=act_many;return p
runtime.create_runtime_policy=factory
cases=[c for c in load_cases(B.parent/'docs/examples/uc2-roam-performance/inputs/uc23-systematic343-v3-cases.json') if c.departure_offsets[0]==0 and c.departure_offsets[2]==6];rows=[]
for c in cases:
 state['case']=c;rows.append(runtime.run_case(c,reference_audit=True,trace_dir=tracedir))
original=[json.loads(l) for l in (P/'pp-roam-projected7.jsonl').read_text().splitlines()]
assert len(labels)==len(original)==7
for label in labels:
 ref=next(x for x in original if x['case_id']==label['case_id']);assert ref['step']==label['step_before'];assert np.array_equal(np.array(ref['obs']),np.array(label['obs']));assert np.array_equal(np.array(ref['mask']),np.array(label['mask']))
 trace=[json.loads(l) for l in (tracedir/f"{label['case_id']}.jsonl").read_text().splitlines()];label['after_native_frame']=next(x for x in trace if x['step']==label['step_after']);assert label['after_native_frame']['actions']['1']==4
safety={k:sum(r.get(k,0) for r in rows) for k in ['resource_conflicts','new_stuck_steps','uncertified_steps','prediction_mismatches','prediction_mismatches_with_new_fault','withdrawals','reference_disagreements']};assert all(r['complete_mission'] for r in rows);assert all(safety[k]==0 for k in ['resource_conflicts','new_stuck_steps','uncertified_steps','prediction_mismatches','reference_disagreements']);assert sha(CP)==frozen
report=dict(schema='uc23-projected-teacher-exact7-native-reference-v1',scope='Independent native replay of exact seven offline projected STOP labels. Base frozen01b+one projected teacher STOP, then frozen base resumed. This private offline teacher wrapper is not deployed runtime logic. No new model choice/training.',selected_checkpoint_unchanged_sha256=frozen,base_sha256=sha(BASE),projected_dataset_sha256=sha(P/'pp-roam-projected7.jsonl'),source_sha256={Path(__file__).name:sha(__file__),**{Path(k).name:v for k,v in runtime.source_hashes().items()}},actual_post_step_uncached_reference_audit=True,exact_projected_observation_and_mask_equality_asserted=True,summary=dict(cases=7,complete_missions=sum(r['complete_mission'] for r in rows),arrived=sum(r['arrived'] for r in rows),lateness=sum(r['lateness'] for r in rows),safety=safety),labels_before_and_native_after=labels,results=rows)
(P/'pp-roam-projected7.teacher-independent-native-audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report['summary']));print('SHA256',sha(P/'pp-roam-projected7.teacher-independent-native-audit.json'))
