/**
 * Supabase helper functions for common patterns.
 * 
 * These helpers consolidate duplicated code across the codebase and provide
 * consistent error handling, timeout management, and authentication.
 */

export { queryWithTimeout } from "./queryWithTimeout";
export { callEdgeFunction } from "./callEdgeFunction";
export type { EdgeFunctionOptions } from "./callEdgeFunction";
export { createRealtimeSubscription } from "./createRealtimeSubscription";
export type {
  SubscriptionConfig,
  PostgresChangesConfig,
  BroadcastConfig,
  SubscriptionCallbacks,
} from "./createRealtimeSubscription";
