export type InfrastructureBuilderTool =
  | 'select'
  | 'track'
  | 'erase'
  | 'switch'
  | 'station'
  | 'agent-route'
  | 'agent-start'
  | 'agent-target'
  | 'random-agents';

export interface InfrastructureBuilderToolDefinition {
  id: InfrastructureBuilderTool;
}

export const MVP_TOOLS: InfrastructureBuilderToolDefinition[] = [
  { id: 'select' },
  { id: 'track' },
  { id: 'erase' },
  { id: 'switch' },
  { id: 'station' },
  { id: 'agent-route' },
  { id: 'random-agents' },
];
