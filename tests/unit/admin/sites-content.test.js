import { describe, it, expect } from 'vitest';
import { createMockD1 } from '../../helpers/mockD1.js';
import publicSites from '../../../worker/routes/sites.js';
import { parseSiteBody } from '../../../worker/routes/admin/sites.js';

describe('GET /api/sites (public)', () => {
  it('returns sites with parsed features / gameTypes', async () => {
    const db = createMockD1();
    db.__on('FROM sites', {
      results: [{
        id: 'site_a', slug: 'ghost-town', name: 'Ghost Town', site_number: '01', badge: 'open',
        photo_url: '/images/ghost-town.jpg', photo_position: '50% 30%',
        location_blurb: 'Rural — 19 Buildings',
        features_json: '["Bunkers","Modes"]', game_types_json: '["Milsim","Skirmish"]',
      }],
    }, 'all');

    const res = await publicSites.request('/', {}, { DB: db });
    expect(res.status).toBe(200);
    const { sites } = await res.json();
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      slug: 'ghost-town', siteNumber: '01', badge: 'open',
      photoUrl: '/images/ghost-town.jpg', photoPosition: '50% 30%',
      locationBlurb: 'Rural — 19 Buildings',
      features: ['Bunkers', 'Modes'], gameTypes: ['Milsim', 'Skirmish'],
    });
  });

  it('queries only show_on_locations, non-archived, ordered by sort_order', async () => {
    const db = createMockD1();
    db.__on('FROM sites', { results: [] }, 'all');
    await publicSites.request('/', {}, { DB: db });
    const sql = db.__writes().find((w) => w.sql.includes('FROM sites'))?.sql || '';
    expect(sql).toMatch(/show_on_locations = 1/);
    expect(sql).toMatch(/archived_at IS NULL/);
    expect(sql).toMatch(/ORDER BY sort_order/);
  });

  it('tolerates malformed / null JSON arrays', async () => {
    const db = createMockD1();
    db.__on('FROM sites', {
      results: [{ id: 's', slug: 's', name: 'S', features_json: 'not json', game_types_json: null }],
    }, 'all');
    const { sites } = await (await publicSites.request('/', {}, { DB: db })).json();
    expect(sites[0].features).toEqual([]);
    expect(sites[0].gameTypes).toEqual([]);
  });
});

describe('parseSiteBody — /locations content fields', () => {
  it('maps + sanitizes the new fields', () => {
    const { patch } = parseSiteBody({
      photoUrl: '/images/x.jpg',
      photoPosition: '20% 80%',
      badge: 'open',
      siteNumber: '01',
      sortOrder: '2',
      features: ['A', 'B'],
      gameTypes: ['Milsim'],
      locationBlurb: 'Rural — 19 Buildings',
      showOnLocations: true,
    }, { partial: true });
    expect(patch.photo_url).toBe('/images/x.jpg');
    expect(patch.photo_position).toBe('20% 80%');
    expect(patch.badge).toBe('open');
    expect(patch.site_number).toBe('01');
    expect(patch.sort_order).toBe(2);
    expect(patch.features_json).toBe('["A","B"]');
    expect(patch.game_types_json).toBe('["Milsim"]');
    expect(patch.location_blurb).toBe('Rural — 19 Buildings');
    expect(patch.show_on_locations).toBe(1);
  });

  it('sanitizes an unsafe photoPosition to null (CSS-injection guard)', () => {
    const { patch } = parseSiteBody({ photoPosition: 'red; background:url(evil)' }, { partial: true });
    expect(patch.photo_position).toBe(null);
  });

  it('collapses "center" photoPosition to null (page default)', () => {
    const { patch } = parseSiteBody({ photoPosition: 'center' }, { partial: true });
    expect(patch.photo_position).toBe(null);
  });

  it('rejects non-array features', () => {
    const { error } = parseSiteBody({ features: 'nope' }, { partial: true });
    expect(error).toMatch(/features must be an array/);
  });

  it('toggles showOnLocations false → 0', () => {
    const { patch } = parseSiteBody({ showOnLocations: false }, { partial: true });
    expect(patch.show_on_locations).toBe(0);
  });
});
