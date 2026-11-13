"""Known UC2-3 correction: distill old frozen prior + labels of ROAM-safe projection.
The correction labels are NOT raw PP demonstrations: current-state strict PP asks
straight at a masked-out action, and STOP is verified by full guarded episode.
"""
import os
from pathlib import Path
import json,hashlib,importlib.metadata,time,sys,argparse
import numpy as np,torch
import torch.nn.functional as F
from lab.marl.common import load_model,masked_logits
from lab.marl.pf_ch_episode import load_cases
from app.policies.learned.uc2_roam_policy import UC2RoamPolicy
import lab.marl.evaluate_uc2_roam_runtime as runtime
P=Path(os.environ['UC2_TRAINING_RUN_DIR']);B=Path.cwd();BASE=B/'app/policies/learned/checkpoints/uc2_demo_ppo.pt'
torch.set_num_threads(1)
parser=argparse.ArgumentParser();parser.add_argument('--kl',type=float,default=10);parser.add_argument('--steps',type=int,default=1000);parser.add_argument('--seed',type=int,default=17);args=parser.parse_args();torch.manual_seed(args.seed);np.random.seed(args.seed)
data=np.load(P/'old-neural-prior336.npz');xo=torch.from_numpy(data['obs']);mo=torch.from_numpy(data['mask']);lo=torch.from_numpy(data['logits']);po=masked_logits(lo,mo).softmax(-1)
cfs=json.loads((P/'counterfactual-stop.json').read_text());selected=[r for r in cfs if r['n']==1];cr=[c for r in selected for c in r['corrections']];assert len(cr)==7
xc=torch.tensor([r['obs'] for r in cr]);mc=torch.tensor([r['mask'] for r in cr]);yc=torch.tensor([r['teacher_action'] for r in cr])
pp=[json.loads(r) for r in (P/'pp7.jsonl').read_text().splitlines()];xp=torch.tensor([r['obs'] for r in pp]);mp=torch.tensor([r['mask'] for r in pp]);yp=torch.tensor([r['teacher_action'] for r in pp])
model=load_model(BASE).train(); opt=torch.optim.Adam(model.parameters(),lr=1e-4)
base_state={k:v.clone() for k,v in model.state_dict().items()};cases=load_cases(B.parent/'docs/examples/uc2-roam-performance/inputs/uc23-systematic343-v3-cases.json');bad=[c for c in cases if c.departure_offsets[0]==0 and c.departure_offsets[2]==6]
ppref={r['case_id']:r['lateness'] for r in json.loads((B.parent/'docs/examples/uc2-roam-performance/uc23-systematic343-pp.json').read_text())['results']}
sha=lambda q:hashlib.sha256(Path(q).read_bytes()).hexdigest()
def save(step):
 path=P/f'projected-kl{args.kl:g}-s{args.seed}-step{step}.pt'
 meta=dict(observation_schema='uc2-context-v1',obs_size=313,hidden_size=128,num_hidden_layers=3,epochs_completed=step,samples=len(xo)+len(xc)+len(xp),datasets=[{'name':n,'sha256':sha(P/n)} for n in ['old-neural-prior336.npz','pp7.jsonl','counterfactual-stop.json']],source_sha256={Path(__file__).name:sha(__file__),'prepare_data.py':sha(P/'prepare_data.py'),'counterfactual.py':sha(P/'counterfactual.py')},hyperparameters={'optimizer':'Adam','learning_rate':1e-4,'gradient_steps':step,'prior_kl':args.kl,'raw_pp_ce':.02,'projected_safe_ce':1.,'seed':args.seed,'prior_batch_size':2048,'pp_batch_size':128},teacher_sources=['old_frozen_neural_prior','native_strict_pp','native_strict_pp_roam_safe_stop_projection'],source_counts={'old_frozen_neural_prior':len(xo),'native_strict_pp':len(xp),'native_strict_pp_roam_safe_stop_projection':len(xc)},base_sha256=sha(BASE),software={n:importlib.metadata.version(n) for n in ['torch','numpy','flatland-rl']},training_scope='All343 native UC2-3 offset triples 0..6 known development. No future40 accessed.',correction_provenance='Seven full guarded native missions verify STOP replacement for PP straight2 when ROAM excludes it and frozen actor prefers detour3. These seven projected labels are not raw PP demonstrations.',training_method='Supervised projected safe PP correction CE plus genuine PP7 CE and old frozen neural logit KL on336 completed guarded trajectories. Prior samples are not PP/DLA.',frozen=True)
 torch.save({'model':model.state_dict(),'meta':meta},path);return path
for step in range(1,args.steps+1):
 ix=torch.randint(len(xo),(2048,));ip=torch.randint(len(xp),(128,))
 scores,_=model(xo[ix]);logp=masked_logits(scores,mo[ix]).log_softmax(-1);kl=F.kl_div(logp,po[ix],reduction='batchmean')
 zc,_=model(xc);ce=F.cross_entropy(masked_logits(zc,mc),yc)
 zp,_=model(xp[ip]);cepp=F.cross_entropy(masked_logits(zp,mp[ip]),yp[ip]);loss=ce+args.kl*kl+.02*cepp
 opt.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);opt.step()
 if step%100==0:
  model.eval()
  with torch.no_grad():
   zz,_=model(xo);flips=int((masked_logits(zz,mo).argmax(-1)!=masked_logits(lo,mo).argmax(-1)).sum());pred=masked_logits(model(xc)[0],mc).argmax(-1).tolist()
  print('TRAIN',args.kl,step,'ce',round(float(ce.detach()),4),'kl',round(float(kl.detach()),5),'priorflips',flips,'correction',pred,flush=True)
  if pred==[4]*7 or step==args.steps:
   path=save(step)
   runtime.create_runtime_policy=lambda name,env:UC2RoamPolicy(env,checkpoint=path,specialists=False)
   rr=[runtime.run_case(c,reference_audit=False) for c in bad];reg=[r['lateness']-ppref[r['case_id']] for r in rr]
   print('BAD7',path.name,'regrets',reg,'complete',all(r['complete_mission'] for r in rr),flush=True)
   (path.with_suffix('.bad7.json')).write_text(json.dumps(rr,indent=2))
   if max(reg)<=0 and all(r['complete_mission'] for r in rr):
    rr=[runtime.run_case(c,reference_audit=False) for c in cases];reg=[r['lateness']-ppref[r['case_id']] for r in rr];complete=all(r['complete_mission'] for r in rr)
    report=dict(schema='uc23-projected-fit-native343-v1',checkpoint=path.name,checkpoint_sha256=sha(path),prior_kl=args.kl,steps=step,summary=dict(complete=complete,lateness=sum(r['lateness'] for r in rr),pp_lateness=sum(ppref.values()),casewise_regrets=sum(x>0 for x in reg),max_regret=max(reg),regret_case_ids=[r['case_id'] for r,rg in zip(rr,reg) if rg>0]),actual_post_step_reference_audit=False,results=rr)
    path.with_suffix('.full343.json').write_text(json.dumps(report,indent=2));print('FULL343',path.name,report['summary'],flush=True)
    if complete and max(reg)<=0:print('SUCCESS',path,flush=True);break
  model.train()
