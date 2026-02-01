/**
 * Firmware Manifest Utility Tests
 *
 * Unit tests for the firmware manifest URL generation utilities.
 */

import {
    getEspWebToolsManifestUrl,
    getManifestUrl,
    isManifestConfigured,
} from '../manifest';

// Store original env
const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('getManifestUrl', () => {
  it('should return manifest URL when Supabase URL is configured', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';

    const url = getManifestUrl();

    expect(url).toBe('https://test.supabase.co/functions/v1/get-manifest');
  });

  it('should return null when Supabase URL is not configured', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const url = getManifestUrl();

    expect(url).toBeNull();
  });

  it('should return null when Supabase URL is empty string', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';

    const url = getManifestUrl();

    expect(url).toBeNull();
  });

  it('should handle Supabase URL with trailing slash', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co/';

    const url = getManifestUrl();

    // Should not double slash
    expect(url).toBe('https://test.supabase.co//functions/v1/get-manifest');
  });
});

describe('getEspWebToolsManifestUrl', () => {
  it('should return ESP Web Tools manifest URL when Supabase URL is configured', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';

    const url = getEspWebToolsManifestUrl();

    expect(url).toBe('https://test.supabase.co/functions/v1/get-manifest?format=esp-web-tools');
  });

  it('should return null when Supabase URL is not configured', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const url = getEspWebToolsManifestUrl();

    expect(url).toBeNull();
  });

  it('should return null when Supabase URL is empty string', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';

    const url = getEspWebToolsManifestUrl();

    expect(url).toBeNull();
  });

  it('should include format query parameter', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';

    const url = getEspWebToolsManifestUrl();

    expect(url).toContain('format=esp-web-tools');
  });
});

describe('isManifestConfigured', () => {
  it('should return true when Supabase URL is configured', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';

    const configured = isManifestConfigured();

    expect(configured).toBe(true);
  });

  it('should return false when Supabase URL is not configured', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const configured = isManifestConfigured();

    expect(configured).toBe(false);
  });

  it('should return false when Supabase URL is empty string', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';

    const configured = isManifestConfigured();

    expect(configured).toBe(false);
  });
});

describe('consistency between utilities', () => {
  it('should have consistent behavior when Supabase is configured', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';

    const manifestUrl = getManifestUrl();
    const espWebToolsUrl = getEspWebToolsManifestUrl();
    const configured = isManifestConfigured();

    expect(manifestUrl).not.toBeNull();
    expect(espWebToolsUrl).not.toBeNull();
    expect(configured).toBe(true);
  });

  it('should have consistent behavior when Supabase is not configured', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const manifestUrl = getManifestUrl();
    const espWebToolsUrl = getEspWebToolsManifestUrl();
    const configured = isManifestConfigured();

    expect(manifestUrl).toBeNull();
    expect(espWebToolsUrl).toBeNull();
    expect(configured).toBe(false);
  });
});
