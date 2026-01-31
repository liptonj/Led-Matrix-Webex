# Database Schema Design for Display System

## Current Schema Overview

### Core Tables

1. **`display.devices`** - Device registration and provisioning
   - Stores device credentials, pairing codes, firmware versions
   - One row per physical device

2. **`display.pairings`** - Live state cache for pairing sessions
   - Stores Webex status, camera/mic state, device telemetry
   - Has `config JSONB` field for device settings snapshot
   - One row per pairing code (1:1 with device)

3. **`display.commands`** - Command queue
   - Durable command queue for device commands
   - Commands are inserted by app, polled/acked by device

### New Tables (Proposed)

4. **`display.feeds`** - Content feed definitions
   - News, stocks, weather, sports feeds
   - Stores feed configuration (API keys, settings)

5. **`display.feed_data`** - Cached feed content
   - Actual feed data (headlines, prices, scores)
   - TTL-based expiration

6. **`display.display_pages`** - Page configuration
   - Which pages to show, order, duration
   - Links feeds to display pages

## Design Decisions

### Why Separate Tables for Feeds?

**Option A: Store feeds in `pairings.config` JSONB** ❌
- Pros: Simple, no schema changes
- Cons: 
  - Hard to query/update individual feeds
  - No TTL/caching mechanism
  - Can't share feeds between pairings
  - Difficult to manage feed updates

**Option B: Separate `feeds` and `feed_data` tables** ✅
- Pros:
  - Efficient queries (indexed by pairing_code, feed_type)
  - Built-in TTL/caching with `expires_at`
  - Can share feed configs
  - Easy to add feed-specific features
  - Supports realtime subscriptions
- Cons:
  - More complex schema
  - Requires migration

**We chose Option B** for extensibility and performance.

### Why `display_pages` Table?

Instead of hardcoding page rotation in firmware, we store page configuration in the database:
- Users can configure which pages to show
- Can add/remove pages without firmware update
- Supports conditional pages (time-based, event-based)
- Easy to reorder pages

### Settings Storage Strategy

**Simple Settings** → `pairings.config` JSONB
- Brightness, scroll speed, page interval
- MQTT config, sensor settings
- These are device-specific and change infrequently

**Complex Content** → Separate tables
- News feeds, stock prices, weather
- These need frequent updates, caching, TTL
- Multiple feeds per pairing possible

## Schema Relationships

```
display.devices (1) ──< (1) display.pairings
                              │
                              ├──< (many) display.feeds
                              │              │
                              │              └──< (many) display.feed_data
                              │
                              └──< (many) display.display_pages
                                             │
                                             └──> (optional) display.feeds
```

## Migration Strategy

### Phase 1: Add New Tables (Non-Breaking)
- Create `feeds`, `feed_data`, `display_pages` tables
- Existing functionality unchanged
- Default pages created for existing pairings

### Phase 2: Firmware Support (Optional)
- Add commands: `get_feed_content`, `get_display_pages`
- Extend display rendering
- Falls back to current behavior if not configured

### Phase 3: Edge Functions
- Create feed fetchers (scheduled jobs)
- Create feed management APIs
- Create page management APIs

## Example Usage

### Creating a News Feed

```sql
INSERT INTO display.feeds (pairing_code, feed_type, feed_name, config, update_interval_seconds)
VALUES (
  'ABC123',
  'news',
  'Tech News',
  '{"api_key": "newsapi_key", "sources": ["techcrunch"]}',
  300  -- Update every 5 minutes
);
```

### Creating a Display Page for Feed

```sql
INSERT INTO display.display_pages (pairing_code, page_type, page_name, feed_id, display_order, display_duration_ms)
VALUES (
  'ABC123',
  'feed',
  'Tech News',
  (SELECT id FROM display.feeds WHERE pairing_code = 'ABC123' AND feed_name = 'Tech News'),
  2,  -- Show after status page
  10000  -- Show for 10 seconds
);
```

### Device Query Flow

1. Device calls `get_display_pages` command
2. Returns ordered list of pages to show
3. Device calls `get_feed_content` command
4. Returns latest feed data for all active feeds
5. Device renders pages in order, rotating based on duration

## Benefits of This Design

1. **Extensible**: Easy to add new feed types without schema changes
2. **Efficient**: Caching reduces API calls, TTL ensures fresh data
3. **Flexible**: Users configure their own feeds and pages
4. **Scalable**: Supports multiple feeds per pairing
5. **Real-time**: Realtime subscriptions for instant updates
6. **Backward Compatible**: Existing functionality unchanged

## Security

- **RLS Policies**: Users can only manage their own feeds (via pairing_code)
- **API Keys**: Stored in `config` JSONB (consider encryption)
- **Rate Limiting**: Feed fetchers respect API rate limits
- **Input Validation**: Validate feed configs in Edge Functions

## Performance Considerations

- **Indexes**: On `pairing_code`, `feed_type`, `enabled`, `expires_at`
- **Caching**: `feed_data` table acts as cache with TTL
- **Cleanup**: Scheduled job to expire old feed_data
- **Realtime**: Only subscribe to active feeds

## Future Enhancements

1. **Feed Templates**: Pre-configured feeds users can enable
2. **Feed Sharing**: Share feed configs between users
3. **Feed Analytics**: Track which feeds are most viewed
4. **Smart Rotation**: AI-based page ordering
5. **Custom Parsers**: Support RSS, XML, custom formats
