import { InjectionToken } from '@angular/core';

/**
 * The frame around a panel in a layout, for a panel that opens or closes
 * itself: «Handlungsoptionen» closes once a course is taken and opens when
 * new options come up (docs/plans/reflection-inline.md §4.8, D25). Provided
 * by `PanelShellComponent`; absent outside a layout. A token, not the shell
 * itself, because the shell imports the panels.
 */
export interface PanelFrame {
  setExpanded(open: boolean): void;
}

export const PANEL_FRAME = new InjectionToken<PanelFrame>('PANEL_FRAME');
