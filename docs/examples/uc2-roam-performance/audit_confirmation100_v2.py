"""Audit reserved inputs or complete Candidate2 confirmation, without rollouts.

--inputs-only never reads a candidate lock or any new100 outcome. Full mode is
for use only after the owner explicitly opens the frozen confirmation results.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import itertools
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
EXPECTED_INPUT_SHA = 'ce5c1372d44c4a4220e2e8b72232dab66eca6c69404e1018d23282f0e3a60cc5'
EXPECTED_PROTOCOL_SHA = '85fb2d86df8505fcf91cf3cf288a50bce034fbdbd10c1b02b23044933878304a'
HORIZONS = {'tutorial':40, 'uc2-1':168, 'uc2-2':102, 'uc2-3':240, 'uc2-4':180}


def read(path):
    return json.loads(Path(path).read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def key(case):
    return case['preset'], tuple(case.get('departure_offsets') or (0,) * (2 if case['preset']=='tutorial' else 3))


def git_bytes(commit, path):
    return subprocess.check_output(['git','show',f'{commit}:{path}'], cwd=ROOT)


def publish(path, data):
    if path.exists():
        raise FileExistsError(f'preserve completed evidence: {path.name}')
    temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(data,indent=2)+'\n')
    temp.replace(path)


def inputs_audit():
    manifest_path=HERE/'inputs/confirmation100-v2-cases.json'
    protocol_path=HERE/'confirmation100-v2-protocol.json'
    assert digest(manifest_path)==EXPECTED_INPUT_SHA
    assert digest(protocol_path)==EXPECTED_PROTOCOL_SHA
    manifest,protocol=read(manifest_path),read(protocol_path)
    assert protocol['manifest_sha256']==EXPECTED_INPUT_SHA
    assert digest(HERE/protocol['generator'])==protocol['generator_sha256']
    cases=manifest['cases'];keys={key(c)for c in cases}
    assert len(cases)==len(keys)==100 and len({c['case_id']for c in cases})==100
    assert all(c['seed']==0 and c['horizon'] is None and not c['disturbances'] and not c['disturbance_ids']for c in cases)
    old=set()
    for rel,sha in protocol['excluded_manifest_sha256'].items():
        assert digest(ROOT/rel)==sha
        old|={key(c)for c in read(ROOT/rel)['cases']}
    assert len(old)==309 and not old&keys
    for preset in HORIZONS:
        vectors=[v for p,v in keys if p==preset]
        assert len(vectors)==20
        if preset=='tutorial':
            assert all(len(v)==2 and all(0<=x<=9 for x in v) and any(x>=7 for x in v)for v in vectors)
        else:
            assert all(len(v)==3 and all(0<=x<=6 for x in v)for v in vectors)
    provenance_path=HERE/'dense-v2-training-input-provenance.json'
    provenance=read(provenance_path);dense=[]
    for entry in provenance['manifests']:
        p=HERE/entry['copied_manifest'];assert digest(p)==entry['source_sha256']==entry['copied_sha256']
        data=read(p);preset=entry['preset'];reserved={v for q,v in keys if q==preset}
        actual={key(c)for c in data['cases']}
        expected={(preset,v)for v in itertools.product(range(7),repeat=3)if v not in reserved}
        assert len(data['cases'])==len(actual)==323 and actual==expected and not actual&keys
        assert data['reservation_sha256']==EXPECTED_INPUT_SHA
        dense.append({'preset':preset,'cases':323,'manifest':entry['copied_manifest'],'sha256':digest(p),
                      'reserved_twenty_excluded':True,'equals_complete343_minus_reserved20':True})
    assert {e['preset']for e in dense}=={'uc2-1','uc2-2'}
    prior_audit=read(HERE/'confirmation84-independent-audit.json')
    assert not prior_audit['primary_casewise_pp_gate_passed'] and prior_audit['summary']['lateness_worse']==4
    for name,sha in prior_audit['input_file_sha256'].items():
        assert digest(HERE/name)==sha, f'first-confirmation evidence changed: {name}'
    return manifest,protocol,{'schema':'uc2-confirmation100-v2-input-audit-v1',
        'audited_at_utc':datetime.now(timezone.utc).isoformat(),'manifest_sha256':EXPECTED_INPUT_SHA,
        'protocol_sha256':EXPECTED_PROTOCOL_SHA,'cases':100,'trains':280,'old_union309_overlap':0,
        'internal_duplicates':0,'dense_training':dense,'old84_failed_evidence_preserved':True,
        'new100_outcome_files_read':False,'generator_never_performed_policy_training_or_evaluation':True,
        'tutorial_distribution_change_explicit':True,'audit_script_sha256':digest(__file__)}


def pair_summary(rows):
    return {'cases':len(rows),'runtime_complete':sum(r['runtime_complete']for r in rows),
        'pp_complete':sum(r['pp_complete']for r in rows),'runtime_arrived':sum(r['runtime_arrived']for r in rows),
        'pp_arrived':sum(r['pp_arrived']for r in rows),'trains':sum(r['trains']for r in rows),
        'runtime_lateness':sum(r['runtime_lateness']for r in rows),'pp_lateness':sum(r['pp_lateness']for r in rows),
        'lateness_better':sum(r['lateness_gap']<0 for r in rows),'lateness_equal':sum(r['lateness_gap']==0 for r in rows),
        'lateness_worse':sum(r['lateness_gap']>0 for r in rows),
        'sum_positive_lateness_gap':sum(max(0,r['lateness_gap'])for r in rows),
        'worst_lateness_gap':max(r['lateness_gap']for r in rows),
        'makespan_better':sum(r['makespan_gap']<0 for r in rows),'makespan_equal':sum(r['makespan_gap']==0 for r in rows),
        'makespan_worse':sum(r['makespan_gap']>0 for r in rows),'worst_makespan_gap':max(r['makespan_gap']for r in rows)}


def complete_audit(args):
    manifest,protocol,ia=inputs_audit()
    lock=read(args.lock);runtime=read(args.runtime);pp=read(args.pp)
    assert lock['reserved_confirmation_manifest_sha256']==EXPECTED_INPUT_SHA
    assert lock['input_freeze_protocol_sha256']==EXPECTED_PROTOCOL_SHA
    assert not lock['confirmation_outcomes_opened_at_selection']
    assert runtime['inputs']['case_manifest_sha256']==pp['manifest_sha256']==EXPECTED_INPUT_SHA
    assert runtime['source_commit']==lock['source_commit'] and runtime['source_worktree_dirty'] is False
    assert runtime['source_sha256']==lock['source_sha256']
    for rel,sha in lock['source_sha256'].items():
        assert hashlib.sha256(git_bytes(lock['source_commit'],'backend/'+rel)).hexdigest()==sha,rel
    assert runtime['inputs']['bundle_manifest_sha256']==lock['bundle_manifest_sha256']
    bundle_rel='backend/app/policies/learned/checkpoints/uc2_roam_specialists.json'
    bundle_bytes=git_bytes(lock['source_commit'],bundle_rel)
    assert hashlib.sha256(bundle_bytes).hexdigest()==lock['bundle_manifest_sha256']
    bundle=json.loads(bundle_bytes);assert bundle['selector']=='immutable_native_fixture_identity_only'
    assert bundle['guard']==lock['guard']=={'kind':'joint_roam','partial_moves':True,'max_candidates':60,'motion_logit_bias':0,'planner_fallback':False}
    assert bundle['models']==lock['models']
    assert runtime['inputs']['model_sha256']=={p:v['sha256']for p,v in lock['models'].items()}
    for preset,entry in lock['models'].items():
        rel='backend/app/policies/learned/checkpoints/'+entry['file']
        assert hashlib.sha256(git_bytes(lock['source_commit'],rel)).hexdigest()==entry['sha256']
    for preset,sha in runtime['inputs']['native_fixtures'].items():
        rel=f'backend/app/fixtures/plan-b/{preset}/scenario.pkl'
        assert hashlib.sha256(git_bytes(lock['source_commit'],rel)).hexdigest()==sha==protocol['fixture_sha256'][rel]
    known_path=args.known
    if known_path is None:
        expected=lock.get('known209_report_sha256')
        assert expected,'lock must identify its known209 validation report'
        matches=[p for p in HERE.glob('*.json')if digest(p)==expected]
        assert len(matches)==1,'supply --known when its report is outside this directory'
        known_path=matches[0]
    assert digest(known_path)==lock['known209_report_sha256']
    known=read(known_path);assert len(known['results'])==209
    cases={c['case_id']:c for c in manifest['cases']};rr={r['case_id']:r for r in runtime['results']};pr={r['case_id']:r for r in pp['results']}
    assert len(runtime['results'])==len(pp['results'])==len(rr)==len(pr)==100 and set(cases)==set(rr)==set(pr)
    rows=[];errors=[]
    for cid,case in cases.items():
        a,b=rr[cid],pr[cid];assert a['case']==b['case']==case
        assert a['horizon']==b['horizon']==HORIZONS[case['preset']]
        assert a['total']==b['total']==(2 if case['preset']=='tutorial'else 3)
        assert a['selected_infrastructure']==case['preset']
        assert a['checkpoint_sha256']==lock['models'][case['preset']]['sha256']
        assert a['checkpoint_file']==lock['models'][case['preset']]['file']
        assert a['motion_logit_bias']==0 and a['planner_interventions']==0
        assert a['policy']=='uc2_rl' and b['policy']=='pp-trainruns-replan'
        assert a['scheduled_incidents']==b['scheduled_incidents']==0
        if 'technical_error'in a or 'technical_error'in b:
            errors.append({'case_id':cid,'runtime':a.get('technical_error'),'pp':b.get('technical_error')})
        rows.append({'case_id':cid,'preset':case['preset'],'departure_offsets':list(key(case)[1]),
            'horizon':a['horizon'],'runtime_complete':a['complete_mission'],'pp_complete':b['complete_mission'],
            'runtime_arrived':a['arrived'],'pp_arrived':b['arrived'],'trains':a['total'],
            'runtime_lateness':a['lateness'],'pp_lateness':b['lateness'],'lateness_gap':a['lateness']-b['lateness'],
            'runtime_makespan':a['steps'],'pp_makespan':b['steps'],'makespan_gap':a['steps']-b['steps'],
            'selected_checkpoint_sha256':a['checkpoint_sha256'],
            'runtime_observed_native_fault_increases':len(a['observed_malfunction_counter_increases']),
            'pp_observed_native_fault_increases':len(b['observed_malfunction_counter_increases'])})
    counts={k:sum(r.get(k,0)for r in rr.values())for k in ['reference_disagreements','new_stuck_steps','uncertified_steps',
            'prediction_mismatches','prediction_mismatches_with_new_fault','resource_conflicts','withdrawals','planner_interventions']}
    failures=[r for r in rows if (r['pp_complete']and not r['runtime_complete'])or r['lateness_gap']>0]
    total=pair_summary(rows);assert total['trains']==280
    assert total['runtime_lateness']==runtime['summary']['uc2_rl']['lateness']
    assert total['pp_lateness']==pp['summary']['pp-trainruns-replan']['lateness']
    report={'schema':'uc2-confirmation100-v2-independent-audit-v1','audited_at_utc':datetime.now(timezone.utc).isoformat(),
        'candidate_frozen_at_utc':lock['frozen_at_utc'],'candidate_source_commit':lock['source_commit'],
        'identity_kind':'multi-model-bundle','candidate_bundle_manifest_sha256':lock['bundle_manifest_sha256'],
        'candidate_checkpoint_sha256':None,'model_sha256':runtime['inputs']['model_sha256'],
        'input_audit':ia,'source_git_model_fixture_prelock_hashes_verified':True,
        'file_sha256':{'lock':digest(args.lock),'runtime':digest(args.runtime),'pp':digest(args.pp),'known209':digest(known_path)},
        'summary':total,'by_preset':{p:pair_summary([r for r in rows if r['preset']==p])for p in HORIZONS},
        'runtime_audit_counters':counts,'technical_errors':errors,'primary_casewise_pp_gate_passed':not failures and not errors,
        'primary_gate_failures':failures,'records':rows,
        'first84_failed_result_retained':True,
        'distribution_scope':'UC2-1..4remain0..6; Tutorial0..9is a declared range extension with one coordinate>=7. Native schedules are unchanged but observed fault exposure may vary with offset/policy.',
        'limits':'Finite newly reserved timetable inputs on the same five maps. Lateness gate and makespan reported separately. Post-step audits warm caches; no universal or production-throughput guarantee.',
        'audit_script_sha256':digest(__file__)}
    publish(args.output,report)
    print(json.dumps({'artifact':args.output.name,'sha256':digest(args.output),'summary':total,'primary_gate_passed':report['primary_casewise_pp_gate_passed'],'failures':failures}))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs-only',action='store_true')
    parser.add_argument('--lock',type=Path,default=HERE/'candidate-lock-v2.json')
    parser.add_argument('--runtime',type=Path,default=HERE/'confirmation100-v2-runtime.json')
    parser.add_argument('--pp',type=Path,default=HERE/'confirmation100-v2-pp.json')
    parser.add_argument('--known',type=Path)
    parser.add_argument('--output',type=Path,default=HERE/'confirmation100-v2-independent-audit.json')
    args=parser.parse_args()
    if args.inputs_only:
        _,_,audit=inputs_audit();out=HERE/'confirmation100-v2-input-audit.json';publish(out,audit)
        print(json.dumps({'artifact':out.name,'sha256':digest(out),'old309_overlap':0,'dense_reserved_overlap':0,'new100_outcomes_read':False}))
    else:complete_audit(args)


if __name__=='__main__':main()
