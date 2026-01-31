# Content Feeds Architecture

## Overview

This document describes the architecture for extensible display content beyond Webex status. The system supports custom content feeds like news tickers, stock prices, weather, and sports scores.

## Database Schema

### Tables

#### `display.feeds`
Stores feed definitions (what feeds exist, how to fetch them).

**Key Fields:**
- `feed_type`: `news`, `stocks`, `weather`, `sports`, `custom`
- `config`: JSONB with feed-specific settings (API keys, locations, symbols, URLs)
- `update_interval_seconds`: How often to fetch new data
- `cache_ttl_seconds`: How long cached data is valid
- `priority`: Display order (lower = shown first)

**Example Config:**
```json
{
  "api_key": "newsapi_key_here",
  "sources": ["techcrunch", "the-verge"],
  "country": "us"
}
```

#### `display.feed_data`
Cached feed content with TTL.

**Key Fields:**
- `content`: JSONB with actual feed data (varies by feed_type)
- `expires_at`: When this data expires
- `content_hash`: Hash for change detection

**Example Content (news feed):**
```json
{
  "headlines": [
    {"title": "Breaking: Tech News", "source": "TechCrunch", "url": "..."},
    {"title": "Latest Updates", "source": "The Verge", "url": "..."}
  ],
  "updated_at": "2026-01-30T10:00:00Z"
}
```

#### `display.display_pages`
Page configuration per pairing (which pages to show, order, duration).

