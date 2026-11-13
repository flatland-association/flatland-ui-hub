import os,sys,json,hashlib,time
from pathlib import Path
import numpy as np,torch
from lab.marl.pf_ch_episode import load_cases,PFChEpisode
from lab.marl.collect_pp_demonstrations import collect_case
from app.policies.learned.uc2_roam_policy import UC2RoamPolicy
from lab.marl.common import load_model,masked_logits
ROOT=Path(os.environ['UC2_TRAINING_RUN_DIR']); BACK=Path.cwd(); BASE=BACK/'app/policies/learned/checkpoints/uc2_demo_ppo.pt'
torch.set_num_threads(1)
cases=load_cases(BACK.parent/'docs/examples/uc2-roam-performance/inputs/uc23-systematic343-v3-cases.json')
bad=[c for c in cases if c.departure_offsets[0]==0 and c.departure_offsets[2]==6]
old=load_model(BASE).eval(); pp=[]; reports=[]; diag=[]
for c in bad:
 rows,rep=collect_case(c,split='train',max_orders=4,replan_on_incidents=True,max_replans=8,executor='trainruns',observation_schema='uc2-context-v1')
 assert rep['accepted'],rep
 obs=torch.tensor(np.array([r['obs'] for r in rows]),dtype=torch.float32); masks=torch.tensor(np.array([r['mask'] for r in rows]),dtype=torch.float32)
 with torch.no_grad(): logits,_=old(obs); pred=masked_logits(logits,masks).argmax(-1).tolist()
 diff=[dict(step=r['step'],handle=r['handle'],teacher=r['teacher_action'],old=a,old_logits=logits[i].tolist()) for i,(r,a) in enumerate(zip(rows,pred)) if a!=r['teacher_action']]
 diag.append({'case':c.to_dict(),'metrics':rep['metrics'],'disagreements':diff});pp.extend(rows);reports.append(rep)
 print('PP',c.departure_offsets,len(rows),rep['metrics']['lateness'],'first disagreements',diff[:3],flush=True)
(ROOT/'pp7.jsonl').write_text(''.join(json.dumps(r,separators=(',',':'))+'\n' for r in pp));(ROOT/'pp7.manifest.json').write_text(json.dumps({'reports':reports},indent=2));(ROOT/'first-divergence.json').write_text(json.dumps(diag,indent=2))
xs=[];ms=[];logits=[];index=[];metrics=[]
for j,c in enumerate(cases):
 if c in bad:continue
 ep=PFChEpisode(c);p=UC2RoamPolicy(ep.env,checkpoint=BASE,specialists=False)
 try:
  while not ep.done:
   prep=p.prepare_inference(ep.handles);handles,ob,w=prep
   with torch.no_grad(): scores,_=old(torch.from_numpy(ob[:,:w]))
   props=p.infer_prepared(prep);acts=p.finalize_actions(props)
   for i,h in enumerate(handles):
    if np.count_nonzero(ob[i,w:]>=.5)>1:
     xs.append(ob[i,:w].copy());ms.append(ob[i,w:].copy());logits.append(scores[i].numpy().copy());index.append((j,ep.now,h))
   ep.step(acts)
  met=ep.metrics();assert met['complete_mission'];metrics.append(met)
 finally:ep.close()
 if (j+1)%35==0:print('PRIOR',j+1,len(xs),flush=True)
np.savez_compressed(ROOT/'old-neural-prior336.npz',obs=np.array(xs),mask=np.array(ms),logits=np.array(logits),index=np.array(index))
(ROOT/'old-neural-prior336.manifest.json').write_text(json.dumps({'source':'old_frozen_neural_prior','base_sha256':hashlib.sha256(BASE.read_bytes()).hexdigest(),'sample_count':len(xs),'cases':metrics,'scope':'Completed known UC2-3 native guarded episodes. Old neural logits; not PP or DLA demonstrations.'},indent=2))
print('DONE',len(xs),len(pp),flush=True)
