/**
 * Jest setup file for app tests
 *
 * This file configures the test environment for React component tests.
 */

// Import jest-dom matchers
import "@testing-library/jest-dom";

// Mock Next.js Script component
jest.mock("next/script", () => {
  return function MockScript({
    onLoad,
    onError,
  }: {
    src?: string;
    strategy?: string;
    onLoad?: () => void;
    onError?: (e: Error) => void;
  }) {
    // Simulate script loading in tests
    if (onLoad) {
      setTimeout(onLoad, 0);
    }
    return null;
  };
});

// Mock Next.js Image component
jest.mock("next/image", () => {
  return function MockImage({
    src,
    alt,
    width,
    height,
    className,
  }: {
    src: string;
    alt: string;
    width?: number;
    height?: number;
    className?: string;
  }) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} width={width} height={height} className={className} />;
  };
});

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Mock fetch
global.fetch = jest.fn();

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  localStorageMock.getItem.mockReturnValue(null);
});

export {};
