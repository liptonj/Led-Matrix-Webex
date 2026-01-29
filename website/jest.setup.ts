import '@testing-library/jest-dom';

const originalError = console.error;
const originalWarn = console.warn;

const suppressedPatterns = [
  'Token exchange failed:',
  'Token exchange error:',
  'Failed to fetch status:',
  'Failed to load manifest:',
];

function shouldSuppress(args: unknown[]): boolean {
  const first = args[0];
  if (typeof first !== 'string') return false;
  return suppressedPatterns.some((pattern) => first.includes(pattern));
}

beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (shouldSuppress(args)) return;
    originalError(...args);
  };

  console.warn = (...args: unknown[]) => {
    if (shouldSuppress(args)) return;
    originalWarn(...args);
  };
});

afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
});
