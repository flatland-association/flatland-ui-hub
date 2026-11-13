import { Injectable, signal } from '@angular/core';

/** One request to open or close the frames of a panel type. */
export interface PanelFrameRequest {
  type: string;
  open: boolean;
  /** Counts up, so the same request twice is still a change. */
  n: number;
}

/**
 * Opens or closes the frame of a panel in the layout from outside the panel:
 * «Handlungsoptionen» closes once a course is taken and opens when new options
 * come up (docs/plans/reflection-inline.md §4.8, D25). A closed frame drops its
 * content, so the panel cannot open itself again; every `PanelShellComponent`
 * follows the requests for its panel type instead.
 */
@Injectable({ providedIn: 'root' })
export class PanelFrameService {
  private readonly _request = signal<PanelFrameRequest | null>(null);
  readonly request = this._request.asReadonly();

  setExpanded(type: string, open: boolean): void {
    this._request.update((r) => ({ type, open, n: (r?.n ?? 0) + 1 }));
  }
}
