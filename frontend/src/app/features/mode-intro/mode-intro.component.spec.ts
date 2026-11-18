import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ModeIntroComponent } from './mode-intro.component';
import { ScenarioCard } from '../../core/demo/tour-context.service';
import { UiConfigService } from '../../core/config/ui-config.service';

describe('ModeIntroComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModeIntroComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  function render(card: ScenarioCard | null, step: string | null = null): HTMLElement {
    const fixture = TestBed.createComponent(ModeIntroComponent);
    fixture.componentRef.setInput('replayScenarioCard', card);
    fixture.componentRef.setInput('replayStep', step);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the mode sections without a scenario card', () => {
    const el = render(null);
    expect(el.querySelectorAll('.intro-section').length).toBe(6);
    expect(el.querySelector('.intro-scenario')).toBeNull();
  });

  it('shows an experiment scenario as title, paragraphs and image, without the mode sections', () => {
    const el = render({ title: 'Störung am Einspurabschnitt', paragraphs: ['Erster.', 'Zweiter.'], imageUrl: '/img.png', videoUrl: null });
    expect(el.querySelector('.intro-title')?.textContent).toContain('Störung am Einspurabschnitt');
    expect([...el.querySelectorAll('.intro-scenario__text p')].map((p) => p.textContent)).toEqual(['Erster.', 'Zweiter.']);
    expect(el.querySelector<HTMLImageElement>('.intro-scenario__image')?.getAttribute('src')).toBe('/img.png');
    expect(el.querySelectorAll('.intro-section').length).toBe(0);
    expect(el.querySelector('.intro-wp')).toBeNull();
    // The start button stays.
    expect(el.querySelector('.intro-actions sbb-button')).not.toBeNull();
  });

  // docs/plans/hide-scenario-bar.md §4.3: the scenario's title is its name.
  it('leaves the title out where the condition hides the scenarios\' names', () => {
    TestBed.inject(UiConfigService).apply({ hidden: ['control.legNames'] });
    const el = render({ title: 'Türstörung', paragraphs: ['P'], imageUrl: '/img.png' }, 'Szenario 4/5');
    expect(el.querySelector('.intro-title')).toBeNull();
    expect(el.textContent).not.toContain('Türstörung');
    // The image keeps a text for screen readers: the step, not the name.
    expect(el.querySelector('.intro-scenario__image')?.getAttribute('alt')).toBe('Szenario 4/5');
    expect(el.querySelector('.intro-scenario__text p')?.textContent).toBe('P');
  });

  it('leaves the image out when the scenario has none', () => {
    const el = render({ title: 'T', paragraphs: ['P'], imageUrl: null, videoUrl: null });
    expect(el.querySelector('.intro-scenario__image')).toBeNull();
    expect(el.querySelector('.intro-scenario__video')).toBeNull();
  });

  it('shows the video below the text, with the player\'s controls', () => {
    const el = render({ title: 'T', paragraphs: ['P'], imageUrl: null, videoUrl: '/intro.mp4' });
    const video = el.querySelector<HTMLVideoElement>('.intro-scenario__video')!;
    expect(video.getAttribute('src')).toBe('/intro.mp4');
    expect(video.controls).toBeTrue();
    // After the text block, not beside it in the text/image grid.
    expect(video.parentElement?.classList.contains('intro-scenario')).toBeFalse();
    expect(el.querySelector('.intro-scenario')!.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
