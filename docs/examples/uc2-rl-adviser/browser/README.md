# Production-browser verification

`proof.json` records real clicks in Plan B against source
`2c22f037a1243aa93f9234378145b4d2e8616992`, with the paired-evaluation models
unchanged. The subsequent API fix restores the legacy PP horizon cap; it does
not change the native UC2 behavior exercised here.

| Case | Accepted future course | Actual result | Preview/replay agreement |
|---|---|---|---|
| UC2-1, step 16, train 2 | Future left branch at step 30 | 3/3 arrived, native lateness 19 | Selected arrival matches; 203 live positions match preview |
| Tutorial, step 6, train 1 | Inspected non-default course: wait one step | 2/2 arrived, native lateness 14 | Selected arrival matches; 37 live positions match preview |

Course inspection sends no acceptance request and leaves the simulation step
unchanged. Actual UI acceptance sends the chosen candidate ID, preview token
and source step. The live requests continue to pin DLA, while the accepted
PlanPolicy course runs. Tutorial acceptance deliberately uses an alternative
rather than the initial best course.

The UC2-1 check also advances from preview step 15 to 16 before accepting the
old token. The UI receives 409, records no choice and offers refresh. The
refreshed course is then accepted successfully. There are no page or
WebSocket errors; the intentional stale rejection is the sole application
error response.

Plan B hides playback controls. Pause, exact takeover-clock advancement and
subsequent Play therefore use the browser's API client, explicitly identified
in `page_requests`. Train selection, course inspection, refresh and acceptance
use real page controls. Both test sessions are deleted after the check;
their opaque preview tokens have no remaining live session.

The two screenshots show the future-course picker and the completed tutorial
with its retained chosen-course reflection. Reproduce with `browser-proof.cjs`
one directory above, against an already running local production build. Set
`PLAYWRIGHT_PACKAGE` and `CHROME_BIN` to an installed Playwright package and
Chromium executable if they are not on the normal module/browser paths;
`APP_SOURCE_ROOT` identifies the checkout served by that backend.
