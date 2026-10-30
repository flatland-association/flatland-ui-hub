import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiConfigService } from '../../core/config/ui-config.service';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { TourGuideComponent } from './tour-guide.component';

/**
 * The tour strip is where "Schicht beenden" actually lives for a Co-Learning
 * condition: `director-directive` carries the other copy, but it is
 * director-only, so a Plan B run never renders it. The strip is also app-shell
 * chrome — no layout places it — which is why hiding the button needs
 * `control.endShift` rather than anything a preset's columns could express
 * (docs/plans/configurable-ui-plan.md §1.1 item 4).
 */
describe('TourGuideComponent — the end-shift button', () => {
  let fixture: ComponentFixture<TourGuideComponent>;
  let uiConfig: UiConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TourGuideComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(TourGuideComponent);
    uiConfig = TestBed.inject(UiConfigService);
  });

  const endButton = () => {
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.tour-guide__end');
  };

  it('is offered by default', () => {
    expect(endButton()).not.toBeNull();
  });

  it('is gone once control.endShift is hidden', () => {
    uiConfig.apply({ hidden: ['control.endShift'] });
    expect(endButton()).toBeNull();
  });

  it('comes back when the restriction is dropped', () => {
    uiConfig.apply({ hidden: ['control.endShift'] });
    expect(endButton()).toBeNull();
    uiConfig.apply({});
    expect(endButton()).not.toBeNull();
  });

  it('leaves the rest of the strip alone', () => {
    uiConfig.apply({ hidden: ['control.endShift'] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tour-guide')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.tour-guide__hint')).not.toBeNull();
  });
});
