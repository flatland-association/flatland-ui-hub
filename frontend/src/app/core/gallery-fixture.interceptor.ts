import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { throwError } from 'rxjs';

/** Id of the Widget Gallery's fixture session (`GalleryFixtureService`). */
export const GALLERY_FIXTURE_SESSION_ID = 'gallery-fixture-session';

/**
 * The fixture session exists only in the browser, so the backend has nothing
 * for it. A request about it is answered here with a 404 and never leaves the
 * browser: the store treats that as "no data", and the gallery loads without
 * 404s in the console or the network log (known bug 2, issue #116).
 */
export const galleryFixtureInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.includes(`/session/${GALLERY_FIXTURE_SESSION_ID}/`)) return next(req);
  return throwError(
    () => new HttpErrorResponse({ status: 404, statusText: 'Gallery fixture session', url: req.urlWithParams }),
  );
};