**Key Fields:**
- `page_type`: `status`, `sensors`, `in_call`, `feed`, `custom`
- `display_order`: Order in rotation
- `display_duration_ms`: How long to show
- `feed_id`: Associated feed (if page_type = 'feed')
- `show_always`: If true, always show (don't rotate)
- `show_conditions`: JSONB conditions for when to show

**Core Page Types (Webex Integration):**
| page_type | Firmware Enum | Description |
|-----------|---------------|-------------|
| `status` | `DisplayPage::STATUS` | **Webex presence status** - shows user status (available, DND, in meeting), date/time, display name, compact sensors |
| `sensors` | `DisplayPage::SENSORS` | Sensor data page - temperature, humidity, TVOC, IAQ |
| `in_call` | `DisplayPage::IN_CALL` | **Webex call screen** - shows "IN A CALL", camera/mic state, overrides rotation when `in_call=true` |
| `feed` | (new) | External content feeds (news, stocks, weather, sports) |
| `custom` | (new) | User-defined static content |

**Example show_conditions:**
```json
{
  "time_of_day": "09:00-17:00",  // Only show during business hours
  "day_of_week": ["monday", "tuesday", "wednesday", "thursday", "friday"]
}
```

## Architecture Flow

### 1. Feed Definition
```
User creates feed → display.feeds table
  - Sets feed_type, config, update_interval
  - Edge Function or scheduled job fetches data
```

### 2. Data Fetching
```
Scheduled job / Edge Function:
  - Queries display.feeds WHERE enabled = TRUE
  - Checks last_fetched_at + update_interval_seconds
  - Fetches data from external API
  - Stores in display.feed_data with expires_at
```

### 3. Page Configuration
```
User configures pages → display.display_pages table
  - Links feed_id to page
  - Sets display_order, display_duration_ms
  - Device queries get_active_pages() via command
```

### 4. Device Display
```
Device:
  - Calls get_config command → gets page config
  - Calls get_feed_content command → gets feed data
  - Renders pages in order
  - Rotates based on display_duration_ms
```

## Feed Types

### News Feed (`feed_type: 'news'`)
**Config:**
```json
{
  "api_key": "newsapi_key",
  "sources": ["techcrunch"],
  "country": "us",
  "category": "technology"
}
```

**Content Structure:**
```json
{
  "headlines": [
    {
      "title": "Article Title",
      "source": "Source Name",
      "url": "https://...",
      "published_at": "2026-01-30T10:00:00Z"
    }
  ],
  "updated_at": "2026-01-30T10:00:00Z"
}
```

### Stock Feed (`feed_type: 'stocks'`)
**Config:**
```json
{
  "api_key": "alpha_vantage_key",
  "symbols": ["AAPL", "GOOGL", "MSFT"],
  "update_frequency": "1min"  // 1min, 5min, 15min, etc.
}
```

**Content Structure:**
```json
{
  "quotes": [
    {
      "symbol": "AAPL",
      "price": 185.50,
      "change": 2.30,
      "change_percent": 1.25,
      "volume": 50000000,
      "updated_at": "2026-01-30T10:00:00Z"
    }
  ],
  "updated_at": "2026-01-30T10:00:00Z"
}
```

### Weather Feed (`feed_type: 'weather'`)
**Config:**
```json
{
  "api_key": "openweather_key",
  "location": "San Francisco, CA",
  "lat": 37.7749,
  "lon": -122.4194,
  "units": "imperial"  // imperial or metric
}
```

**Content Structure:**
```json
{
  "location": "San Francisco, CA",
  "temperature": 72,
  "condition": "Sunny",
  "humidity": 65,
  "wind_speed": 10,
  "forecast": [
    {"day": "Today", "high": 75, "low": 60, "condition": "Sunny"},
    {"day": "Tomorrow", "high": 73, "low": 58, "condition": "Partly Cloudy"}
  ],
  "updated_at": "2026-01-30T10:00:00Z"
}
```

### Sports Feed (`feed_type: 'sports'`)
**Config:**
```json
{
  "api_key": "espn_api_key",
  "sport": "nfl",  // nfl, nba, mlb, nhl, etc.
  "teams": ["SF", "LAR"],  // Favorite teams
  "league": "NFL"
}
```

**Content Structure:**
```json
{
  "games": [
    {
      "home_team": "49ers",
      "away_team": "Rams",
      "home_score": 28,
      "away_score": 21,
      "status": "Final",
      "game_time": "2026-01-30T13:00:00Z"
    }
  ],
  "updated_at": "2026-01-30T10:00:00Z"
}
```

### Custom Feed (`feed_type: 'custom'`)
**Config:**
```json
{
  "url": "https://api.example.com/feed",
  "method": "GET",
  "headers": {"Authorization": "Bearer token"},
  "parser": "json",  // json, xml, rss
  "content_path": "$.items[*]"  // JSONPath for extracting content
}
```

## Implementation Plan

### Phase 1: Schema & Edge Functions
1. ✅ Create migration for feeds, feed_data, display_pages tables (`20260130200000_add_content_feeds.sql`)
2. ✅ Add dependency verification in migration
3. ✅ Add proper unique constraint for conflict resolution
4. ✅ Fix RLS policies for device access
5. ⬜ Create Edge Function: `fetch-feed-data` (scheduled or on-demand)
6. ⬜ Create Edge Function: `get-feed-content` (for device queries)
7. ⬜ Create Edge Function: `manage-feeds` (CRUD for feeds)
8. ⬜ Create Edge Function: `manage-pages` (CRUD for pages)

### Phase 2: Firmware Support
1. ⬜ Add `get_feed_content` command handler in `main.cpp`
2. ⬜ Add `get_display_pages` command handler in `main.cpp`
3. ⬜ Extend `DisplayPage` enum with FEED and CUSTOM types
4. ⬜ Extend `DisplayData` struct with feed content fields
5. ⬜ Add feed page renderer (`drawFeedPage()`) in display code
6. ⬜ Update page rotation logic to use display_pages config from database

### Phase 3: Embedded App UI
1. ⬜ Add "Feeds" tab in embedded app (`EmbeddedAppClient.tsx`)
2. ⬜ UI for creating/editing feeds (news, stocks, weather, sports)
3. ⬜ UI for configuring display pages (reorder, enable/disable)
4. ⬜ Preview feed content
5. ⬜ Test feed updates

### Phase 4: Feed Fetchers (API Integrations)
1. ⬜ News API integration (NewsAPI.org, RSS feeds)
2. ⬜ Stock API integration (Alpha Vantage, Yahoo Finance)
3. ⬜ Weather API integration (OpenWeatherMap, WeatherAPI)
4. ⬜ Sports API integration (ESPN, TheScore)
5. ⬜ Custom feed support (RSS, JSON endpoints)

## Edge Function Examples

### `fetch-feed-data/index.ts`
```typescript
// Scheduled function (runs every minute)
// Checks display.feeds for feeds needing update
// Fetches data from external APIs
// Stores in display.feed_data
```

### `get-feed-content/index.ts`
```typescript
// Called by device via command
// Returns latest valid feed_data for active feeds
// Filters by pairing_code
```

## Firmware Command Examples

### `get_feed_content`
```cpp
// Returns latest feed content for all active feeds
// Response: {
//   "feeds": [
//     {"feed_id": "...", "feed_type": "news", "content": {...}},
//     {"feed_id": "...", "feed_type": "stocks", "content": {...}}
//   ]
// }
```

### `get_display_pages`
```cpp
// Returns active pages configuration
// Response: {
//   "pages": [
//     {"page_type": "status", "display_order": 0, "duration_ms": 5000},
//     {"page_type": "feed", "feed_id": "...", "display_order": 1, "duration_ms": 10000}
//   ]
// }
```

## Benefits

1. **Extensible**: Easy to add new feed types
2. **Flexible**: JSONB config allows feed-specific settings
3. **Efficient**: Caching with TTL reduces API calls
4. **Real-time**: Realtime subscriptions for instant updates
5. **User-controlled**: Users configure their own feeds and pages
6. **Scalable**: Supports multiple feeds per pairing

## Security Considerations

1. **API Keys**: Stored encrypted in `config` JSONB (consider encryption at rest)
2. **RLS**: Row-level security ensures users only see their own feeds
3. **Rate Limiting**: Feed fetchers should respect API rate limits
4. **Input Validation**: Validate feed configs to prevent injection

## Future Enhancements

1. **Feed Templates**: Pre-configured feeds (e.g., "Tech News", "S&P 500")
2. **Feed Sharing**: Share feed configs between users
3. **Custom Parsers**: Support for RSS, XML, custom formats
4. **Feed Analytics**: Track which feeds are most viewed
5. **Smart Rotation**: AI-based page ordering based on user activity
