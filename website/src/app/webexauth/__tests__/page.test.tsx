/**
 * WebexAuth Page Tests
 *
 * Tests for the nonce-based Webex authorization page.
 * Verifies URL parameter handling, display, authorization flow, and security.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import WebexAuthPage from '../page';

// Mock fetchWithTimeout
jest.mock('@/lib/utils/fetchWithTimeout', () => ({
  fetchWithTimeout: jest.fn(),
}));

import { fetchWithTimeout } from '@/lib/utils/fetchWithTimeout';

const mockFetchWithTimeout = fetchWithTimeout as jest.MockedFunction<typeof fetchWithTimeout>;

// Helper to mock window.location.search in jsdom
// Uses history.replaceState which jsdom supports without triggering navigation
function mockWindowSearch(search: string) {
  window.history.replaceState({}, '', `/webexauth${search}`);
}

describe('WebexAuthPage', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...origEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    };
    mockFetchWithTimeout.mockClear();
    jest.clearAllMocks();

    // Default: valid nonce + serial
    mockWindowSearch('?nonce=abc123def456789012345678abcdef01&serial=A1B2C3D4');
  });

  afterEach(() => {
    process.env = origEnv;
    jest.restoreAllMocks();
  });

  // ============================================================================
  // URL Parameter Tests
  // ============================================================================

  describe('URL Parameter Tests', () => {
    it('reads nonce from URL search params', async () => {
      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByText(/Connect your Webex account/i)).toBeInTheDocument();
      });
    });

    it('reads serial from URL search params', async () => {
      mockWindowSearch('?nonce=abc123def456789012345678abcdef01&serial=TEST1234');
      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByText(/TEST1234/)).toBeInTheDocument();
      });
    });

    it('does NOT read token from URL params', async () => {
      mockWindowSearch(
        '?nonce=abc123def456789012345678abcdef01&serial=A1B2C3D4&token=should-be-ignored'
      );

      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ auth_url: 'https://webex.com/auth' }),
      } as Response);

      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Authorize with Webex/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Authorize with Webex/i }));

      await waitFor(() => {
        expect(mockFetchWithTimeout).toHaveBeenCalled();
        const callArgs = mockFetchWithTimeout.mock.calls[0];
        const options = callArgs[1] as RequestInit;
        // Should NOT include Authorization header with the ignored token
        const headers = options.headers as Record<string, string>;
        expect(headers).not.toHaveProperty('Authorization');
      });
    });

    it('does NOT read ts or sig from URL params', async () => {
      mockWindowSearch(
        '?nonce=abc123def456789012345678abcdef01&serial=A1B2C3D4&ts=1234567890&sig=ignored'
      );

      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ auth_url: 'https://webex.com/auth' }),
      } as Response);

      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Authorize with Webex/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Authorize with Webex/i }));

      await waitFor(() => {
        expect(mockFetchWithTimeout).toHaveBeenCalled();
        const callArgs = mockFetchWithTimeout.mock.calls[0];
        const options = callArgs[1] as RequestInit;
        const headers = options.headers as Record<string, string>;
        expect(headers).not.toHaveProperty('X-Timestamp');
        expect(headers).not.toHaveProperty('X-Signature');
      });
    });

    it('does NOT read pairing_code from URL params', async () => {
      mockWindowSearch(
        '?nonce=abc123def456789012345678abcdef01&serial=A1B2C3D4&pairing_code=ignored'
      );

      render(<WebexAuthPage />);

      await waitFor(() => {
        // Should NOT display any pairing_code label
        expect(screen.queryByText(/Pairing Code/i)).not.toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Display Tests
  // ============================================================================

  describe('Display Tests', () => {
    it('shows serial number on the page', async () => {
      mockWindowSearch('?nonce=abc123def456789012345678abcdef01&serial=DISPLAY123');
      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByText(/DISPLAY123/)).toBeInTheDocument();
      });
    });

    it('shows "Authorize with Webex" button', () => {
      render(<WebexAuthPage />);
      expect(screen.getByRole('button', { name: /Authorize with Webex/i })).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Missing Params Tests
  // ============================================================================

  describe('Missing Params Tests', () => {
    it('shows error when nonce is missing and user clicks authorize', async () => {
      mockWindowSearch('?serial=A1B2C3D4');
      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Authorize with Webex/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Authorize with Webex/i }));

      await waitFor(() => {
        expect(screen.getByText(/Missing required parameters/i)).toBeInTheDocument();
      });

      // Should not call the API
      expect(mockFetchWithTimeout).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Authorization Flow Tests
  // ============================================================================

  describe('Authorization Flow Tests', () => {
    it('POSTs to webex-oauth-start with {nonce} in body', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ auth_url: 'https://webex.com/auth' }),
      } as Response);

      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Authorize with Webex/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Authorize with Webex/i }));

      await waitFor(() => {
        expect(mockFetchWithTimeout).toHaveBeenCalledWith(
          'https://test.supabase.co/functions/v1/webex-oauth-start',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ nonce: 'abc123def456789012345678abcdef01' }),
          }),
          15000
        );
      });
    });

    it('POST request does NOT include Authorization header', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ auth_url: 'https://webex.com/auth' }),
      } as Response);

      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Authorize with Webex/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Authorize with Webex/i }));

      await waitFor(() => {
        expect(mockFetchWithTimeout).toHaveBeenCalled();
        const options = mockFetchWithTimeout.mock.calls[0][1] as RequestInit;
        const headers = options.headers as Record<string, string>;
        expect(headers).not.toHaveProperty('Authorization');
      });
    });

    it('POST request does NOT include HMAC headers', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ auth_url: 'https://webex.com/auth' }),
      } as Response);

      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Authorize with Webex/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Authorize with Webex/i }));

      await waitFor(() => {
        expect(mockFetchWithTimeout).toHaveBeenCalled();
        const options = mockFetchWithTimeout.mock.calls[0][1] as RequestInit;
        const headers = options.headers as Record<string, string>;
        expect(headers).not.toHaveProperty('X-Device-Serial');
        expect(headers).not.toHaveProperty('X-Timestamp');
        expect(headers).not.toHaveProperty('X-Signature');
      });
    });

    it('shows error message on fetch failure', async () => {
      mockFetchWithTimeout.mockRejectedValueOnce(new Error('Network error'));

      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Authorize with Webex/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Authorize with Webex/i }));

      await waitFor(() => {
        expect(screen.getByText(/Network error/i)).toBeInTheDocument();
      });
    });

    it('shows error when response is not ok', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid nonce' }),
      } as Response);

      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Authorize with Webex/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Authorize with Webex/i }));

      await waitFor(() => {
        expect(screen.getByText(/Invalid nonce/i)).toBeInTheDocument();
      });
    });

    it('shows error when auth_url is missing from response', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);

      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Authorize with Webex/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Authorize with Webex/i }));

      await waitFor(() => {
        expect(screen.getByText(/Missing authorization URL/i)).toBeInTheDocument();
      });
    });

    it('shows submitting state during authorization', async () => {
      mockFetchWithTimeout.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                status: 200,
                json: async () => ({ auth_url: 'https://webex.com/auth' }),
              } as Response);
            }, 100);
          })
      );

      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Authorize with Webex/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Authorize with Webex/i }));

      await waitFor(() => {
        expect(screen.getByText(/Redirecting/)).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // URL Security Tests
  // ============================================================================

  describe('URL Security Tests', () => {
    it('nonce is sent in request body, not URL or headers', async () => {
      const testNonce = 'abc123def456789012345678abcdef01';

      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ auth_url: 'https://webex.com/auth' }),
      } as Response);

      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Authorize with Webex/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Authorize with Webex/i }));

      await waitFor(() => {
        expect(mockFetchWithTimeout).toHaveBeenCalled();
        const callArgs = mockFetchWithTimeout.mock.calls[0];
        const url = callArgs[0] as string;
        const options = callArgs[1] as RequestInit;
        const body = options.body as string;

        // Nonce should NOT be in the API URL
        expect(url).not.toContain(testNonce);
        // Nonce should be in request body
        expect(JSON.parse(body)).toEqual({ nonce: testNonce });
      });
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles missing Supabase URL environment variable', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = '';

      render(<WebexAuthPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Authorize with Webex/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Authorize with Webex/i }));

      await waitFor(() => {
        expect(screen.getByText(/Supabase URL not configured/i)).toBeInTheDocument();
      });
    });

    it('handles missing serial gracefully', async () => {
      mockWindowSearch('?nonce=abc123def456789012345678abcdef01');
      render(<WebexAuthPage />);

      await waitFor(() => {
        // Should show dash for missing serial
        expect(screen.getByText('—')).toBeInTheDocument();
      });
    });
  });
});
