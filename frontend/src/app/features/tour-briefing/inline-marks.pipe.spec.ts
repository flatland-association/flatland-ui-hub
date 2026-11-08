import { inlineMarks } from './inline-marks.pipe';

describe('inlineMarks', () => {
  it('leaves plain text as one part', () => {
    expect(inlineMarks('Weiter')).toEqual([{ text: 'Weiter', bold: false, underline: false }]);
  });

  it('marks bold and underlined runs, and both when nested', () => {
    expect(inlineMarks('**Dein Ziel**: Halte die __Verspätungen **gering**__.')).toEqual([
      { text: 'Dein Ziel', bold: true, underline: false },
      { text: ': Halte die ', bold: false, underline: false },
      { text: 'Verspätungen ', bold: false, underline: true },
      { text: 'gering', bold: true, underline: true },
      { text: '.', bold: false, underline: false },
    ]);
  });

  it('keeps markup-looking text as text', () => {
    expect(inlineMarks('<b>x</b>')).toEqual([{ text: '<b>x</b>', bold: false, underline: false }]);
  });
});
