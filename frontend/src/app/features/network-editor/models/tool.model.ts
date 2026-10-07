export type NetworkEditorTool =
  | 'select'
  | 'track'
  | 'erase'
  | 'switch'
  | 'station'
  | 'agent-route'
  | 'agent-start'
  | 'agent-target'
  | 'random-agents';

export interface NetworkEditorToolDefinition {
  id: NetworkEditorTool;
}

export const MVP_TOOLS: NetworkEditorToolDefinition[] = [
  { id: 'select' },
  { id: 'track' },
  { id: 'erase' },
  { id: 'switch' },
  { id: 'station' },
  { id: 'agent-route' },
  { id: 'random-agents' },
];
