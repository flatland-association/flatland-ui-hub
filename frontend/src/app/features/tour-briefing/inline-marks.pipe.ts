import { Pipe, PipeTransform } from '@angular/core';

/** One run of briefing text with its marks. */
export interface MarkedPart {
  text: string;
  bold: boolean;
  emphasis: boolean;
}

/**
 * The two inline marks a briefing text may carry: `**bold**` and `__emphasis__`
 * (italics, `<em>`, as in the `<strong>`/`<em>` of the translations)
 * (they may nest). Rendered as elements by the template, never as HTML, so a
 * briefing text cannot inject markup. An unclosed mark runs to the end.
 */
export function inlineMarks(text: string): MarkedPart[] {
  const parts: MarkedPart[] = [];
  let bold = false;
  let emphasis = false;
  for (const token of text.split(/(\*\*|__)/)) {
    if (token === '**') bold = !bold;
    else if (token === '__') emphasis = !emphasis;
    else if (token) parts.push({ text: token, bold, emphasis });
  }
  return parts;
}

@Pipe({ name: 'inlineMarks', standalone: true })
export class InlineMarksPipe implements PipeTransform {
  transform(text: string): MarkedPart[] {
    return inlineMarks(text);
  }
}
