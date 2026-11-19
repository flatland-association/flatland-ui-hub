"""Known Tutorial100 C4 repair. The formerly fresh C3 [0,8] is now training data.
No untouched within-range confirmation remains; other four map models unchanged.
"""
import os
from pathlib import Path
import json,hashlib,torch,numpy as np
from lab.marl.pf_ch_episode import load_cases,PFChEpisode
from lab.marl.collect_pp_demonstrations import collect_case,create_teacher,canonical_teacher_action
from app.policies.learned.uc2_roam_policy import UC2RoamPolicy
from lab.marl.common import load_model,masked_logits
from app.utils.agent_compat import agent_position
P=Path(os.environ['UC2_TRAINING_RUN_DIR']);B=Path.cwd();BASE=Path(os.environ['UC2_TRAINING_BASE_CHECKPOINT']);torch.set_num_threads(1)
assert hashlib.sha256(BASE.read_bytes()).hexdigest() in {'46237ea9bdff9f4980d0fe26199080c3c51aefa7ead2d8ec266ef85e92fba600', '25805b3ff1b7f78c8a3271ec1aa9e9cd88dd37a924930e2637b396aa1f9083c3'}
cs=[c for c in load_cases(B.parent/'docs/examples/uc2-roam-performance/inputs/systematic1472-v3-cases.json') if c.preset=='tutorial'];bad=next(c for c in cs if c.departure_offsets==(0,8));old=load_model(BASE).eval()
rows,rep=collect_case(bad,split='train',max_orders=4,replan_on_incidents=True,max_replans=8,executor='trainruns',observation_schema='uc2-context-v1');assert rep['accepted'];print('RAW_PP_BAD',rep['metrics']['lateness'],rep['metrics']['steps'],len(rows),flush=True)
(P/'pp08.jsonl').write_text(''.join(json.dumps(r,separators=(',',':'))+'\n' for r in rows));(P/'pp08.manifest.json').write_text(json.dumps(rep,indent=2))
with torch.no_grad():
 x=torch.tensor([r['obs'] for r in rows]);m=torch.tensor([r['mask'] for r in rows]);z,_=old(x);pred=masked_logits(z,m).argmax(-1).tolist()
diff=[{k:r[k] for k in ['step','handle','teacher_action','mask']}|{'old_native_mask_action':a,'old_logits':z[i].tolist()} for i,(r,a) in enumerate(zip(rows,pred)) if a!=r['teacher_action']];(P/'pp08-first-label-divergence.json').write_text(json.dumps(diff,indent=2));print('PP08_OLD_LABEL_DIFFS',diff,flush=True)
# Follow raw PP path; measure whether actual deployed guarded actor agrees.
e=PFChEpisode(bad,observation_schema='uc2-context-v1');policy=UC2RoamPolicy(e.env,checkpoint=BASE,specialists=False);teacher,*_=create_teacher(e.env,preset='tutorial',max_orders=4,replan_on_incidents=True,max_replans=8,executor='trainruns');guarddiff=[]
while not e.done:
 prep=policy.prepare_inference(e.handles);hs,ob,w=prep;_,native=e.observe(hs);raw=teacher.act_many(hs);ta={h:canonical_teacher_action(raw[h],on_map=agent_position(e.env.agents[h]) is not None,mask=native[i])[0] for i,h in enumerate(hs)};proposed=policy.infer_prepared(prep);acts=policy.finalize_actions(proposed)
 for i,h in enumerate(hs):
  if acts[h]!=ta[h]:guarddiff.append(dict(step=e.now,handle=h,raw_pp_action=raw[h],pp_action=ta[h],old_guarded_action=acts[h],native_mask=native[i].tolist(),guarded_mask=ob[i,w:].tolist(),configuration=e.env.agents[h].current_configuration))
 e.step(ta)
e.close();(P/'pp08-guarded-divergence.json').write_text(json.dumps(guarddiff,indent=2));print('PP08_GUARDED_DIFFS',guarddiff,flush=True)
xs=[];ms=[];logits=[];index=[];metrics=[]
for j,c in enumerate(cs):
 if c==bad:continue
 ep=PFChEpisode(c);p=UC2RoamPolicy(ep.env,checkpoint=BASE,specialists=False)
 while not ep.done:
  prep=p.prepare_inference(ep.handles);handles,ob,w=prep
  with torch.no_grad():score,_=old(torch.from_numpy(ob[:,:w]))
  acts=p.finalize_actions(p.infer_prepared(prep))
  for i,h in enumerate(handles):
   if np.count_nonzero(ob[i,w:]>=.5)>1:xs.append(ob[i,:w].copy());ms.append(ob[i,w:].copy());logits.append(score[i].numpy().copy());index.append((j,ep.now,h))
  ep.step(acts)
 met=ep.metrics();assert met['complete_mission'];metrics.append(met);ep.close()
 if (j+1)%20==0:print('PRIOR',j+1,len(xs),flush=True)
np.savez_compressed(P/'c3-neural-prior99.npz',obs=np.array(xs),mask=np.array(ms),logits=np.array(logits),index=np.array(index));(P/'c3-neural-prior99.manifest.json').write_text(json.dumps(dict(source='c3_frozen_neural_prior',base_sha256=hashlib.sha256(BASE.read_bytes()).hexdigest(),samples=len(xs),scope='All99 previously good Tutorial known C4 cases. Neural logits, not PP/DLA.',cases=metrics),indent=2));print('DONE',len(xs),len(rows),flush=True)
