/**
 * Mock Next.js modules
 *
 * Centralized mocks for Next.js components and utilities.
 */

import React from "react";

/**
 * Mock Next.js Script component
 */
export const Script = jest.fn(({ onLoad, onError }: {
  src?: string;
  strategy?: string;
  onLoad?: () => void;
  onError?: (e: Error) => void;
}) => {
  React.useEffect(() => {
    if (onLoad) {
      setTimeout(onLoad, 0);
    }
  }, [onLoad]);
  
  return null;
});

/**
 * Mock Next.js Image component
 */
export const Image = jest.fn(({
  src,
  alt,
  width,
  height,
  className,
  priority,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
}) => {
  // eslint-disable-next-line @next/next/no-img-element
  return React.createElement("img", { 
    src, 
    alt, 
    width, 
    height, 
    className,
    "data-priority": priority 
  });
});

/**
 * Mock Next.js Link component
 */
export const Link = jest.fn(({
  href,
  children,
  className,
  ...props
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  [key: string]: unknown;
}) => {
  return React.createElement("a", { 
    href, 
    className,
    ...props 
  }, children);
});

/**
 * Mock useRouter hook
 */
export const useRouter = jest.fn(() => ({
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
  refresh: jest.fn(),
  prefetch: jest.fn(),
  pathname: "/",
  query: {},
  asPath: "/",
  route: "/",
  isReady: true,
}));

/**
 * Mock usePathname hook
 */
export const usePathname = jest.fn(() => "/");

/**
 * Mock useSearchParams hook
 */
export const useSearchParams = jest.fn(() => new URLSearchParams());
