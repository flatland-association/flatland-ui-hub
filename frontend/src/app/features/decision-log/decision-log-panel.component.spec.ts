import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UiConfigService } from '../../core/config/ui-config.service';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { DecisionLogPanelComponent } from './decision-log-panel.component';

/**
 * `collapsedByDefault` seeds the panel's own `collapsed` signal, so it has to
 * be applied *before* the component is created — which is how it runs in the
 * app too (the config arrives with the layout, the panel is built after).
 */
function createWith(config: Parameters<UiConfigService['apply']>[0]) {
  TestBed.configureTestingModule({
    imports: [DecisionLogPanelComponent],
    providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
  });
  TestBed.inject(UiConfigService).apply(config);
  const fixture = TestBed.createComponent(DecisionLogPanelComponent);
  fixture.componentInstance.embedded = true;
  fixture.detectChanges();
  return fixture;
}

describe('DecisionLogPanelComponent — collapsed by default', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts open when nothing is configured', () => {
    const fixture = createWith({});
    expect(fixture.componentInstance.collapsed()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.dl-summary')).toBeTruthy();
  });

  it('starts closed when the id is listed under collapsedByDefault', () => {
    const fixture = createWith({ collapsedByDefault: ['widget.decision-log'] });
    expect(fixture.componentInstance.collapsed()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.dl-summary')).toBeFalsy();
  });

  // The point of collapsing rather than hiding: the participant still sees
  // that decisions are being recorded (§1.1 item 2).
  it('keeps its header and entry count visible while collapsed', () => {
    const fixture = createWith({ collapsedByDefault: ['widget.decision-log'] });
    expect(fixture.nativeElement.querySelector('.dl-panel-head')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.dl-count')).toBeTruthy();
  });

  it('is a default, not a lock — the participant can still open it', () => {
    const fixture = createWith({ collapsedByDefault: ['widget.decision-log'] });
    fixture.componentInstance.toggleCollapsed();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.dl-summary')).toBeTruthy();
  });
});
