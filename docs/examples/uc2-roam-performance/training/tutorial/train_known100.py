"""C4 strict-PP correction + C3 neural-prior KL. All Tutorial100 now known.
No holdout remains within0..9. No projected labels or runtime guard changes.
"""
import os
from pathlib import Path
import json,hashlib,time,importlib.metadata,argparse,torch,numpy as np
import torch.nn.functional as F
from lab.marl.common import load_model,masked_logits
from lab.marl.pf_ch_episode import load_cases
from app.policies.learned.uc2_roam_policy import UC2RoamPolicy
import lab.marl.evaluate_uc2_roam_runtime as runtime
P=Path(os.environ['UC2_TRAINING_RUN_DIR']);B=Path.cwd();BASE=Path(os.environ['UC2_TRAINING_BASE_CHECKPOINT']);torch.set_num_threads(1)
a=argparse.ArgumentParser();a.add_argument('--kl',type=float,default=10);a.add_argument('--steps',type=int,default=800);a.add_argument('--seed',type=int,default=17);a.add_argument('--margin',type=float,default=0);args=a.parse_args();torch.manual_seed(args.seed);np.random.seed(args.seed)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
d=np.load(P/'c3-neural-prior99.npz');x=torch.from_numpy(d['obs']);m=torch.from_numpy(d['mask']);zold=torch.from_numpy(d['logits']);pold=masked_logits(zold,m).softmax(-1);yold=masked_logits(zold,m).argmax(-1)
pp=[json.loads(s) for s in (P/'pp08.jsonl').read_text().splitlines()];xp=torch.tensor([r['obs'] for r in pp]);mp=torch.tensor([r['mask'] for r in pp]);yp=torch.tensor([r['teacher_action'] for r in pp]);corr=[i for i,r in enumerate(pp) if r['step']==13 and r['handle']==0];assert len(corr)==1;xc=xp[corr];mc=mp[corr];yc=yp[corr]
model=load_model(BASE).train();opt=torch.optim.Adam(model.parameters(),lr=1e-4);cases=[c for c in load_cases(B.parent/'docs/examples/uc2-roam-performance/inputs/systematic1472-v3-cases.json') if c.preset=='tutorial'];bad=next(c for c in cases if c.departure_offsets==(0,8));refs={tuple(r['departure_offsets']):r for r in json.loads((B.parent/'docs/examples/uc2-roam-performance/pp-reference-systematic1472-v3.json').read_text())['records'] if r['preset']=='tutorial'}
origmargin=torch.clamp(.5*(zold.gather(1,yold[:,None])-zold),min=.05,max=1.);valid=m>=.5;valid.scatter_(1,yold[:,None],False)
def save(step):
 out=P/f'tutorial-kl{args.kl:g}-margin{args.margin:g}-s{args.seed}-update{step}.pt';meta=dict(observation_schema='uc2-context-v1',obs_size=313,hidden_size=128,num_hidden_layers=3,epochs_completed=int(step*1024/len(x)),samples=len(x)+len(xp),datasets=[dict(name=n,sha256=sha(P/n),source=s,samples=k) for n,s,k in [('c3-neural-prior99.npz','c3_frozen_neural_prior',len(x)),('pp08.jsonl','native_strict_pp',len(xp))]],source_sha256={Path(__file__).name:sha(__file__),'prepare_data.py':sha(P/'prepare_data.py'),**{Path(n).name:sha(B/n) for n in ['app/policies/learned/uc2_observation.py','app/policies/learned/learned_ppo_policy.py','app/policies/learned/uc2_roam_policy.py','app/policies/learned/roam_check.py','app/policies/learned/roam_joint_check.py','lab/marl/collect_pp_demonstrations.py','lab/marl/pf_ch_episode.py','lab/marl/common.py']}},hyperparameters=dict(optimizer='Adam',learning_rate=1e-4,gradient_updates=step,prior_sample_equivalent_epochs=step*1024/len(x),prior_batch_size=1024,prior_kl=args.kl,prior_action_margin=args.margin,disagreement_strict_pp_ce=1.,all_bad_case_strict_pp_ce=.02,seed=args.seed),teacher_sources=['native_strict_pp','c3_frozen_neural_prior'],teacher_source_counts={'native_strict_pp':len(xp),'c3_frozen_neural_prior':len(x)},base_sha256=sha(BASE),software={n:importlib.metadata.version(n) for n in ['torch','numpy','flatland-rl']},training_method='Strict PP CE at one actual native/ROAM allowed left-vs-forward disagreement plus rawPP case CE and C3 frozen-neural-prior logit KL on99 complete guarded known cases. Neural prior is not PP/DLA.',training_scope='C4 known regression repair. All100 native Tutorial offset pairs0..9 are known. Earlier C3 fresh40 failure [0,8] retained; no new untouched Tutorial confirmation remains.',selected_case_source='Previously fresh C3[0,8] became known C4 training evidence; no scenario/offset IDs are runtime model inputs.',frozen_before_independent_audit=True)
 torch.save(dict(model=model.state_dict(),meta=meta),out);return out
