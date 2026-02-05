/**
 * InstallWizard Component Tests
 *
 * Tests for the firmware installation wizard.
 * 
 * The wizard has 3 steps:
 * 1. Firmware Install - Flash firmware to device
 * 2. Device Approval - Monitor Serial and auto-approve device
 * 3. Success - Installation complete
 */

import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { InstallWizard } from "../InstallWizard";

// Mock child components
jest.mock("../FirmwareInstallStep", () => ({
  FirmwareInstallStep: ({ onContinue }: { onContinue: () => void }) => (
    <div>
      <h2>Firmware Install Step</h2>
      <button onClick={onContinue}>Continue to Next Step</button>
    </div>
  ),
}));

jest.mock("../SerialMonitor", () => ({
  SerialMonitor: () => (
    <div data-testid="serial-monitor">Serial Monitor Component</div>
  ),
}));

jest.mock("../SuccessStep", () => ({
  SuccessStep: () => (
    <div>
      <h2>Success Step</h2>
      <p>Installation complete!</p>
    </div>
  ),
}));

describe("InstallWizard", () => {
  describe("Initial State", () => {
    it("should render first step by default", () => {
      render(<InstallWizard />);
      
      expect(screen.getByText("Firmware Install Step")).toBeInTheDocument();
      expect(screen.queryByText("Device Approval")).not.toBeInTheDocument();
      expect(screen.queryByText("Success Step")).not.toBeInTheDocument();
    });

    it("should show progress indicator with 3 steps", () => {
      const { container } = render(<InstallWizard />);
      
      const indicators = container.querySelectorAll(".rounded-full");
      expect(indicators).toHaveLength(3);
    });
  });

  describe("Step Navigation", () => {
    it("should show WiFi confirmation modal when continue is clicked", async () => {
      const user = userEvent.setup();
      render(<InstallWizard />);
      
      expect(screen.getByText("Firmware Install Step")).toBeInTheDocument();
      
      const continueButton = screen.getByText("Continue to Next Step");
      await user.click(continueButton);
      
      // WiFi confirmation modal should appear
      expect(screen.getByText("WiFi Configuration")).toBeInTheDocument();
      expect(screen.getByText("Yes, WiFi is set up")).toBeInTheDocument();
    });

    it("should navigate to device approval step after WiFi confirmation", async () => {
      const user = userEvent.setup();
      render(<InstallWizard />);
      
      const continueButton = screen.getByText("Continue to Next Step");
      await user.click(continueButton);
      
      // Click WiFi confirmation button
      const wifiConfirmButton = screen.getByText("Yes, WiFi is set up");
      await user.click(wifiConfirmButton);
      
      // Step 2 is Device Approval with Serial monitoring
      expect(screen.getByText("Device Approval")).toBeInTheDocument();
      expect(screen.queryByText("Firmware Install Step")).not.toBeInTheDocument();
    });

    it("should update progress indicator when moving to next step", async () => {
      const user = userEvent.setup();
      const { container } = render(<InstallWizard />);
      
      const continueButton = screen.getByText("Continue to Next Step");
      await user.click(continueButton);
      
      // Click WiFi confirmation to proceed
      const wifiConfirmButton = screen.getByText("Yes, WiFi is set up");
      await user.click(wifiConfirmButton);
      
      // Check for checkmark in first step indicator
      const indicators = container.querySelectorAll(".rounded-full");
      expect(indicators[0]).toHaveTextContent("✓");
    });
  });

  describe("Progress Indicator", () => {
    it("should highlight current step", () => {
      const { container } = render(<InstallWizard />);
      
      const indicators = container.querySelectorAll(".rounded-full");
      expect(indicators[0]).toHaveClass("bg-primary");
    });

    it("should show completed steps with checkmark", async () => {
      const user = userEvent.setup();
      const { container } = render(<InstallWizard />);
      
      const continueButton = screen.getByText("Continue to Next Step");
      await user.click(continueButton);
      
      // Click WiFi confirmation to proceed to step 2
      const wifiConfirmButton = screen.getByText("Yes, WiFi is set up");
      await user.click(wifiConfirmButton);
      
      const indicators = container.querySelectorAll(".rounded-full");
      expect(indicators[0]).toHaveClass("bg-success");
      expect(indicators[0]).toHaveTextContent("✓");
    });

    it("should show 2 connectors between 3 steps", () => {
      const { container } = render(<InstallWizard />);
      
      const connectors = container.querySelectorAll(".w-12.h-1");
      expect(connectors).toHaveLength(2);
    });
  });
});
