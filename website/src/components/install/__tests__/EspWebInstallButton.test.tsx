/**
 * EspWebInstallButton Component Tests
 *
 * Tests for the ESP Web Tools install button wrapper.
 */

import { render } from "@/test-utils";
import { EspWebInstallButton } from "../EspWebInstallButton";

describe("EspWebInstallButton", () => {
  describe("Rendering", () => {
    it("should render custom element with manifest", () => {
      const manifest = "https://example.com/manifest.json";
      const { container } = render(<EspWebInstallButton manifest={manifest} />);
      
      const element = container.querySelector("esp-web-install-button");
      expect(element).toBeInTheDocument();
      expect(element).toHaveAttribute("manifest", manifest);
    });

    it("should render children inside custom element", () => {
      const manifest = "https://example.com/manifest.json";
      const { container } = render(
        <EspWebInstallButton manifest={manifest}>
          <span>Install Firmware</span>
        </EspWebInstallButton>
      );
      
      expect(container).toHaveTextContent("Install Firmware");
    });

    it("should render without children", () => {
      const manifest = "https://example.com/manifest.json";
      const { container } = render(<EspWebInstallButton manifest={manifest} />);
      
      const element = container.querySelector("esp-web-install-button");
      expect(element).toBeInTheDocument();
    });
  });

  describe("Manifest Updates", () => {
    it("should update manifest attribute when prop changes", () => {
      const initialManifest = "https://example.com/manifest-v1.json";
      const updatedManifest = "https://example.com/manifest-v2.json";
      
      const { container, rerender } = render(
        <EspWebInstallButton manifest={initialManifest} />
      );
      
      let element = container.querySelector("esp-web-install-button");
      expect(element).toHaveAttribute("manifest", initialManifest);
      
      rerender(<EspWebInstallButton manifest={updatedManifest} />);
      
      element = container.querySelector("esp-web-install-button");
      expect(element).toHaveAttribute("manifest", updatedManifest);
    });
  });
});