for step in range(1,args.steps+1):
 ix=torch.randint(len(x),(1024,));z,_=model(x[ix]);kl=F.kl_div(masked_logits(z,m[ix]).log_softmax(-1),pold[ix],reduction='batchmean');zc,_=model(xc);ce=F.cross_entropy(masked_logits(zc,mc),yc);zp,_=model(xp);cep=F.cross_entropy(masked_logits(zp,mp),yp);loss=ce+args.kl*kl+.02*cep
 if args.margin:
  za,_=model(x);chosen=za.gather(1,yold[:,None]);v=(origmargin-(chosen-za)).masked_fill(~valid,0).clamp(min=0).max(-1).values;loss=loss+args.margin*v.topk(32).values.mean()
 opt.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);opt.step()
 if step%50==0:
  model.eval()
  with torch.no_grad():
   z,_=model(x);flips=int((masked_logits(z,m).argmax(-1)!=yold).sum());cp=int(masked_logits(model(xc)[0],mc).argmax(-1)[0])
  print('TRAIN',step,'ce',round(float(ce.detach()),6),'kl',round(float(kl.detach()),6),'priorflips',flips,'correction',cp,flush=True)
  if cp==1 or step==args.steps:
   path=save(step);frozen=sha(path);runtime.create_runtime_policy=lambda name,env:UC2RoamPolicy(env,checkpoint=path,specialists=False);br=runtime.run_case(bad,reference_audit=False);print('BAD08',step,br['lateness'],br['steps'],flush=True)
   if br['complete_mission'] and br['lateness']<=9 and br['steps']<=29:
    rr=[runtime.run_case(c,reference_audit=False) for c in cases];regs=[r['lateness']-refs[tuple(r['case']['departure_offsets'])]['lateness'] for r in rr];sg=[r['steps']-refs[tuple(r['case']['departure_offsets'])]['steps'] for r in rr];sm=dict(cases=100,complete_missions=sum(r['complete_mission'] for r in rr),arrived=sum(r['arrived'] for r in rr),lateness=sum(r['lateness'] for r in rr),pp_lateness=sum(r['lateness'] for r in refs.values()),sum_makespan=sum(r['steps'] for r in rr),pp_sum_makespan=sum(r['steps'] for r in refs.values()),lateness_regrets=sum(g>0 for g in regs),max_lateness_gap=max(regs),makespan_regrets=sum(g>0 for g in sg),max_makespan_gap=max(sg));report=dict(schema='tutorial-c4-known100-selection-v1',scope='All100 known C4 Tutorial cases; no untouched confirmation. C3 failure retained separately.',checkpoint=path.name,checkpoint_sha256=frozen,summary=sm,actual_post_step_reference_audit=False,results=rr);path.with_suffix('.known100.json').write_text(json.dumps(report,indent=2));print('KNOWN100',path.name,sm,flush=True)
    if sm['complete_missions']==100 and sm['lateness_regrets']==sm['makespan_regrets']==0:
     assert sha(path)==frozen;(P/'selected-candidate.json').write_text(json.dumps(dict(checkpoint=path.name,sha256=frozen,selection_report=path.with_suffix('.known100.json').name,summary=sm),indent=2));print('SUCCESS',path,flush=True);break
  model.train()
