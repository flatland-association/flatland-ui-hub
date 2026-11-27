/** Exact text commands; dictation remains an ordinary, explicitly submitted input. */
export type DispatcherTextCommand = 'pause' | 'resume' | 'approve' | 'decline' | 'takeover';

export interface DispatcherCommandContext {
  sessionId: string | null;
  proposal: { command_id: string; generation: number } | null;
}

export const DISPATCHER_COMMAND_ALIASES: Readonly<Record<DispatcherTextCommand, readonly string[]>> = {
  pause: ['pause', 'pause playback', 'pausieren', 'anhalten', 'mettre en pause'],
  resume: ['resume', 'continue', 'resume playback', 'weiter', 'fortsetzen', 'weiterfahren', 'reprendre', 'continuer'],
  approve: ['approve', 'approve proposal', 'accept proposal', 'freigeben', 'vorschlag freigeben', 'zustimmen', 'annehmen',
    'vorschlag annehmen', 'vorschlag bestätigen', 'vorschlag bestaetigen', 'bestätigen', 'bestaetigen',
    'approuver', 'approuver la proposition', 'accepter la proposition'],
  decline: ['decline', 'decline proposal', 'reject proposal', 'ablehnen', 'vorschlag ablehnen',
    'refuser', 'refuser la proposition', 'rejeter la proposition'],
  takeover: ['take over', 'take control', 'ich übernehme', 'ich uebernehme', 'übernehmen', 'uebernehmen',
    'kontrolle übernehmen', 'kontrolle uebernehmen', 'reprendre la main', 'je reprends la main', 'prendre le contrôle', 'prendre le controle'],
};

const COMMANDS = new Map<string, DispatcherTextCommand>(
  (Object.entries(DISPATCHER_COMMAND_ALIASES) as [DispatcherTextCommand, readonly string[]][])
    .flatMap(([command, aliases]) => aliases.map(alias => [alias, command] as const)),
);

export function parseDispatcherCommand(text: string): DispatcherTextCommand | null {
  const normalized = text.normalize('NFC').trim().toLowerCase().replace(/\s+/gu, ' ').replace(/\.$/u, '').trim();
  return COMMANDS.get(normalized) ?? null;
}
