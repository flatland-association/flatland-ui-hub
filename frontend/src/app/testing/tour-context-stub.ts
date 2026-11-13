import { Provider } from '@angular/core';
import { TourContextService } from '../core/demo/tour-context.service';
import { SessionStore } from '../core/session.store';

/**
 * The tour context for component specs: whether the tour asks for reasons,
 * and the finish gate that follows from it (as `TourContextService.refuseFinish`).
 * No briefing and no session preset, so nothing else of a tour or a scenario applies.
 */
export function provideTourContextStub(reasonDialog: boolean): Provider {
  return {
    provide: TourContextService,
    useFactory: (store: SessionStore) => ({
      reasonDialog: () => reasonDialog,
      briefing: () => null,
      sessionPreset: () => null,
      refuseFinish: () => reasonDialog && store.refuseFinishForOpenReflections(),
    }),
    deps: [SessionStore],
  };
}
