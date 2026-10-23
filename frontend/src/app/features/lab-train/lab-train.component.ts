import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiService } from '../../core/api.service';
import { LabTrainingCheckRow, LabTrainingJob, LabTrainingStatus } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { LanguageService } from '../../core/i18n/language.service';
import { TrainIdentityService } from '../../core/train-identity.service';
import { TourContextService } from '../../core/demo/tour-context.service';
import { TourGuideService } from '../../core/demo/tour-guide.service';
import { AiTrackRecordComponent } from '../ai-track-record/ai-track-record.component';

const POLL_MS = 500;

/** The command-line route where the server cannot train — commands, not copy. */
const CLI = [
  'cd backend',
  'python -m lab.marl.finetune_interventions --name corrected --kl-weight 3',
  'python -m lab.marl.evaluate --checkpoint lab/checkpoints/corrected.pt',
].join('\n');

/**
 * "Train the AI" — the MARL lab tour's debrief section (docs/plans/marl-lab-tour.md,
 * variant A). After the leg in which the person stepped in:
 *
 *   what happened (the AI Track Record: with you against AI alone)
 *   → your interventions (train, the AI's pick, yours)
 *   → one knob, "how much should the AI stay as it was?" (KL weight)
 *   → train (seconds) and the short check: your model alone against the one
 *     it started from, on this scenario and two it never saw.
 *
 * Every run is kept and named; the one marked is what the next leg drives
 * under (`TourContextService.trainedPolicyId`, `Tour.legPolicies`). Where the
 * backend cannot train (switched off, no torch, read-only disk) the section
 * says why and shows the command-line route instead.
 */
@Component({
  selector: 'app-lab-train',
  standalone: true,
  imports: [AiTrackRecordComponent, TranslocoPipe],
  templateUrl: './lab-train.component.html',
  styleUrl: './lab-train.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class LabTrainComponent {
  readonly store = inject(SessionStore);
  private readonly api = inject(ApiService);
  private readonly i18n = inject(LanguageService);
  private readonly identity = inject(TrainIdentityService);
  private readonly tour = inject(TourContextService);
  private readonly guide = inject(TourGuideService);

  readonly cli = CLI;
  readonly status = signal<LabTrainingStatus | null>(null);
  readonly loadError = signal(false);
  readonly jobs = signal<LabTrainingJob[]>([]);
  readonly klWeight = signal(3);
  readonly startError = signal<string | null>(null);

  readonly running = computed(() => this.jobs().some((j) => j.state === 'running'));
  readonly selectedPolicy = this.tour.trainedPolicyId;
  /** Newest first: the run just made is the one read first. */
  readonly jobsNewestFirst = computed(() => [...this.jobs()].reverse());

  /** The single place this section branches on mode: how stepping in is named. */
  readonly modeKey = computed(() => {
    switch (this.store.interactionMode()) {
      case 'recommendation':
        return 'recommendation';
      case 'co-learning':
        return 'coLearning';
      case 'director':
        return 'director';
    }
  });

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopPolling());
    const sid = this.store.session()?.id;
    if (!sid) return;
    this.api.getLabTraining(sid).subscribe({
      next: (s) => {
        this.status.set(s);
        this.klWeight.set(s.defaultKlWeight);
        this.jobs.set(s.jobs);
        if (s.jobs.some((j) => j.state === 'running')) this.schedulePoll();
      },
      error: () => this.loadError.set(true),
    });
  }

  knobKey(weight: number): string {
    const weights = this.status()?.klWeights ?? [1, 3, 10];
    const i = weights.indexOf(weight);
    return `lab.train.knob.${['little', 'medium', 'lot'][i] ?? 'medium'}`;
  }

  setKnob(value: unknown): void {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) this.klWeight.set(n);
  }

  train(): void {
    const sid = this.store.session()?.id;
    if (!sid || this.running()) return;
    this.startError.set(null);
    this.api.startLabTraining(sid, this.klWeight()).subscribe({
      next: (job) => {
        this.jobs.update((list) => [...list, job]);
        this.schedulePoll();
      },
      error: (e) => this.startError.set(String(e?.error?.detail ?? 'request')),
    });
  }

  private schedulePoll(): void {
    this.stopPolling();
    this.pollTimer = setTimeout(() => this.poll(), POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private poll(): void {
    const job = this.jobs().find((j) => j.state === 'running');
    if (!job) return;
    this.api.getLabTrainingJob(job.jobId).subscribe({
      next: (fresh) => {
        this.jobs.update((list) => list.map((j) => (j.jobId === fresh.jobId ? fresh : j)));
        if (fresh.state === 'running') {
          this.schedulePoll();
        } else if (fresh.state === 'done') {
          this.finished(fresh);
        }
      },
      error: () => this.schedulePoll(),
    });
  }

  private finished(job: LabTrainingJob): void {
    // The new checkpoint is a new policy: the catalog has to know it before
    // the next leg runs under it (activePolicyIsLearned reads the catalog).
    this.store.loadPolicies();
    this.tour.trainedPolicyId.set(job.policyId);
    this.guide.markDone('train');
  }

  use(job: LabTrainingJob): void {
    if (job.state === 'done') this.tour.trainedPolicyId.set(job.policyId);
  }

  trainName(handle: number): string {
    return this.identity.nameFor(handle);
  }

  actionLabel(action: number): string {
    return this.i18n.t(`lab.action.${action}`);
  }

  scenarioLabel(row: LabTrainingCheckRow): string {
    return this.i18n.t(`lab.train.scenario.${row.scenario}`, undefined, row.scenario);
  }

  percent(value: number | null | undefined): number {
    return Math.round((value ?? 0) * 100);
  }

  /** Better, worse or the same, by arrivals first, then delay. */
  verdict(row: LabTrainingCheckRow): 'better' | 'worse' | 'same' | null {
    if (!row.base || !row.trained) return null;
    const d = row.trained.arrived - row.base.arrived || row.base.delay - row.trained.delay;
    return d > 0 ? 'better' : d < 0 ? 'worse' : 'same';
  }

  /** Arrivals over all checked scenarios, for the run's one-line summary. */
  totals(job: LabTrainingJob): { base: number; trained: number; trains: number } {
    return job.check.reduce(
      (t, r) => ({
        base: t.base + (r.base?.arrived ?? 0),
        trained: t.trained + (r.trained?.arrived ?? 0),
        trains: t.trains + (r.base && r.trained ? (r.trains ?? 0) : 0),
      }),
      { base: 0, trained: 0, trains: 0 },
    );
  }
}
