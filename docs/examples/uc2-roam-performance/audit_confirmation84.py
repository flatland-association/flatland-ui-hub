"""Independent first-confirmation audit from immutable JSON/Git bytes; no rollout."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent


def read(path):
    return json.loads(Path(path).read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def key(case):
    return case['preset'], tuple(case.get('departure_offsets') or (0,) * (2 if case['preset']=='tutorial' else 3))


def blob_hash(commit, path):
    return hashlib.sha256(subprocess.check_output(['git','show',f'{commit}:{path}'],cwd=ROOT)).hexdigest()


def main():
    paths = {name: HERE/name for name in ['candidate-lock.json','confirmation84-protocol.json',
            'inputs/confirmation84-cases.json','confirmation84-runtime.json','confirmation84-pp.json',
            'known125-runtime-locked.json']}
    lock=read(paths['candidate-lock.json']);protocol=read(paths['confirmation84-protocol.json'])
    manifest=read(paths['inputs/confirmation84-cases.json']);runtime=read(paths['confirmation84-runtime.json'])
    pp=read(paths['confirmation84-pp.json']);known=read(paths['known125-runtime-locked.json'])
    mh=digest(paths['inputs/confirmation84-cases.json'])
    assert mh==lock['reserved_confirmation_manifest_sha256']==protocol['manifest_sha256']==runtime['inputs']['case_manifest_sha256']==pp['manifest_sha256']
    assert digest(paths['confirmation84-protocol.json'])==lock['input_freeze_protocol_sha256']
    assert digest(paths['known125-runtime-locked.json'])==lock['known125_report_sha256']
    assert not lock['confirmation_outcomes_opened_at_selection']
    assert runtime['source_commit']==lock['source_commit'] and runtime['source_worktree_dirty'] is False
    assert runtime['source_sha256']==lock['source_sha256']
    for rel,h in lock['source_sha256'].items():
        assert blob_hash(lock['source_commit'],'backend/'+rel)==h, rel
    assert runtime['inputs']['bundle_manifest_sha256']==lock['bundle_manifest_sha256']
    bundle_rel='backend/app/policies/learned/checkpoints/uc2_roam_specialists.json'
    assert blob_hash(lock['source_commit'],bundle_rel)==lock['bundle_manifest_sha256']
    assert runtime['inputs']['model_sha256']=={p:v['sha256'] for p,v in lock['models'].items()}
    for p,v in lock['models'].items():
        assert blob_hash(lock['source_commit'],'backend/app/policies/learned/checkpoints/'+v['file'])==v['sha256']
    for p,h in runtime['inputs']['native_fixtures'].items():
        assert blob_hash(lock['source_commit'],f'backend/app/fixtures/plan-b/{p}/scenario.pkl')==h
    cases={c['case_id']:c for c in manifest['cases']};rr={r['case_id']:r for r in runtime['results']};pr={r['case_id']:r for r in pp['results']}
    assert len(cases)==len(rr)==len(pr)==84 and set(cases)==set(rr)==set(pr)
    assert len(runtime['results'])==len(pp['results'])==84 and len({key(c)for c in cases.values()})==84
    old=set()
    for rel,h in protocol['excluded_manifest_sha256'].items():
        path=ROOT/rel;assert digest(path)==h;old|={key(c)for c in read(path)['cases']}
    assert len(old)==225 and not old&{key(c)for c in cases.values()}
    rows=[]
    for cid,c in cases.items():
        a,b=rr[cid],pr[cid];assert a['case']==b['case']==c
        assert a['horizon']==b['horizon'] and a['total']==b['total'] and a['required_calls']==b['required_calls']
        assert a['policy']=='uc2_rl' and b['policy']=='pp-trainruns-replan'
        assert a['selected_infrastructure']==c['preset'] and a['checkpoint_sha256']==lock['models'][c['preset']]['sha256']
        assert a['checkpoint_file']==lock['models'][c['preset']]['file'] and a['motion_logit_bias']==0
        assert a['planner_interventions']==0 and 'technical_error'not in a and 'technical_error'not in b
        assert a['scheduled_incidents']==b['scheduled_incidents']==0
        assert len(a['observed_malfunction_counter_increases'])==len(b['observed_malfunction_counter_increases'])==1
        assert a['observation_schema']=='ecml36-service-v1'  # Adapter schema; actor uses its own313builder.
        rows.append({'case_id':cid,'preset':c['preset'],'departure_offsets':list(key(c)[1]),'horizon':a['horizon'],
                     'runtime_complete':a['complete_mission'],'pp_complete':b['complete_mission'],
                     'runtime_arrived':a['arrived'],'pp_arrived':b['arrived'],'trains':a['total'],
                     'runtime_lateness':a['lateness'],'pp_lateness':b['lateness'],'lateness_gap':a['lateness']-b['lateness'],
                     'runtime_makespan':a['steps'],'pp_makespan':b['steps'],'makespan_gap':a['steps']-b['steps'],
                     'selected_checkpoint_sha256':a['checkpoint_sha256']})
    audits={k:sum(r.get(k,0)for r in rr.values())for k in ['reference_disagreements','new_stuck_steps','uncertified_steps','prediction_mismatches','prediction_mismatches_with_new_fault','resource_conflicts','withdrawals','planner_interventions']}
    for k in ['reference_disagreements','new_stuck_steps','uncertified_steps','prediction_mismatches','resource_conflicts','planner_interventions']:assert audits[k]==0,k
    def summary(sub):
        return {'cases':len(sub),'runtime_complete':sum(x['runtime_complete']for x in sub),'pp_complete':sum(x['pp_complete']for x in sub),
                'runtime_arrived':sum(x['runtime_arrived']for x in sub),'pp_arrived':sum(x['pp_arrived']for x in sub),'trains':sum(x['trains']for x in sub),
                'runtime_lateness':sum(x['runtime_lateness']for x in sub),'pp_lateness':sum(x['pp_lateness']for x in sub),
                'lateness_better':sum(x['lateness_gap']<0 for x in sub),'lateness_equal':sum(x['lateness_gap']==0 for x in sub),'lateness_worse':sum(x['lateness_gap']>0 for x in sub),
                'sum_positive_lateness_gap':sum(max(0,x['lateness_gap'])for x in sub),'worst_lateness_gap':max(x['lateness_gap']for x in sub),
                'makespan_better':sum(x['makespan_gap']<0 for x in sub),'makespan_equal':sum(x['makespan_gap']==0 for x in sub),'makespan_worse':sum(x['makespan_gap']>0 for x in sub)}
    total=summary(rows);assert total['runtime_complete']==total['pp_complete']==84 and total['trains']==248
    assert total['runtime_lateness']==runtime['summary']['uc2_rl']['lateness']==2014
    assert total['pp_lateness']==pp['summary']['pp-trainruns-replan']['lateness']==2557
    bad=[r for r in rows if (r['pp_complete']and not r['runtime_complete'])or r['lateness_gap']>0]
    assert len(bad)==4
    report={'schema':'uc2-roam-performance-confirmation84-independent-audit-v1','audited_at_utc':datetime.now(timezone.utc).isoformat(),
            'candidate_source_commit':lock['source_commit'],'candidate_bundle_manifest_sha256':lock['bundle_manifest_sha256'],
            'identity_kind':'multi-model-bundle','checkpoint_sha256':None,'model_sha256':runtime['inputs']['model_sha256'],
            'input_file_sha256':{n:digest(p)for n,p in paths.items()},'candidate_frozen_at_utc':lock['frozen_at_utc'],
            'candidate_lock_source_model_fixture_and_report_hashes_verified':True,'all84case_pairs_retained':True,
            'input_overlap_with_prior225':0,'summary':total,'by_preset':{p:summary([r for r in rows if r['preset']==p])for p in sorted({r['preset']for r in rows})},
            'runtime_audit_counters':audits,'primary_casewise_pp_gate_passed':not bad,'completion_gate_passed':True,
            'primary_gate_failures':bad,'records':rows,
            'interpretation':'Candidate861completedall84butdidNOTachieveper-casePPnonregression:4latenessfailures. Aggregateimprovementdoesnotcancelthem. Afteropening,these84arenowdevelopmentinputsforanysubsequentcandidate; originalinputs/lock/rawreportsremainunchanged.',
            'scope':'Same five native maps, offsets0..6,20perUC2and4Tutorial. No new-map or universal guarantee. Only JSON/Git inspection; no new rollout/training by this auditor.'}
    out=HERE/'confirmation84-independent-audit.json'
    if out.exists():raise FileExistsError('preserve the completed first-confirmation audit')
    out.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'artifact':out.name,'sha256':digest(out),'summary':total,'failures':bad,'audits':audits}))


if __name__=='__main__':main()
