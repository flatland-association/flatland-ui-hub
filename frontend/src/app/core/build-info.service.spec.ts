import { TestBed } from '@angular/core/testing';
import { BuildInfoService } from './build-info.service';

describe('BuildInfoService.unversioned', () => {
  const withCommit = async (commit: string): Promise<BuildInfoService> => {
    spyOn(window, 'fetch').and.resolveTo(new Response(JSON.stringify({ commit, branch: 'b', builtAt: null })));
    const service = TestBed.inject(BuildInfoService);
    for (let i = 0; i < 20 && !service.info(); i++) await new Promise((resolve) => setTimeout(resolve));
    return service;
  };

  it('is true for an unstamped dev build', async () => {
    expect((await withCommit('dev')).unversioned()).toBeTrue();
  });

  it('is true for a build with uncommitted changes', async () => {
    expect((await withCommit('45906a8-dirty')).unversioned()).toBeTrue();
  });

  it('is false for a clean commit', async () => {
    expect((await withCommit('45906a8')).unversioned()).toBeFalse();
  });
});
