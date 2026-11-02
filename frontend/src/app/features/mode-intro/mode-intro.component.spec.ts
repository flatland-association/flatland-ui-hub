import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ModeIntroComponent } from './mode-intro.component';
import { ScenarioCard } from '../../core/demo/tour-context.service';

describe('ModeIntroComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModeIntroComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  function render(card: ScenarioCard | null): HTMLElement {
    const fixture = TestBed.createComponent(ModeIntroComponent);
    fixture.componentRef.setInput('replayScenarioCard', card);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the mode sections without a scenario card', () => {
    const el = render(null);
    expect(el.querySelectorAll('.intro-section').length).toBe(6);
    expect(el.querySelector('.intro-scenario')).toBeNull();
  });

  it('shows an experiment scenario as title, paragraphs and image, without the mode sections', () => {
    const el = render({ title: 'Störung am Einspurabschnitt', paragraphs: ['Erster.', 'Zweiter.'], imageUrl: '/img.png' });
    expect(el.querySelector('.intro-title')?.textContent).toContain('Störung am Einspurabschnitt');
    expect([...el.querySelectorAll('.intro-scenario__text p')].map((p) => p.textContent)).toEqual(['Erster.', 'Zweiter.']);
    expect(el.querySelector<HTMLImageElement>('.intro-scenario__image')?.getAttribute('src')).toBe('/img.png');
    expect(el.querySelectorAll('.intro-section').length).toBe(0);
    expect(el.querySelector('.intro-wp')).toBeNull();
    // The start button stays.
    expect(el.querySelector('.intro-actions sbb-button')).not.toBeNull();
  });

  it('leaves the image out when the scenario has none', () => {
    const el = render({ title: 'T', paragraphs: ['P'], imageUrl: null });
    expect(el.querySelector('.intro-scenario__image')).toBeNull();
  });
});
