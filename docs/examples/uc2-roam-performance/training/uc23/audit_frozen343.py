"""Frozen selected NN with unchanged actual UC2RoamPolicy, uncached native reference.
Runtime factory is replaced only to supply the private immutable checkpoint;
act_many itself executes the actual deployed class. Junction logging reads
current state and separately validated current-state PP labels, without control.
"""
import os
from pathlib import Path
import json,hashlib,time,importlib.metadata,torch,numpy as np
from lab.marl.pf_ch_episode import load_cases
import lab.marl.evaluate_uc2_roam_runtime as runtime
from app.policies.learned.uc2_roam_policy import UC2RoamPolicy
from app.policies.learned.roam_check import open_waypoint_groups
from lab.marl.collect_pp_demonstrations import create_teacher
from lab.marl.common import load_model,masked_logits
P=Path(os.environ['UC2_TRAINING_RUN_DIR']);B=Path.cwd();CP=P/'uc23_projected_prior.pt';BASE=B/'app/policies/learned/checkpoints/uc2_demo_ppo.pt';torch.set_num_threads(1)
sha=lambda q:hashlib.sha256(Path(q).read_bytes()).hexdigest();frozen=sha(CP);old=load_model(BASE).eval();sources=runtime.source_hashes();sources[Path(__file__).name]=sha(__file__);jointlog=[];trace=P/'projected7-native-audit-traces';state={'case':None}
def factory(name,env):
 p=UC2RoamPolicy(env,checkpoint=CP,specialists=False)
 if state['case'].departure_offsets[0]==0 and state['case'].departure_offsets[2]==6:
  actual_act_many=p.act_many
  def logged_act_many(handles,observations=None,**kwargs):
   h1=env.agents[1];atjunction=h1.current_configuration==((3,66),1)
   captured=p.obs_builder.get_many(handles) if atjunction else None
   now=int(env._elapsed_steps);actions=actual_act_many(handles,observations,**kwargs)
   if atjunction:
    groups=open_waypoint_groups(p.obs_builder.base);safety=p.roam_check.action_mask(groups);ob=np.asarray(captured[1],dtype=np.float32);mask=np.minimum(ob[313:],safety[1]);obs=ob[:313]
    with torch.no_grad(): scores,_=old(torch.from_numpy(obs[None]));oa=int(masked_logits(scores,torch.from_numpy(mask[None])).argmax(-1)[0])
    teacher=create_teacher(env,preset='uc2-3',max_orders=4,replan_on_incidents=True,max_replans=8,executor='trainruns');ta=teacher[0].act_many(handles)[1] if teacher else None
    jointlog.append(dict(case_id=state['case'].case_id,step_before=now,step_after=now+1,handle=1,before_configuration=h1.current_configuration,mask=mask.tolist(),obs=obs.tolist(),frozen_base_masked_action=oa,selected_checkpoint_executed_action=actions[1],raw_current_state_pp_action=ta,current_state_pp_proof=teacher[1] if teacher else None))
   return actions
  p.act_many=logged_act_many
 return p
runtime.create_runtime_policy=factory
cases=load_cases(B.parent/'docs/examples/uc2-roam-performance/inputs/uc23-systematic343-v3-cases.json');pp={r['case_id']:r['lateness'] for r in json.loads((B.parent/'docs/examples/uc2-roam-performance/uc23-systematic343-pp.json').read_text())['results']};rows=[];started=time.perf_counter()
for j,c in enumerate(cases):
 state['case']=c;bad=c.departure_offsets[0]==0 and c.departure_offsets[2]==6
 row=runtime.run_case(c,reference_audit=True,trace_dir=trace if bad else None);rows.append(row)
 if (j+1)%35==0:print('AUDIT',j+1,'lateness',sum(r['lateness'] for r in rows),flush=True)
assert sha(CP)==frozen
safety={k:sum(r.get(k,0) for r in rows) for k in ['resource_conflicts','new_stuck_steps','uncertified_steps','prediction_mismatches','prediction_mismatches_with_new_fault','withdrawals','reference_disagreements']};regs=[r['lateness']-pp[r['case_id']] for r in rows]
report=dict(schema='uc23-projected-prior-frozen-native-reference343-v1',scope='All343 known native UC2-3 development/selection cases. Frozen checkpoint fixed before this run. No future40 access.',checkpoint=CP.name,checkpoint_sha256=frozen,actual_policy_class='UC2RoamPolicy',specialists=False,actual_post_step_reference_audit=True,reference_scope='Every executed physical frame: independent native stuck_trains(...partial_moves=True,max_candidates=60), not cached checker answer.',source_sha256=sources,software={n:importlib.metadata.version(n) for n in ['torch','numpy','flatland-rl']},wall_seconds=time.perf_counter()-started,summary=dict(cases=len(rows),complete_missions=sum(r['complete_mission'] for r in rows),arrived=sum(r['arrived'] for r in rows),total=sum(r['total'] for r in rows),lateness=sum(r['lateness'] for r in rows),pp_lateness=sum(pp.values()),casewise_regrets=sum(r>0 for r in regs),max_regret=max(regs),safety=safety),results=rows)
(P/'uc23_projected_prior.reference343.json').write_text(json.dumps(report,indent=2))
proof=[]
for c in cases:
 if not(c.departure_offsets[0]==0 and c.departure_offsets[2]==6):continue
 tr=[json.loads(l) for l in (trace/f'{c.case_id}.jsonl').read_text().splitlines()];bytime={r['step']:r for r in tr};m=next(r for r in rows if r['case_id']==c.case_id)
 for r in jointlog:
  if r['case_id']!=c.case_id:continue
  after=bytime[r['step_after']];proof.append({**r,'after_native_frame':after,'mission_complete':m['complete_mission'],'mission_lateness':m['lateness'],'pp_lateness':pp[c.case_id],'native_uncached_reference_disagreements':m['reference_disagreements'],'native_uncertified_steps':m['uncertified_steps'],'native_resource_conflicts':m['resource_conflicts'],'native_nonfault_prediction_mismatches':m['prediction_mismatches']})
(P/'pp-roam-projected7.independent-native-audit.json').write_text(json.dumps(dict(schema='uc23-projected-seven-independent-native-audit-v1',checkpoint_sha256=frozen,full343_audit_sha256=sha(P/'uc23_projected_prior.reference343.json'),scope='Before/after observed junction frames of seven known correction cases, strict PP current-state labels/proofs shown separately from projected executed action. All episode frames independently audited.',frames=proof),indent=2))
print(json.dumps(report['summary']),flush=True);print('FROZEN_SHA',frozen,flush=True)
