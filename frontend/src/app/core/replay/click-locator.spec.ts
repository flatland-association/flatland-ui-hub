import { TestBed } from '@angular/core/testing';
import type { ClickEvent } from '../interaction-log/click-log.service';
import { ClickLocator, targetElement } from './click-locator';

describe('ClickLocator', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `
      <section data-panel-type="decision-log"><button data-log="decisionLog.undo">Undo</button></section>
      <section data-panel-type="scenario"><button data-log="decisionLog.undo">Other</button><button id="go">Go</button><button id="sbb-x-4">Gen</button></section>
      <div class="q"><button>1</button><button>2</button></div><div class="q"><button>1</button><button>2</button></div>
      <app-mode-intro><div><sbb-button>Start</sbb-button><sbb-transparent-button>Exit</sbb-transparent-button></div>
        <p><sbb-title>A</sbb-title><sbb-title>B</sbb-title></p></app-mode-intro>
    `;
    document.body.appendChild(root);
  });
  afterEach(() => root.remove());

  const click = (target: string, panel: string | null = null, view: string | null = null) =>
    ({ seq: 1, t: 0, simStep: 0, mode: 'co-learning', target, panel, view }) as ClickEvent;

  it('finds the target by click id inside its panel, by element id, and by tag and index inside the drawn screen', () => {
    expect(targetElement(click('decisionLog.undo', 'scenario'), root)?.textContent).toBe('Other');
    expect(targetElement(click('decisionLog.undo'), root)?.textContent).toBe('Undo');
    expect(targetElement(click('#go'), root)?.textContent).toBe('Go');
    expect(targetElement(click('sbb-title[1]', null, 'mode_intro'), root)?.textContent).toBe('B');
    expect(targetElement(click('sbb-button', null, 'mode_intro'), root)?.textContent).toBe('Start');
    expect(targetElement(click('nothing.here'), root)).toBeNull();
    // Ambiguous (a rating button in every row) or a generated id: left out.
    expect(targetElement(click('button[1]'), root)).toBeNull();
    expect(targetElement(click('#sbb-x-4'), root)).toBeNull();
  });

  it('asks the registered locators for a map or chart position first, and forgets one on unregister', () => {
    const locator = TestBed.inject(ClickLocator);
    const off = locator.register(({ at }) => (at && 'row' in at ? { x: at.col * 10, y: at.row * 10 } : null));
    const onMap = { ...click('sbb-button'), at: { row: 2, col: 3 } };
    expect(locator.locate(onMap, root)).toEqual({ x: 30, y: 20 });
    off();
    // Without a locator it falls back to the target element.
    expect(locator.locate(onMap, root)).not.toEqual({ x: 30, y: 20 });
  });
});
