/**
 * RemoteTerminal Component Tests
 *
 * Tests for the remote terminal component with command input,
 * action toolbar, and connection indicators.
 */

import { render, screen, waitFor } from '@/test-utils';
import userEvent from '@testing-library/user-event';
import { RemoteTerminal } from '../RemoteTerminal';
import type { TerminalLine, BridgeHealth, FlashProgressEvent } from '@/types/support';

const defaultProps = {
  lines: [] as TerminalLine[],
  bridgeHealth: 'healthy' as BridgeHealth,
  flashProgress: null as FlashProgressEvent | null,
  commandHistory: [] as string[],
  onCommand: jest.fn(),
  onAction: jest.fn(),
  onEndSession: jest.fn(),
  onClear: jest.fn(),
};

describe('RemoteTerminal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders action toolbar buttons', () => {
      render(<RemoteTerminal {...defaultProps} />);
      expect(screen.getByText('Reset')).toBeInTheDocument();
      expect(screen.getByText('Bootloader')).toBeInTheDocument();
      expect(screen.getByText('Flash Firmware')).toBeInTheDocument();
      expect(screen.getByText('End Session')).toBeInTheDocument();
      expect(screen.getByText('Clear')).toBeInTheDocument();
    });

    it('renders command input', () => {
      render(<RemoteTerminal {...defaultProps} />);
      expect(screen.getByRole('textbox', { name: /terminal command input/i })).toBeInTheDocument();
    });

    it('renders bridge health indicator', () => {
      render(<RemoteTerminal {...defaultProps} bridgeHealth="healthy" />);
      expect(screen.getAllByText('Bridge Connected').length).toBeGreaterThan(0);
    });

    it('renders terminal display', () => {
      const lines: TerminalLine[] = [
        { text: 'Test output', source: 'device', timestamp: Date.now() },
      ];
      render(<RemoteTerminal {...defaultProps} lines={lines} />);
      expect(screen.getByText('Test output')).toBeInTheDocument();
    });
  });

  describe('command input', () => {
    it('calls onCommand when Enter is pressed', async () => {
      const user = userEvent.setup();
      const onCommand = jest.fn();
      render(<RemoteTerminal {...defaultProps} onCommand={onCommand} />);

      const input = screen.getByRole('textbox', { name: /terminal command input/i });
      await user.type(input, 'test command{Enter}');

      expect(onCommand).toHaveBeenCalledWith('test command');
    });

    it('submits on Enter like a real terminal', async () => {
      const user = userEvent.setup();
      const onCommand = jest.fn();
      render(<RemoteTerminal {...defaultProps} onCommand={onCommand} />);

      const input = screen.getByRole('textbox', { name: /terminal command input/i });
      await user.type(input, 'test{Enter}');

      expect(onCommand).toHaveBeenCalledWith('test');
    });

    it('does not call onCommand for empty Enter press', async () => {
      const user = userEvent.setup();
      const onCommand = jest.fn();
      render(<RemoteTerminal {...defaultProps} onCommand={onCommand} />);

      const input = screen.getByRole('textbox', { name: /terminal command input/i });
      await user.type(input, '{Enter}');

      expect(onCommand).not.toHaveBeenCalled();
    });

    it('does not call onCommand for whitespace-only input', async () => {
      const user = userEvent.setup();
      const onCommand = jest.fn();
      render(<RemoteTerminal {...defaultProps} onCommand={onCommand} />);

      const input = screen.getByRole('textbox', { name: /terminal command input/i });
      await user.type(input, '   {Enter}');

      expect(onCommand).not.toHaveBeenCalled();
    });

    it('clears input after submitting command', async () => {
      const user = userEvent.setup();
      const onCommand = jest.fn();
      render(<RemoteTerminal {...defaultProps} onCommand={onCommand} />);

      const input = screen.getByRole('textbox', { name: /terminal command input/i }) as HTMLInputElement;
      await user.type(input, 'test command{Enter}');

      await waitFor(() => {
        expect(input.value).toBe('');
      });
    });

    it('navigates command history with arrow keys', async () => {
      const user = userEvent.setup();
      const onCommand = jest.fn();
      const commandHistory = ['command1', 'command2', 'command3'];
      render(
        <RemoteTerminal
          {...defaultProps}
          onCommand={onCommand}
          commandHistory={commandHistory}
        />
      );

      const input = screen.getByRole('textbox', { name: /terminal command input/i }) as HTMLInputElement;
      
      // Navigate up through history
      await user.type(input, '{ArrowUp}');
      expect(input.value).toBe('command3');

      await user.type(input, '{ArrowUp}');
      expect(input.value).toBe('command2');

      await user.type(input, '{ArrowUp}');
      expect(input.value).toBe('command1');

      // Navigate down through history
      await user.type(input, '{ArrowDown}');
      expect(input.value).toBe('command2');

      await user.type(input, '{ArrowDown}');
      expect(input.value).toBe('command3');

      // Navigate down past end clears input
      await user.type(input, '{ArrowDown}');
      expect(input.value).toBe('');
    });
  });

  describe('action buttons', () => {
    it('calls onAction when Reset is clicked', async () => {
      const user = userEvent.setup();
      const onAction = jest.fn();
      render(<RemoteTerminal {...defaultProps} onAction={onAction} />);

      await user.click(screen.getByText('Reset'));
      expect(onAction).toHaveBeenCalledWith('reset');
    });

    it('calls onAction when Bootloader is clicked', async () => {
      const user = userEvent.setup();
      const onAction = jest.fn();
      render(<RemoteTerminal {...defaultProps} onAction={onAction} />);

      await user.click(screen.getByText('Bootloader'));
      expect(onAction).toHaveBeenCalledWith('bootloader');
    });

    it('calls onAction when Flash Firmware is clicked', async () => {
      const user = userEvent.setup();
      const onAction = jest.fn();
      render(<RemoteTerminal {...defaultProps} onAction={onAction} />);

      await user.click(screen.getByText('Flash Firmware'));
      expect(onAction).toHaveBeenCalledWith('flash');
    });

    it('calls onEndSession when End Session is clicked', async () => {
      const user = userEvent.setup();
      const onEndSession = jest.fn();
      render(<RemoteTerminal {...defaultProps} onEndSession={onEndSession} />);

      await user.click(screen.getByText('End Session'));
      expect(onEndSession).toHaveBeenCalled();
    });

    it('calls onClear when Clear is clicked', async () => {
      const user = userEvent.setup();
      const onClear = jest.fn();
      render(<RemoteTerminal {...defaultProps} onClear={onClear} />);

      await user.click(screen.getByText('Clear'));
      expect(onClear).toHaveBeenCalled();
    });
  });

  describe('bridge health indicator', () => {
    it('shows healthy status', () => {
      render(<RemoteTerminal {...defaultProps} bridgeHealth="healthy" />);
      expect(screen.getAllByText('Bridge Connected').length).toBeGreaterThan(0);
    });

    it('shows degraded status', () => {
      render(<RemoteTerminal {...defaultProps} bridgeHealth="degraded" />);
      // BridgeHealthIndicator rendered in both toolbar and TerminalDisplay statusSlot
      expect(screen.getAllByText('Bridge Slow').length).toBeGreaterThan(0);
    });

    it('shows disconnected status', () => {
      render(<RemoteTerminal {...defaultProps} bridgeHealth="disconnected" />);
      expect(screen.getAllByText('Bridge Lost').length).toBeGreaterThan(0);
    });

    it('shows unknown status', () => {
      render(<RemoteTerminal {...defaultProps} bridgeHealth="unknown" />);
      expect(screen.getAllByText('Connecting...').length).toBeGreaterThan(0);
    });
  });

  describe('flash progress', () => {
    it('shows flash progress bar when flashing', () => {
      const flashProgress: FlashProgressEvent = {
        phase: 'Writing',
        percent: 45,
        message: 'Writing firmware...',
      };
      render(
        <RemoteTerminal
          {...defaultProps}
          flashProgress={flashProgress}
        />
      );
      expect(screen.getByText(/Writing firmware/)).toBeInTheDocument();
      expect(screen.getByText('45%')).toBeInTheDocument();
      expect(screen.getByText('Abort Flash')).toBeInTheDocument();
    });

    it('disables action buttons during flash', () => {
      const flashProgress: FlashProgressEvent = {
        phase: 'Writing',
        percent: 45,
        message: 'Writing...',
      };
      render(
        <RemoteTerminal
          {...defaultProps}
          flashProgress={flashProgress}
        />
      );
      expect(screen.getByText('Reset')).toBeDisabled();
      expect(screen.getByText('Bootloader')).toBeDisabled();
      expect(screen.getByText('Flash Firmware')).toBeDisabled();
      expect(screen.getByText('End Session')).toBeDisabled();
    });

    it('allows aborting flash', async () => {
      const user = userEvent.setup();
      const onAction = jest.fn();
      const flashProgress: FlashProgressEvent = {
        phase: 'Writing',
        percent: 45,
        message: 'Writing...',
      };
      render(
        <RemoteTerminal
          {...defaultProps}
          flashProgress={flashProgress}
          onAction={onAction}
        />
      );

      await user.click(screen.getByText('Abort Flash'));
      expect(onAction).toHaveBeenCalledWith('flash_abort');
    });

    it('does not show progress bar when flash is complete', () => {
      const flashProgress: FlashProgressEvent = {
        phase: 'Complete',
        percent: 100,
        message: 'Flash complete',
      };
      render(
        <RemoteTerminal
          {...defaultProps}
          flashProgress={flashProgress}
        />
      );
      expect(screen.queryByText('Abort Flash')).not.toBeInTheDocument();
      expect(screen.getByText('Reset')).not.toBeDisabled();
    });

    it('does not show progress bar when flashProgress is null', () => {
      render(<RemoteTerminal {...defaultProps} flashProgress={null} />);
      expect(screen.queryByText('Abort Flash')).not.toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('handles empty lines array', () => {
      render(<RemoteTerminal {...defaultProps} lines={[]} />);
      expect(screen.getByText('Waiting for device output...')).toBeInTheDocument();
    });

    it('handles many terminal lines', () => {
      const lines: TerminalLine[] = Array.from({ length: 100 }, (_, i) => ({
        text: `Line ${i + 1}`,
        source: 'device' as const,
        timestamp: Date.now(),
      }));
      render(<RemoteTerminal {...defaultProps} lines={lines} />);
      expect(screen.getByText('Line 1')).toBeInTheDocument();
      expect(screen.getByText('Line 100')).toBeInTheDocument();
    });

    it('handles command history navigation at boundaries', async () => {
      const user = userEvent.setup();
      const commandHistory = ['command1'];
      render(
        <RemoteTerminal
          {...defaultProps}
          commandHistory={commandHistory}
        />
      );

      const input = screen.getByRole('textbox', { name: /terminal command input/i }) as HTMLInputElement;
      
      // Navigate up past beginning
      await user.type(input, '{ArrowUp}{ArrowUp}{ArrowUp}');
      expect(input.value).toBe('command1');

      // Navigate down past end
      await user.type(input, '{ArrowDown}{ArrowDown}{ArrowDown}');
      expect(input.value).toBe('');
    });

    it('handles empty command history', async () => {
      const user = userEvent.setup();
      render(<RemoteTerminal {...defaultProps} commandHistory={[]} />);

      const input = screen.getByRole('textbox', { name: /terminal command input/i }) as HTMLInputElement;
      await user.type(input, '{ArrowUp}');
      expect(input.value).toBe('');
    });
  });

  describe('accessibility', () => {
    it('has proper button roles', () => {
      render(<RemoteTerminal {...defaultProps} />);
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('has proper input with aria-label', () => {
      render(<RemoteTerminal {...defaultProps} />);
      const input = screen.getByRole('textbox', { name: /terminal command input/i });
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('aria-label');
    });

    it('has proper form structure', () => {
      const { container } = render(<RemoteTerminal {...defaultProps} />);
      const form = container.querySelector('form');
      expect(form).toBeInTheDocument();
    });
  });
});
