import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiService } from '../../core/api.service';
import { SessionStore } from '../../core/session.store';
import { LanguageService } from '../../core/i18n/language.service';
import { TrainIdentityService } from '../../core/train-identity.service';
import {
  SandboxCheckpoint,
  SandboxItem,
  SandboxOption,
  SandboxOutcome,
  SandboxRunResult,
  SandboxState,
} from '../../core/demo/sandbox-replay';

/** A played variant, kept until the person removes it. */
interface SandboxTry {
  key: string;
  result: SandboxRunResult;
}

/** At most this many variants side by side; the oldest goes first. */
const MAX_TRIES = 6;

/**
 * Event Simulation, playable (thesis flow step 8): the decision moment of the
 * shift, kept as a checkpoint when the conflict surfaced, played again with
 * another option — hold until a chosen step, hold without release, proceed,
 * reroute — each to the end of the episode, next to the run as it was played.
 *
 * The debrief shows it instead of the precomputed cards when the tour's briefing
 * asks for it (`TourBriefing.sandbox: 'live'`). Backend: `app/api/sandbox.py`.
 * Plan: docs/plans/colearning-advanced-tour.md (WP1).
 */
@Component({
  selector: 'app-sandbox-replay',
  standalone: true,
  imports: [NgTemplateOutlet, TranslocoPipe],
  templateUrl: './sandbox-replay.component.html',
  styleUrl: './sandbox-replay.component.scss',
})
export class SandboxReplayComponent {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly i18n = inject(LanguageService);
  private readonly identity = inject(TrainIdentityService);

  readonly state = signal<SandboxState | null>(null);
  readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');

  readonly checkpointId = signal<number>(0);
  readonly handle = signal<number | null>(null);
  readonly option = signal<SandboxOption>('hold_until');
  /** Absolute step at which a `hold_until` releases the train. */
  readonly releaseStep = signal<number>(0);

  readonly running = signal(false);
  readonly runError = signal(false);
  readonly tries = signal<SandboxTry[]>([]);

  readonly checkpoint = computed<SandboxCheckpoint | null>(
    () => this.state()?.checkpoints.find((c) => c.id === this.checkpointId()) ?? null,
  );
  readonly item = computed<SandboxItem | null>(
    () => this.checkpoint()?.items.find((i) => i.handle === this.handle()) ?? null,
  );
  readonly options = computed<SandboxOption[]>(() => {
    const base: SandboxOption[] = ['hold_until', 'hold', 'proceed'];
    return this.item()?.can_reroute ? [...base, 'reroute'] : base;
  });
  /** Earliest release is one step after the checkpoint; the range runs well past the block. */
  readonly releaseMin = computed(() => (this.checkpoint()?.step ?? 0) + 1);
  readonly releaseMax = computed(() => (this.checkpoint()?.step ?? 0) + Math.max(10, (this.item()?.clears_in_steps ?? 0) * 2));
  readonly clearStep = computed(() => {
    const cp = this.checkpoint();
    const it = this.item();
    return cp && it ? cp.step + it.clears_in_steps : null;
  });

  constructor() {
    this.load();
  }

  load(): void {
    const sid = this.store.session()?.id;
    if (!sid) {
      this.loadState.set('error');
      return;
    }
    this.loadState.set('loading');
    this.api.getSandbox(sid).subscribe({
      next: (s) => {
        // Test cases belong to the rule check, not to replaying the shift.
        this.state.set({ ...s, checkpoints: s.checkpoints.filter((c) => c.kind !== 'test') });
        const first = s.checkpoints[0];
        if (first) this.selectCheckpoint(first.id);
        this.loadState.set('ready');
      },
      error: () => this.loadState.set('error'),
    });
  }

  selectCheckpoint(id: number): void {
    this.checkpointId.set(id);
    const cp = this.checkpoint();
    const first = cp?.items[0] ?? null;
    this.selectTrain(first?.handle ?? null);
  }

  selectTrain(handle: number | null): void {
    this.handle.set(handle);
    if (!this.options().includes(this.option())) this.option.set('hold_until');
    this.releaseStep.set(this.clearStep() ?? this.releaseMin());
  }

  setRelease(value: string): void {
    const n = Math.round(Number(value));
    if (Number.isFinite(n)) this.releaseStep.set(Math.min(this.releaseMax(), Math.max(this.releaseMin(), n)));
  }

  play(): void {
    const sid = this.store.session()?.id;
    const cp = this.checkpoint();
    const handle = this.handle();
    if (!sid || !cp || handle == null || this.running()) return;
    const option = this.option();
    const releaseAfter = option === 'hold_until' ? this.releaseStep() - cp.step : undefined;
    const key = `${cp.id}:${handle}:${option}:${releaseAfter ?? ''}`;
    if (this.tries().some((t) => t.key === key)) return;

    this.running.set(true);
    this.runError.set(false);
    this.api
      .runSandbox(sid, { checkpoint: cp.id, handle, option, release_after: releaseAfter })
      .subscribe({
        next: (result) => {
          this.tries.update((list) => [...list, { key, result }].slice(-MAX_TRIES));
          this.running.set(false);
        },
        error: () => {
          this.runError.set(true);
          this.running.set(false);
        },
      });
  }

  remove(key: string): void {
    this.tries.update((list) => list.filter((t) => t.key !== key));
  }

  trainName(handle: number | null): string {
    return handle == null ? '' : this.identity.nameFor(handle);
  }

  situation(): string {
    const cp = this.checkpoint();
    const it = this.item();
    if (!cp || !it) return '';
    const params = {
      step: cp.step,
      affected: this.trainName(it.handle),
      blocker: this.trainName(it.blocked_by),
      clears: it.clears_in_steps,
    };
    return this.i18n.t(
      it.blocked_by == null ? 'tourUi.sandboxReplay.situationNoBlocker' : 'tourUi.sandboxReplay.situation',
      params,
    );
  }

  tryLabel(r: SandboxRunResult): string {
    return this.i18n.t(`tourUi.sandboxReplay.tryLabel.${r.option}`, {
      train: this.trainName(r.handle),
      release: r.release_step ?? '',
    });
  }

  /** Compared with the played run only when the same trains arrive; otherwise a
   *  delay sum over fewer trains would read as the better outcome. */
  vsPlayed(o: SandboxOutcome): string {
    const played = this.state()?.played;
    if (!played) return '';
    if (o.arrived !== played.arrived) return this.i18n.t('tourUi.sandboxReplay.vsPlayed.notComparable');
    const diff = o.totalDelayVsPlan - played.totalDelayVsPlan;
    if (diff === 0) return this.i18n.t('tourUi.sandboxReplay.vsPlayed.same');
    return this.i18n.t(diff < 0 ? 'tourUi.sandboxReplay.vsPlayed.better' : 'tourUi.sandboxReplay.vsPlayed.worse', {
      n: Math.abs(diff),
    });
  }

  vsPlayedTone(o: SandboxOutcome): 'better' | 'worse' | 'neutral' {
    const played = this.state()?.played;
    if (!played) return 'neutral';
    if (o.arrived !== played.arrived) return o.arrived > played.arrived ? 'better' : 'worse';
    const diff = o.totalDelayVsPlan - played.totalDelayVsPlan;
    return diff < 0 ? 'better' : diff > 0 ? 'worse' : 'neutral';
  }
}
