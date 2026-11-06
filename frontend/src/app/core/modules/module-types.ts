export type ModuleId =
  | 'notifications'
  | 'layer-toggles'
  | 'agents-list'
  | 'track-layout'
  | 'graphic-timetable'
  | 'scenario-panel'
  | 'kpi-filter'
  | 'recommendations'
  | 'inspector';

export type ModulePosition = 'left' | 'middle' | 'right';

export interface ModuleState {
  visible: boolean;
  enabled: boolean;
  position: ModulePosition;
  title: string;
}
