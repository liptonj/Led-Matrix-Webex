/**
 * InstallWizard Component Tests
 *
 * Tests for the firmware installation wizard.
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
      expect(screen.queryByText("Success Step")).not.toBeInTheDocument();
    });

    it("should show progress indicator", () => {
      const { container } = render(<InstallWizard />);
      
      const indicators = container.querySelectorAll(".rounded-full");
      expect(indicators).toHaveLength(2);
    });
  });

  describe("Step Navigation", () => {
    it("should navigate to success step when continue is clicked", async () => {
      const user = userEvent.setup();
      render(<InstallWizard />);
      
      expect(screen.getByText("Firmware Install Step")).toBeInTheDocument();
      
      const continueButton = screen.getByText("Continue to Next Step");
      await user.click(continueButton);
      
      expect(screen.getByText("Success Step")).toBeInTheDocument();
      expect(screen.queryByText("Firmware Install Step")).not.toBeInTheDocument();
    });

    it("should update progress indicator when moving to next step", async () => {
      const user = userEvent.setup();
      const { container } = render(<InstallWizard />);
      
      const continueButton = screen.getByText("Continue to Next Step");
      await user.click(continueButton);
      
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
      
      const indicators = container.querySelectorAll(".rounded-full");
      expect(indicators[0]).toHaveClass("bg-success");
      expect(indicators[0]).toHaveTextContent("✓");
    });

    it("should show connector between steps", () => {
      const { container } = render(<InstallWizard />);
      
      const connectors = container.querySelectorAll(".w-12.h-1");
      expect(connectors).toHaveLength(1);
    });
  });
});
