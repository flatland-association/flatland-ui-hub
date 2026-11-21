import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { galleryFixtureInterceptor } from './gallery-fixture.interceptor';

describe('galleryFixtureInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([galleryFixtureInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  it('answers requests for the fixture session with a 404, without a network call', async () => {
    const err = await firstValueFrom(http.get('/session/gallery-fixture-session/hmi/plan')).catch((e) => e);
    expect(err.status).toBe(404);
    backend.expectNone('/session/gallery-fixture-session/hmi/plan');
  });

  it('passes requests for real sessions through', () => {
    let body: unknown;
    http.get('/session/s1/hmi/plan').subscribe((b) => (body = b));
    backend.expectOne('/session/s1/hmi/plan').flush({ ok: 1 });
    expect(body).toEqual({ ok: 1 });
  });
});
