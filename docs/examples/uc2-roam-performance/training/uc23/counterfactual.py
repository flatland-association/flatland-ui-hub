import os
from pathlib import Path
import json,torch
from lab.marl.pf_ch_episode import load_cases,PFChEpisode
from app.policies.learned.uc2_roam_policy import UC2RoamPolicy
from lab.marl.collect_pp_demonstrations import create_teacher
B=Path.cwd(); R=Path(os.environ['UC2_TRAINING_RUN_DIR']);torch.set_num_threads(1)
cs=[c for c in load_cases(B.parent/'docs/examples/uc2-roam-performance/inputs/uc23-systematic343-v3-cases.json') if c.departure_offsets[0]==0 and c.departure_offsets[2]==6]
rows=[]
for n in range(1,7):
 for c in cs:
  ep=PFChEpisode(c,observation_schema='uc2-context-v1');p=UC2RoamPolicy(ep.env,specialists=False);used=0;cor=[]
  while not ep.done:
   prep=p.prepare_inference(ep.handles);hs,ob,w=prep;prop=p.infer_prepared(prep);a=ep.env.agents[1]
   if a.current_configuration==((3,66),1) and prop[1]==3 and used<n and ob[hs.index(1),w+4]>=.5:
    pp=create_teacher(ep.env,preset=c.preset,max_orders=4,replan_on_incidents=True,max_replans=8,executor='trainruns')
    teach=pp[0].act_many(hs) if pp else {}
    cor.append(dict(step=ep.now,obs=ob[hs.index(1),:w].tolist(),mask=ob[hs.index(1),w:].tolist(),old_action=prop[1],teacher_action=4,pp_current_action=teach.get(1),current_state_proof=pp[1] if pp else None));prop[1]=4;used+=1
   acts=p.finalize_actions(prop);ep.step(acts)
  m=ep.metrics();rows.append(dict(n=n,case=c.to_dict(),metrics=m,corrections=cor));print(n,c.departure_offsets,m['lateness'],'used',used,'PPactions',[r['pp_current_action'] for r in cor],flush=True);ep.close()
(R/'counterfactual-stop.json').write_text(json.dumps(rows,indent=2))
