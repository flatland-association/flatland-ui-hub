"""Metadata-only honest export of trained UC2-3 development candidate."""
import os
from pathlib import Path
import hashlib,json,torch
P=Path(os.environ['UC2_TRAINING_RUN_DIR']);B=Path.cwd();src=P/'projected-kl10-s17-step200.pt';dst=P/'uc23_projected_prior.pt'
sha=lambda q:hashlib.sha256(Path(q).read_bytes()).hexdigest()
def state_sha(state):
 h=hashlib.sha256()
 for n,t in sorted(state.items()):
  h.update(n.encode());h.update(str(t.dtype).encode());h.update(str(tuple(t.shape)).encode());h.update(t.detach().cpu().contiguous().numpy().tobytes())
 return h.hexdigest()
raw=json.loads((P/'counterfactual-stop.json').read_text());selected=[r for r in raw if r['n']==1];records=[]
for r in selected:
 assert r['metrics']['complete_mission'] and len(r['corrections'])==1
 c=r['corrections'][0];assert c['pp_current_action']==2 and c['teacher_action']==4 and c['mask'][2]==0 and c['mask'][4]==1
 proof=dict(case=r['case'],metrics=r['metrics'],correction=c)
 proof_sha=hashlib.sha256(json.dumps(proof,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 records.append(dict(schema='uc23-roam-projected-correction-v1',observation_schema='uc2-context-v1',owner='verified_roam_projection',source='native_strict_pp_roam_safe_stop_projection',case_id=r['case']['case_id'],split='train',step=c['step'],handle=1,obs=c['obs'],mask=c['mask'],teacher_action=4,raw_pp_action=2,old_action=c['old_action'],applied_action=4,mission_verified=True,proof_scope='native_full_guarded_mission',proof_sha256=proof_sha,projection='Strict PP wants masked-out straight2. Choose certified STOP4 once instead of frozen-neural detour3, then resume frozen neural+ROAM. This projected label is not a raw PP demonstration.'))
(P/'pp-roam-projected7.jsonl').write_text(''.join(json.dumps(r,separators=(',',':'))+'\n' for r in records))
(P/'pp-roam-projected7.manifest.json').write_text(json.dumps({'schema':'uc23-roam-projected-correction-manifest-v1','source':'native_strict_pp_roam_safe_stop_projection','source_report_sha256':sha(P/'counterfactual-stop.json'),'correction_samples':len(records),'cases':selected,'warning':'Projected safe labels have separate provenance from genuine native_strict_pp pp7.jsonl.'},indent=2))
payload=torch.load(src,map_location='cpu',weights_only=True);meta=payload['meta'];steps=meta['hyperparameters']['gradient_steps'];nprior=meta['source_counts']['old_frozen_neural_prior'];meta['epochs_completed']=int(steps*2048/nprior);meta['hyperparameters']['prior_sample_equivalent_epochs']=steps*2048/nprior
meta['datasets']=[dict(name='old-neural-prior336.npz',sha256=sha(P/'old-neural-prior336.npz'),samples=nprior,source='old_frozen_neural_prior'),dict(name='pp7.jsonl',sha256=sha(P/'pp7.jsonl'),samples=2058,source='native_strict_pp'),dict(name='pp-roam-projected7.jsonl',sha256=sha(P/'pp-roam-projected7.jsonl'),samples=7,source='native_strict_pp_roam_safe_stop_projection')]
meta['source_sha256'].update({p.name:sha(p) for p in [Path(__file__), B/'lab/marl/common.py',B/'lab/marl/collect_pp_demonstrations.py',B/'lab/marl/pf_ch_episode.py',B/'lab/marl/evaluate_uc2_roam_runtime.py',B/'app/policies/learned/learned_ppo_policy.py',B/'app/policies/learned/uc2_observation.py',B/'app/policies/learned/uc2_roam_policy.py',B/'app/policies/learned/roam_check.py',B/'app/policies/learned/roam_joint_check.py']})
meta['teacher_source_counts']=dict(meta['source_counts'])
meta['artifact_export']='Metadata-only export; tensor values identical to selected development candidate. Original training script counted gradient steps as epochs; this export reports floor(prior sample-equivalent epochs) and keeps exact200 gradient updates in hyperparameters.'
meta['selected_runtime_artifact_sha256']=sha(src);meta['model_tensor_sha256']=state_sha(payload['model']);meta['development_candidate_updates_evaluated']=[100,200]
torch.save(payload,dst);again=torch.load(dst,map_location='cpu',weights_only=True);assert state_sha(again['model'])==meta['model_tensor_sha256']
report=json.loads(src.with_suffix('.full343.json').read_text()); rr=report['results'];old=json.loads((B.parent/'docs/examples/uc2-roam-performance/uc23-systematic343-runtime.json').read_text())['results'];oldsum=sum(r['lateness'] for r in old);newsum=sum(r['lateness'] for r in rr);ppsum=report['summary']['pp_lateness']
safety={k:sum(r.get(k,0) for r in rr) for k in ['resource_conflicts','new_stuck_steps','uncertified_steps','prediction_mismatches','prediction_mismatches_with_new_fault','withdrawals','reference_disagreements']}
export=dict(schema='uc23-projected-prior-export-v1',scope='Known native UC2-3 systematic343 development cases; no future40 access. No runtime policy source, feature schema, ROAM core or native action contract modified.',checkpoint=dst.name,checkpoint_sha256=sha(dst),model_tensor_sha256=meta['model_tensor_sha256'],selected_evaluated_checkpoint=src.name,selected_evaluated_checkpoint_sha256=sha(src),tensor_equality_asserted=True,metadata_only_export=True,training=meta,validation=dict(cases=len(rr),complete_missions=sum(bool(r['complete_mission']) for r in rr),arrived=sum(r['arrived'] for r in rr),total_trains=sum(r['total'] for r in rr),lateness=newsum,base_lateness=oldsum,pp_lateness=ppsum,retained_original_aggregate_gain=(ppsum-newsum)/(ppsum-oldsum),casewise_pp_regrets=report['summary']['casewise_regrets'],max_pp_regret=report['summary']['max_regret'],actual_post_step_snapshots=True,independent_reference_audit=False,safety=safety),validation_report=dict(name=src.with_suffix('.full343.json').name,sha256=sha(src.with_suffix('.full343.json'))))
(P/'uc23_projected_prior.export.json').write_text(json.dumps(export,indent=2));(P/'uc23_projected_prior.meta.json').write_text(json.dumps(meta,indent=2));print(json.dumps({k:export[k] for k in ['checkpoint','checkpoint_sha256','validation']},indent=2))
