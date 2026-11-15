"""Independent uncached native audit after first all100-zero-regret selection.
All100 are known C4 regressions; earlier fresh C3 failure remains a failure.
"""
import os
from pathlib import Path
import json,hashlib,time,importlib.metadata,torch,numpy as np
from lab.marl.pf_ch_episode import load_cases
from app.policies.learned.uc2_roam_policy import UC2RoamPolicy
from app.policies.learned.roam_check import open_waypoint_groups
from lab.marl.collect_pp_demonstrations import create_teacher
from lab.marl.common import load_model,masked_logits
import lab.marl.evaluate_uc2_roam_runtime as runtime
P=Path(os.environ['UC2_TRAINING_RUN_DIR']);B=Path.cwd();selection=json.loads((P/'selected-candidate.json').read_text());CP=P/selection['checkpoint'];BASE=Path(os.environ['UC2_TRAINING_BASE_CHECKPOINT']);sha=lambda q:hashlib.sha256(Path(q).read_bytes()).hexdigest();frozen=sha(CP);assert frozen==selection['sha256'];torch.set_num_threads(1);old=load_model(BASE).eval();log=[];state={};tracedir=P/'bad08-native-reference-trace';assetdir=B/'app/policies/learned/checkpoints';others={f'uc2_roam_uc2_{i}.pt':sha(assetdir/f'uc2_roam_uc2_{i}.pt') for i in range(1,5)}
def factory(name,env):
 p=UC2RoamPolicy(env,checkpoint=CP,specialists=False)
 if state['case'].departure_offsets==(0,8):
  actual_act=p.act_many
  def logged(handles,observations=None,**kwargs):
   now=int(env._elapsed_steps);captured=p.obs_builder.get_many(handles) if now==13 else None;actions=actual_act(handles,observations,**kwargs)
   if now==13:
    ob=np.asarray(captured[0],dtype=np.float32);groups=open_waypoint_groups(p.obs_builder.base);mask=np.minimum(ob[313:],p.roam_check.action_mask(groups)[0])
    with torch.no_grad():z,_=old(torch.from_numpy(ob[:313][None]));oa=int(masked_logits(z,torch.from_numpy(mask[None])).argmax(-1)[0])
    teacher=create_teacher(env,preset='tutorial',max_orders=4,replan_on_incidents=True,max_replans=8,executor='trainruns');ppact=teacher[0].act_many(handles)[0]
    log.append(dict(case_id=state['case'].case_id,step_before=now,step_after=now+1,handle=0,before_configuration=env.agents[0].current_configuration,obs=ob[:313].tolist(),native_mask=ob[313:].tolist(),guarded_mask=mask.tolist(),c3_base_masked_action=oa,c4_selected_executed_action=actions[0],strict_current_state_pp_action=ppact,strict_current_state_pp_proof=teacher[1]));assert ppact==1 and oa==2 and actions[0]==1 and mask[1]==1
   return actions
  p.act_many=logged
 return p
runtime.create_runtime_policy=factory;cases=[c for c in load_cases(B.parent/'docs/examples/uc2-roam-performance/inputs/systematic1472-v3-cases.json') if c.preset=='tutorial'];refs={tuple(r['departure_offsets']):r for r in json.loads((B.parent/'docs/examples/uc2-roam-performance/pp-reference-systematic1472-v3.json').read_text())['records'] if r['preset']=='tutorial'};rows=[];started=time.perf_counter()
for j,c in enumerate(cases):
 state['case']=c;rows.append(runtime.run_case(c,reference_audit=True,trace_dir=tracedir if c.departure_offsets==(0,8) else None))
 if (j+1)%20==0:print('AUDIT',j+1,flush=True)
assert sha(CP)==frozen;assert all(sha(assetdir/n)==h for n,h in others.items());safety={k:sum(r.get(k,0) for r in rows) for k in ['resource_conflicts','new_stuck_steps','uncertified_steps','prediction_mismatches','prediction_mismatches_with_new_fault','withdrawals','reference_disagreements']};g=[r['lateness']-refs[tuple(r['case']['departure_offsets'])]['lateness'] for r in rows];sg=[r['steps']-refs[tuple(r['case']['departure_offsets'])]['steps'] for r in rows];summary=dict(cases=100,complete_missions=sum(r['complete_mission'] for r in rows),arrived=sum(r['arrived'] for r in rows),total=sum(r['total'] for r in rows),lateness=sum(r['lateness'] for r in rows),pp_lateness=sum(r['lateness'] for r in refs.values()),sum_makespan=sum(r['steps'] for r in rows),pp_sum_makespan=sum(r['steps'] for r in refs.values()),lateness_regrets=sum(x>0 for x in g),max_lateness_gap=max(g),makespan_regrets=sum(x>0 for x in sg),max_makespan_gap=max(sg),safety=safety)
report=dict(schema='tutorial-c4-frozen-known100-native-reference-v1',scope='All100 known Tutorial0..9 cases are C4 regression/selection data; no new untouched Tutorial confirmation. Original C3fresh40 one-failure result retained. First all100-zero-regret candidate frozen before this independent audit, no further choice.',checkpoint=CP.name,checkpoint_sha256=frozen,base_c3_sha256=sha(BASE),other_four_map_checkpoint_sha256_unchanged=others,source_sha256={Path(n).name:h for n,h in runtime.source_hashes().items()}|{Path(__file__).name:sha(__file__)},input_manifest_sha256=sha(B.parent/'docs/examples/uc2-roam-performance/inputs/systematic1472-v3-cases.json'),pp_reference_sha256=sha(B.parent/'docs/examples/uc2-roam-performance/pp-reference-systematic1472-v3.json'),actual_policy_class='UC2RoamPolicy',specialists=False,actual_post_step_reference_audit=True,reference_scope='Every physical frame, independent uncached native stuck_trains(partial_moves=True,max_candidates=60)',software={n:importlib.metadata.version(n) for n in ['torch','numpy','flatland-rl']},wall_seconds=time.perf_counter()-started,summary=summary,results=rows)
(P/'tutorial-c4.reference100.json').write_text(json.dumps(report,indent=2));assert len(log)==1;tr=[json.loads(l) for l in next(tracedir.glob('*.jsonl')).read_text().splitlines()];log[0]['after_native_frame']=next(r for r in tr if r['step']==14);badrow=next(r for r in rows if r['case']['departure_offsets']==[0,8]);proof=dict(schema='tutorial-c4-rawpp08-independent-native-proof-v1',checkpoint_sha256=frozen,reference100_report_sha256=sha(P/'tutorial-c4.reference100.json'),raw_pp_collection_manifest_sha256=sha(P/'pp08.manifest.json'),scope='Raw PP allowed LEFT1 correction, no projection or runtime heuristic. Before/after actual native frame with independently validated current-state PP proof; full episode uncached audit.',before_after=log[0],native_metrics=badrow);(P/'tutorial-c4.rawpp08-independent-native-proof.json').write_text(json.dumps(proof,indent=2));print(json.dumps(summary),flush=True);print('FROZEN_SHA',frozen,flush=True)
