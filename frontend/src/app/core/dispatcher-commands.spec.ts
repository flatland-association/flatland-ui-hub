import { DispatcherTextCommand, parseDispatcherCommand } from './dispatcher-commands';

describe('dispatcher text command parser', () => {
  const commands: [string, DispatcherTextCommand][] = [
    ['Pause', 'pause'], ['Weiter', 'resume'], ['Freigeben', 'approve'], ['Ablehnen', 'decline'], ['Ich übernehme', 'takeover'],
    ['pause', 'pause'], ['resume', 'resume'], ['approve proposal', 'approve'], ['decline proposal', 'decline'], ['take over', 'takeover'],
    ['mettre en pause', 'pause'], ['reprendre', 'resume'], ['approuver la proposition', 'approve'],
    ['refuser la proposition', 'decline'], ['reprendre la main', 'takeover'],
    ['Vorschlag freigeben', 'approve'], ['Je reprends la main', 'takeover'],
  ];
  for (const [text, command] of commands) {
    it(`recognises the exact command ${text}`, () => expect(parseDispatcherCommand(text)).toBe(command));
  }

  it('normalises casing, whitespace and a sentence-final full stop', () => {
    expect(parseDispatcherCommand('  APPROVE\n   PROPOSAL.  ')).toBe('approve');
    expect(parseDispatcherCommand(' Ich U\u0308BERNEHME. ')).toBe('takeover');
  });

  for (const text of ['', '  ', 'do not pause', 'nicht freigeben', 'nicht weiter', 'ne pas reprendre',
    "don't approve proposal", 'pause and resume', 'Pause. Weiter.', 'approve proposal; take over',
    'pause please', 'pause...', 'paused', 'resume!', 'take over train 3']) {
    it(`rejects unknown, negated or combined input ${JSON.stringify(text)}`, () => {
      expect(parseDispatcherCommand(text)).toBeNull();
    });
  }
});
