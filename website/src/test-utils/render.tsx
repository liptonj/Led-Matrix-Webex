/**
 * Custom Render Utilities
 *
 * Enhanced render functions with common providers and utilities.
 */

import { render, RenderOptions, RenderResult } from "@testing-library/react";
import React, { ReactElement } from "react";

/**
 * Provider wrapper options
 */
interface ProviderOptions {
  // Add common provider options here as needed
  // For example: theme, router context, etc.
}

/**
 * Creates a wrapper with all necessary providers
 */
function createWrapper(options?: ProviderOptions) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    // Add providers here as needed
    // For now, just return children since we don't have a global context yet
    return <>{children}</>;
  };
}

/**
 * Custom render function with providers
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper"> & { providerOptions?: ProviderOptions }
): RenderResult {
  const { providerOptions, ...renderOptions } = options ?? {};
  
  return render(ui, {
    wrapper: createWrapper(providerOptions),
    ...renderOptions,
  });
}

/**
 * Re-export everything from @testing-library/react
 */
export * from "@testing-library/react";

/**
 * Export custom render as default
 */
export { renderWithProviders as render };
