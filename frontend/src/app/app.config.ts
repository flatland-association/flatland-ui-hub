import {
  ApplicationConfig,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  isDevMode,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { TranslocoService, provideTransloco } from '@jsverse/transloco';
import { firstValueFrom, forkJoin } from 'rxjs';
import { UiConfigService } from './core/config/ui-config.service';
import { callLogInterceptor } from './core/interaction-log/call-log.interceptor';
import { replayHttpInterceptor } from './core/replay/replay-http.interceptor';
import { initialLang } from './core/i18n/language.service';
import { TranslocoHttpLoader } from './core/i18n/transloco-loader';
import { applyBrandTheme, initialBrandTheme } from './core/theme/brand-theme.service';
import { applyColorScheme, initialColorScheme } from './core/theme/color-scheme.service';
import { ProposalChoiceService } from './core/proposals/proposal-choice.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // Every backend call into the study log's `calls` stream, with the
    // correlation headers for the server log (experiment-logging plan §5.1.1).
    provideHttpClient(withFetch(), withInterceptors([replayHttpInterceptor, callLogInterceptor])),
    // i18n (docs/plans/i18n-strategy.md): English source, German and French
    // translations, English as the fallback. `logMissingKey` stays off because
    // partial coverage is intended — not every page exists in every language.
    provideTransloco({
      config: {
        availableLangs: ['en', 'de', 'fr'],
        defaultLang: initialLang(),
        fallbackLang: 'en',
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
        missingHandler: { useFallbackTranslation: true, logMissingKey: false },
      },
      loader: TranslocoHttpLoader,
    }),
    // Load English and the chosen language before the first render, so the
    // start screen never flashes raw keys.
    // Opens «Handlungsoptionen» when new options come up, also while it is
    // closed and so not rendered (docs/plans/reflection-inline.md D25).
    provideAppInitializer(() => {
      inject(ProposalChoiceService);
    }),
    provideAppInitializer(() => {
      // The stored Lyne theme, before the first render (index.html carries the
      // default for the paint before Angular boots).
      applyBrandTheme(initialBrandTheme());
      applyColorScheme(initialColorScheme());
      const transloco = inject(TranslocoService);
      const lang = initialLang();
      const i18nReady = firstValueFrom(forkJoin([transloco.load('en'), transloco.load(lang)]));

      // The deployment config (docs/plans/configurable-ui-plan.md §4.1): hides
      // or collapses UI items by id. A fixed path, not a parameter — the
      // deployment decides by replacing the file, and the shipped one is
      // empty, so this is a no-op unless someone configured it. Loaded before
      // the first render so a hidden item never flashes on screen.
      //
      // This is the only route that reaches what renders before a session
      // exists (the welcome screen, its menu and dialogs, the other full-page
      // surfaces); a study condition declares the rest on its LayoutPreset.
      const uiConfig = inject(UiConfigService);

      return Promise.all([i18nReady, uiConfig.load('ui-config.json')]);
    }),
  ],
};
