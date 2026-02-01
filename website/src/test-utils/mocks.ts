/**
 * Shared Test Mocks
 *
 * Central location for commonly used mock implementations across tests.
 * This eliminates duplication and ensures consistency.
 */


/**
 * Creates a mock Supabase query builder with chainable methods
 */
export function createMockQueryBuilder(): Record<string, jest.Mock> {
  const builder: Record<string, jest.Mock> = {};
  
  builder.select = jest.fn(() => builder);
  builder.order = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.neq = jest.fn(() => builder);
  builder.gt = jest.fn(() => builder);
  builder.gte = jest.fn(() => builder);
  builder.lt = jest.fn(() => builder);
  builder.lte = jest.fn(() => builder);
  builder.like = jest.fn(() => builder);
  builder.ilike = jest.fn(() => builder);
  builder.in = jest.fn(() => builder);
  builder.is = jest.fn(() => builder);
  builder.filter = jest.fn(() => builder);
  builder.limit = jest.fn(() => Promise.resolve({ data: [], error: null }));
  builder.single = jest.fn(() => Promise.resolve({ data: null, error: null }));
  builder.update = jest.fn(() => builder);
  builder.insert = jest.fn(() => builder);
  builder.delete = jest.fn(() => builder);
  builder.upsert = jest.fn(() => builder);
  builder.range = jest.fn(() => builder);
  builder.then = jest.fn((resolve) => {
    resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: null });
  });
  
  return builder;
}

/**
 * Creates a mock Supabase realtime channel
 */
export interface MockChannel {
  on: jest.Mock;
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
}

export function createMockChannel(): MockChannel {
  const channel: MockChannel = {
    on: jest.fn(function(this: MockChannel) { 
      return this; 
    }),
    subscribe: jest.fn(function(this: MockChannel, callback?: (status: string) => void) {
      if (callback) callback("SUBSCRIBED");
      return this;
    }),
    unsubscribe: jest.fn(),
  };
  
  return channel;
}

/**
 * Mock Supabase client type for testing
 */
export interface MockSupabaseClient {
  channel: jest.Mock;
  removeChannel: jest.Mock;
  schema: jest.Mock;
  from: jest.Mock;
  auth: {
    signInWithPassword: jest.Mock;
    signOut: jest.Mock;
    getSession: jest.Mock;
    onAuthStateChange: jest.Mock;
    getUser: jest.Mock;
  };
}

/**
 * Creates a mock Supabase client with common methods
 */
export function createMockSupabaseClient(): MockSupabaseClient {
  const mockChannel = createMockChannel();
  
  return {
    channel: jest.fn(() => mockChannel),
    removeChannel: jest.fn(),
    schema: jest.fn(() => ({
      from: jest.fn(() => createMockQueryBuilder()),
    })),
    from: jest.fn(() => createMockQueryBuilder()),
    auth: {
      signInWithPassword: jest.fn(() =>
        Promise.resolve({ 
          data: { session: { access_token: "mock-token", user: { id: "user-123" } } }, 
          error: null 
        }),
      ),
      signOut: jest.fn(() => Promise.resolve({ error: null })),
      getSession: jest.fn(() =>
        Promise.resolve({ 
          data: { session: { access_token: "mock-token", user: { id: "user-123" } } }, 
          error: null 
        }),
      ),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
      getUser: jest.fn(() =>
        Promise.resolve({ 
          data: { user: { id: "user-123", email: "test@example.com" } }, 
          error: null 
        }),
      ),
    },
  };
}

/**
 * Mock WebSocket implementation for testing
 */
export class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = MockWebSocket.CONNECTING;
  readonly OPEN = MockWebSocket.OPEN;
  readonly CLOSING = MockWebSocket.CLOSING;
  readonly CLOSED = MockWebSocket.CLOSED;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  private static instances: MockWebSocket[] = [];
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  simulateMessage<T>(data: T): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(data) }));
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  static getLastInstance(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  static getAllInstances(): MockWebSocket[] {
    return MockWebSocket.instances;
  }

  static clearInstances(): void {
    MockWebSocket.instances = [];
  }
}

/**
 * Mock fetch implementation
 */
export function createMockFetch(defaultResponse?: unknown): jest.Mock {
  return jest.fn((url: string, options?: RequestInit) => {
    const response = defaultResponse ?? { ok: true };
    
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => response,
      text: async () => JSON.stringify(response),
      headers: new Headers(),
      ...response,
    });
  });
}

/**
 * Mock localStorage implementation
 */
export interface MockLocalStorage {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
  clear: jest.Mock;
  key: jest.Mock;
  length: number;
}

export function createMockLocalStorage(): MockLocalStorage {
  const store: Record<string, string> = {};
  
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = String(value);
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      Object.keys(store).forEach(key => delete store[key]);
    }),
    key: jest.fn((index: number) => {
      const keys = Object.keys(store);
      return keys[index] ?? null;
    }),
    length: 0,
  };
}

/**
 * Mock Webex SDK instance
 */
export interface MockWebexSDK {
  isReady: boolean;
  isMeeting: boolean;
  meetingId?: string;
  userId?: string;
  error?: string;
}

export function createMockWebexSDK(overrides?: Partial<MockWebexSDK>): MockWebexSDK {
  return {
    isReady: true,
    isMeeting: false,
    ...overrides,
  };
}
