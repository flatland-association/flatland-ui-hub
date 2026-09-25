import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { SessionStore } from '../session.store';

/**
 * The wiring, not the arithmetic — `layer-mode-defaults.spec.ts` covers the pure
 * resolution. This asserts that the store actually hangs `layerVisibility` off the
 * mode, since the whole point is that switching to Director changes the picture.
 */
describe('SessionStore.layerVisibility — mode defaults and operator choice', () => {
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
  });

  it('starts Recommendation with the per-train layers on', () => {
    expect(store.interactionMode()).toBe('recommendation');
    expect(store.layerVisibility().nextDecisions).toBeTrue();
    expect(store.layerVisibility().agentTrajectory).toBeTrue();
  });

  it('drops them when the mode becomes Director, without anyone writing the layers', () => {
    store.interactionMode.set('director');
    expect(store.layerVisibility().nextDecisions).toBeFalse();
    expect(store.layerVisibility().agentTrajectory).toBeFalse();
    expect(store.layerVisibility().grid).toBeTrue();
    expect(store.layerVisibility().contentions).toBeTrue();
  });

  it('keeps an explicit toggle across a mode switch', () => {
    store.setLayerVisible('switches', true);
    store.interactionMode.set('director');
    expect(store.layerVisibility().switches).toBeTrue();
    expect(store.overriddenLayers()).toEqual(['switches']);
  });

  it('lets the operator bring a layer back that the mode switched off', () => {
    store.interactionMode.set('director');
    store.setLayerVisible('nextDecisions', true);
    expect(store.layerVisibility().nextDecisions).toBeTrue();
    expect(store.overriddenLayers()).toEqual(['nextDecisions']);
  });

  it('returns to the mode set on reset', () => {
    store.interactionMode.set('director');
    store.setLayerVisible('nextDecisions', true);
    store.resetLayersToModeDefaults();
    expect(store.layerVisibility().nextDecisions).toBeFalse();
    expect(store.overriddenLayers()).toEqual([]);
  });
});
