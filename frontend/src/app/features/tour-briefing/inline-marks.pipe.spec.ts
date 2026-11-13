import { inlineMarks } from './inline-marks.pipe';

describe('inlineMarks', () => {
  it('leaves plain text as one part', () => {
    expect(inlineMarks('Weiter')).toEqual([{ text: 'Weiter', bold: false, emphasis: false }]);
  });

  it('marks bold and emphasised runs, and both when nested', () => {
    expect(inlineMarks('**Dein Ziel**: Halte die __Verspätungen **gering**__.')).toEqual([
      { text: 'Dein Ziel', bold: true, emphasis: false },
      { text: ': Halte die ', bold: false, emphasis: false },
      { text: 'Verspätungen ', bold: false, emphasis: true },
      { text: 'gering', bold: true, emphasis: true },
      { text: '.', bold: false, emphasis: false },
    ]);
  });

  it('keeps markup-looking text as text', () => {
    expect(inlineMarks('<b>x</b>')).toEqual([{ text: '<b>x</b>', bold: false, emphasis: false }]);
  });
});
