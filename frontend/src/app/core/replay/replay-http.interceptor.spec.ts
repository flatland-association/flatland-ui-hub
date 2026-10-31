import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { SessionStore } from '../session.store';
import { ReplayService } from './replay.service';
import { replayHttpInterceptor } from './replay-http.interceptor';

describe('replayHttpInterceptor', () => {
  const replayActive = signal(false);
  const time = signal(0);
  const calls = [
    { seq: 1, t: 100, method: 'GET', url: 'http://localhost:8000/session/s1/hmi/plan', status: 200, ms: 3, response: { v: 1 } },
    { seq: 2, t: 300, method: 'GET', url: 'http://localhost:8000/session/s1/hmi/plan', status: 200, ms: 3, response_same_as: 1 },
    { seq: 3, t: 500, method: 'GET', url: 'http://localhost:8000/session/s1/hmi/plan', status: 200, ms: 3, response: { v: 2 } },
    { seq: 4, t: 200, method: 'POST', url: 'http://localhost:8000/session/s1/proposals/apply', status: 409, ms: 3, response: { detail: 'busy' } },
  ];
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    replayActive.set(false);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([replayHttpInterceptor])),
        provideHttpClientTesting(),
        { provide: SessionStore, useValue: { replayActive } },
        { provide: ReplayService, useValue: { time, leg: computed(() => ({ calls })) } },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  it('passes requests through outside a replay', () => {
    http.get('/session/s1/hmi/plan').subscribe();
    backend.expectOne('/session/s1/hmi/plan').flush({});
  });

  it('answers from the recording at the replay time, and sends nothing', async () => {
    replayActive.set(true);
    time.set(350);
    expect(await firstValueFrom(http.get('http://127.0.0.1:4200/session/s1/hmi/plan'))).toEqual({ v: 1 });
    time.set(600);
    expect(await firstValueFrom(http.get('/session/s1/hmi/plan'))).toEqual({ v: 2 });
    await expectAsync(firstValueFrom(http.post('/session/s1/proposals/apply', {}))).toBeRejectedWith(jasmine.objectContaining({ status: 409 }));
    await expectAsync(firstValueFrom(http.get('/session/s1/never'))).toBeRejectedWith(jasmine.objectContaining({ status: 404 }));
    backend.verify();
  });
});
