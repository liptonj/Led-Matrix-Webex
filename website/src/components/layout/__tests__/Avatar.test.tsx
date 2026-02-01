/**
 * Avatar Component Tests
 *
 * Tests for the Avatar component with user authentication.
 */

import { render, screen, waitFor } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { Avatar } from "../Avatar";

// Mock Next.js router
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock Supabase functions
const mockGetSession = jest.fn();
const mockSignOut = jest.fn();
const mockIsSupabaseConfigured = jest.fn();
const mockGetCachedSession = jest.fn();
const mockOnAuthStateChange = jest.fn();

jest.mock("@/lib/supabase", () => ({
  getSession: () => mockGetSession(),
  signOut: () => mockSignOut(),
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  getCachedSession: () => mockGetCachedSession(),
  onAuthStateChange: (callback: () => void) => mockOnAuthStateChange(callback),
}));

describe("Avatar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSupabaseConfigured.mockReturnValue(true);
    mockGetCachedSession.mockReturnValue(null);
    mockOnAuthStateChange.mockResolvedValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
  });

  describe("Loading State", () => {
    it("should show loading spinner initially", () => {
      mockGetSession.mockReturnValue(new Promise(() => {})); // Never resolves
      
      render(<Avatar />);
      
      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
      expect(button).toHaveClass("opacity-50", "cursor-wait");
    });
  });

  describe("Unauthenticated State", () => {
    it("should show login icon when no user", async () => {
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      
      render(<Avatar />);
      
      await waitFor(() => {
        const button = screen.getByLabelText("Login");
        expect(button).toBeInTheDocument();
      });
    });

    it("should show login link when dropdown opened", async () => {
      const user = userEvent.setup();
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      
      render(<Avatar />);
      
      await waitFor(() => {
        expect(screen.getByLabelText("Login")).toBeInTheDocument();
      });
      
      const button = screen.getByLabelText("Login");
      await user.click(button);
      
      expect(screen.getByText("Login")).toBeInTheDocument();
    });

    it("should show Supabase not configured message when not configured", async () => {
      const user = userEvent.setup();
      mockIsSupabaseConfigured.mockReturnValue(false);
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
      
      render(<Avatar />);
      
      await waitFor(() => {
        expect(screen.getByLabelText("Login")).toBeInTheDocument();
      });
      
      const button = screen.getByLabelText("Login");
      await user.click(button);
      
      expect(screen.getByText(/Supabase is not configured/i)).toBeInTheDocument();
    });
  });

  describe("Authenticated State", () => {
    it("should show user initials when authenticated", async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: { email: "john.doe@example.com" },
          },
        },
        error: null,
      });
      
      render(<Avatar />);
      
      await waitFor(() => {
        expect(screen.getByText("JD")).toBeInTheDocument();
      });
    });

    it("should show user menu when dropdown opened", async () => {
      const user = userEvent.setup();
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: { email: "john.doe@example.com" },
          },
        },
        error: null,
      });
      
      render(<Avatar />);
      
      await waitFor(() => {
        expect(screen.getByLabelText("User menu")).toBeInTheDocument();
      });
      
      const button = screen.getByLabelText("User menu");
      await user.click(button);
      
      expect(screen.getByText("john.doe@example.com")).toBeInTheDocument();
      expect(screen.getByText("Admin")).toBeInTheDocument();
      expect(screen.getByText("Logout")).toBeInTheDocument();
    });

    it("should handle logout correctly", async () => {
      const user = userEvent.setup();
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: { email: "john.doe@example.com" },
          },
        },
        error: null,
      });
      mockSignOut.mockResolvedValue({ error: null });
      
      render(<Avatar />);
      
      await waitFor(() => {
        expect(screen.getByLabelText("User menu")).toBeInTheDocument();
      });
      
      const button = screen.getByLabelText("User menu");
      await user.click(button);
      
      const logoutButton = screen.getByText("Logout");
      await user.click(logoutButton);
      
      expect(mockSignOut).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/");
    });
  });

  describe("Initials Generation", () => {
    const testCases = [
      { email: "john.doe@example.com", expected: "JD" },
      { email: "jane_smith@example.com", expected: "JS" },
      { email: "bob-jones@example.com", expected: "BJ" },
      { email: "a@example.com", expected: "A@" },
    ];

    testCases.forEach(({ email, expected }) => {
      it(`should generate "${expected}" for email "${email}"`, async () => {
        mockGetSession.mockResolvedValue({
          data: {
            session: { user: { email } },
          },
          error: null,
        });
        
        render(<Avatar />);
        
        await waitFor(() => {
          const initials = screen.getByText(expected);
          expect(initials).toBeInTheDocument();
        });
      });
    });

    it("should show login icon when no user", async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: null,
        },
        error: null,
      });
      
      render(<Avatar />);
      
      await waitFor(() => {
        const button = screen.getByLabelText("Login");
        expect(button).toBeInTheDocument();
      });
    });
  });

  describe("Accessibility", () => {
    it("should have proper aria attributes", async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: { email: "test@example.com" },
          },
        },
        error: null,
      });
      
      render(<Avatar />);
      
      await waitFor(() => {
        const button = screen.getByRole("button");
        expect(button).toHaveAttribute("aria-label", "User menu");
        expect(button).toHaveAttribute("aria-expanded", "false");
        expect(button).toHaveAttribute("aria-haspopup", "true");
      });
    });

    it("should close dropdown when clicking outside", async () => {
      const user = userEvent.setup();
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            user: { email: "test@example.com" },
          },
        },
        error: null,
      });
      
      render(
        <div>
          <Avatar />
          <div data-testid="outside">Outside</div>
        </div>
      );
      
      await waitFor(() => {
        expect(screen.getByLabelText("User menu")).toBeInTheDocument();
      });
      
      // Open dropdown
      const button = screen.getByLabelText("User menu");
      await user.click(button);
      
      expect(screen.getByText("test@example.com")).toBeInTheDocument();
      
      // Click outside
      const outside = screen.getByTestId("outside");
      await user.click(outside);
      
      await waitFor(() => {
        expect(screen.queryByText("test@example.com")).not.toBeInTheDocument();
      });
    });
  });
});
