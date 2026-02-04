# Self-Hosted Runner Cache Optimization

## Overview

The self-hosted runners now use persistent Docker volumes to cache build dependencies, significantly reducing build times.

## Cache Volumes

The following persistent volumes are shared across all 7 runners:

| Volume Name | Purpose | Typical Size |
|------------|---------|--------------|
| `led-matrix-cache-platformio` | PlatformIO toolchains, packages, and platforms | ~2-3 GB |
| `led-matrix-cache-pip` | Python pip packages | ~500 MB |
| `led-matrix-cache-npm` | NPM packages for website builds | ~1 GB |
| `led-matrix-cache-pnpm` | PNPM packages (alternative to NPM) | ~800 MB |

## Expected Performance Improvements

### Before Caching
- **First build**: 8-12 minutes per board (downloads all toolchains)
- **Subsequent builds**: 8-12 minutes per board (re-downloads every time)
- **Total for 3 boards**: 24-36 minutes

### After Caching
- **First build**: 8-12 minutes per board (downloads and caches toolchains)
- **Subsequent builds**: 2-4 minutes per board (uses cached toolchains)
- **Total for 3 boards**: 6-12 minutes

**Expected speedup: 4-6x faster on subsequent builds**

## Applying the Changes

### 1. Update Docker Compose Configuration

The updated `docker-compose.yml` includes:
- Persistent volume mounts for cache directories
- Environment variables pointing to cache locations
- Named volumes for easy management

### 2. Restart Runners

```bash
cd .github/docker

# Stop all runners
docker-compose down

# Pull latest changes
git pull

# Rebuild and start with new cache configuration
docker-compose up -d --build

# Verify runners are healthy
docker-compose ps
docker-compose logs -f runner-1
```

### 3. Verify Cache is Working

After the first build completes, check cache volumes:

```bash
# List volumes
docker volume ls | grep led-matrix-cache

# Inspect PlatformIO cache size
docker volume inspect led-matrix-cache-platformio

# Check what's cached (example for runner-1)
docker exec led-matrix-runner-1 ls -lh /root/.platformio/packages
```

## Cache Management

### View Cache Sizes

```bash
# All cache volumes
docker system df -v | grep led-matrix-cache

# Specific cache
docker volume inspect led-matrix-cache-platformio | jq '.[].Mountpoint'
```

### Clear Cache (if needed)

**Warning**: This will force a full rebuild on next run.

```bash
# Stop runners first
docker-compose down

# Remove specific cache
docker volume rm led-matrix-cache-platformio

# Remove all caches
docker volume rm led-matrix-cache-platformio led-matrix-cache-pip led-matrix-cache-npm led-matrix-cache-pnpm

# Restart runners (caches will be recreated)
docker-compose up -d
```

### Prune Old Cache (keeps recent)

GitHub Actions cache also maintains its own cache layer:

```bash
# The actions/cache@v4 in workflows handles this automatically
# It uses LRU (Least Recently Used) eviction when cache exceeds 10GB total
```

## Troubleshooting

### Builds Still Slow?

1. **Check if volumes are mounted**:
   ```bash
   docker inspect led-matrix-runner-1 | jq '.[].Mounts'
   ```

2. **Verify PlatformIO is using cache**:
   ```bash
   docker exec led-matrix-runner-1 env | grep PLATFORMIO_CORE_DIR
   ```
   Should show: `/root/.platformio`

3. **Check for permission issues**:
   ```bash
   docker exec led-matrix-runner-1 ls -la /root/.platformio
   ```

### Cache Not Persisting?

- Ensure `RUN_AS_ROOT: "true"` is set (so cache dirs are always `/root/...`)
- Check that volumes weren't removed: `docker volume ls`
- Verify docker-compose.yml has volume definitions at the bottom

### Disk Space Issues?

```bash
# Check available space
df -h

# Find large cache files
docker exec led-matrix-runner-1 du -sh /root/.platformio/*

# Clean up old PlatformIO packages (safe, will re-download if needed)
docker exec led-matrix-runner-1 pio system prune
```

## Advanced: Per-Runner Caches

If you need isolated caches per runner (not recommended):

```yaml
services:
  runner-1:
    volumes:
      - runner-1-pio:/root/.platformio

volumes:
  runner-1-pio:
    name: led-matrix-runner-1-pio
```

**Note**: Shared caches are more efficient as they reduce total storage and all runners benefit from any cache.

## Monitoring Build Performance

Track build times in GitHub Actions:

```bash
# View recent firmware build times
gh run list --workflow=firmware.yml --limit 10 --json conclusion,startedAt,createdAt,updatedAt
```

Expected results after caching:
- ✅ Matrix generation: ~20s (unchanged)
- ✅ Unit tests: ~2-3m (down from ~5m)
- ✅ ESP32-S3 build: ~2-3m (down from ~8-10m)
- ✅ ESP32-S2 build: ~2-3m (down from ~8-10m)
- ✅ ESP32 build: ~2-3m (down from ~8-10m)
- ✅ Total: ~10-15m (down from ~30-40m)

## Files Modified

- `.github/docker/docker-compose.yml` - Added persistent cache volumes
- `.github/workflows/firmware.yml` - Added cache action with proper keys
- `.github/docker/CACHE_OPTIMIZATION.md` - This documentation

## Next Steps

1. Apply the changes: `docker-compose up -d --build`
2. Trigger a build: `git tag v2.2.1 && git push origin v2.2.1`
3. Monitor first build (will be slow - caching)
4. Trigger another build (should be 4-6x faster)
5. Celebrate faster CI! 🎉
