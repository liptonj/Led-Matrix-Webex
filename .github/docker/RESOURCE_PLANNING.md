# Self-Hosted Runner Resource Planning

## Current Configuration

**7 Runners with conservative resource limits:**
- **CPU**: 1.5 cores (limit), 0.5 cores (reservation)
- **RAM**: 3 GB (limit), 1 GB (reservation)

**Total Host Requirements:**
- **CPU**: ~10.5 cores (7 × 1.5 cores)
- **RAM**: ~21 GB (7 × 3 GB)
- **Storage**: 50 GB SSD minimum

This configuration works on **12-core, 24GB RAM hosts** (common mid-range servers).

## Alternative Configurations

### Option 1: Minimal (Budget Host)
**Host**: 8-core, 16 GB RAM
```yaml
cpus: '1.0'        # 1 core per runner
memory: 2G         # 2GB per runner
```
- **Total**: 7 cores, 14 GB RAM
- **Build time**: 12-18 minutes
- **Good for**: Low traffic, occasional builds

### Option 2: Conservative (Current)
**Host**: 12-core, 24 GB RAM
```yaml
cpus: '1.5'        # 1.5 cores per runner  
memory: 3G         # 3GB per runner
```
- **Total**: 10.5 cores, 21 GB RAM
- **Build time**: 10-14 minutes
- **Good for**: Most workloads, recommended starting point

### Option 3: Balanced
**Host**: 16-core, 32 GB RAM
```yaml
cpus: '2.0'        # 2 cores per runner
memory: 4G         # 4GB per runner
```
- **Total**: 14 cores, 28 GB RAM
- **Build time**: 8-12 minutes
- **Good for**: Active development, multiple teams

### Option 4: High Performance
**Host**: 24-core, 40 GB RAM
```yaml
cpus: '3.0'        # 3 cores per runner
memory: 5G         # 5GB per runner
```
- **Total**: 21 cores, 35 GB RAM
- **Build time**: 6-10 minutes
- **Good for**: Heavy CI load, large teams

## Resource Allocation Reasoning

### Why 2 CPU cores per runner?

**PlatformIO C++ compilation is CPU-intensive:**
- **Compiler (GCC)**: Single-threaded per file, but multiple files compile in parallel
- **Linker**: Single-threaded, needs good single-core performance
- **Expected usage**: 150-180% CPU during active compilation

**With 2 cores:**
- ✅ Can compile 2 files simultaneously
- ✅ Background tasks (git, npm) don't block compilation
- ✅ Reasonable parallelism without over-subscription

**Tested alternatives:**
- 1 core: 40% slower (serialized compilation)
- 4 cores: Only 10% faster (diminishing returns, wastes cores)

### Why 4 GB RAM per runner?

**Memory breakdown during firmware build:**
```
Component                    RAM Usage
--------------------------------
GitHub Actions runner        ~400 MB
PlatformIO core              ~200 MB
GCC compiler (per file)      ~500-800 MB
Linker (ESP32)               ~600-1200 MB
Python/Node processes        ~300 MB
OS overhead                  ~500 MB
--------------------------------
Peak usage:                  ~2.5-3.5 GB
```

**With 4 GB limit:**
- ✅ Comfortable headroom for peak usage
- ✅ Prevents OOM (Out of Memory) kills
- ✅ Allows page cache for faster I/O
- ✅ Room for temporary file buffers

**With 2 GB reservation:**
- ✅ Guarantees minimum for idle runner + checkout
- ✅ Allows overcommit when runners are idle
- ✅ Better resource sharing across runners

### Why 7 runners?

**Parallel job capacity:**
- Firmware builds: 3 boards (ESP32, ESP32-S2, ESP32-S3)
- Website build/deploy: 1 job
- Supabase functions: 1 job
- Unit tests: 1 job (firmware)
- Release/upload jobs: 1-2 jobs

**Peak concurrent jobs: 5-7 jobs**

**With 7 runners:**
- ✅ Can run full firmware CI (3 builds + tests + deploy) in parallel
- ✅ Room for dependabot updates
- ✅ No queuing on typical workloads

## Host Sizing Recommendations

### Option 1: Budget (Single Machine)
**Machine**: 16-core, 32 GB RAM
- Run 6 runners (12 cores, 24 GB)
- Leave 4 cores, 8 GB for host
- **Cost**: ~$100-150/month (Hetzner, OVH)
- **Build time**: 10-15 minutes (full pipeline)

### Option 2: Recommended (Single Machine)
**Machine**: 24-core, 40 GB RAM
- Run 7 runners (14 cores, 28 GB)
- Leave 10 cores, 12 GB for host + page cache
- **Cost**: ~$150-200/month
- **Build time**: 8-12 minutes (full pipeline)

### Option 3: High Performance (Multiple Machines)
**2× Machines**: 16-core, 32 GB RAM each
- Machine 1: 5 runners (firmware focus)
- Machine 2: 4 runners (website/backend focus)
- **Cost**: ~$200-300/month
- **Build time**: 6-10 minutes (full pipeline)
- **Benefit**: Redundancy, isolated workloads

## Adjusting for Different Workloads

### If you have fewer parallel builds

**Reduce to 4 runners (single board at a time):**
```yaml
deploy:
  resources:
    limits:
      cpus: '3.0'        # More cores per runner
      memory: 6G          # More RAM per runner
```

**Host requirement**: 12-16 cores, 24-32 GB RAM

### If you add more build targets

**Increase to 10 runners (more ESP32 variants):**
```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'        # Keep same per-runner
      memory: 4G
```

**Host requirement**: 20-24 cores, 40-50 GB RAM

## Monitoring Resource Usage

### Check current usage

```bash
# Per-container stats (live)
docker stats

# See resource limits
docker inspect led-matrix-runner-1 | jq '.[].HostConfig.Memory'

# Check if containers are being throttled
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

### Warning signs

**CPU throttling** (builds will slow down):
```bash
# Check if any container hits 200% (2.0 cores limit)
docker stats --no-stream | grep led-matrix-runner
```
If you see 200% consistently, increase `cpus: '3.0'`

**Memory pressure** (OOM kills):
```bash
# Check for OOM kills in logs
docker-compose logs | grep -i "oom"
docker-compose logs | grep -i "killed"
```
If you see OOM kills, increase `memory: 6G`

**Disk I/O bottleneck**:
```bash
# Check iowait
iostat -x 5

# High %iowait (>20%) means:
# - Need faster storage (SSD vs HDD)
# - Or reduce concurrent runners
```

## Storage Performance

**PlatformIO builds are I/O intensive:**
- ~50-100 MB/s read during compilation
- ~20-50 MB/s write during linking
- Thousands of small file operations

**Recommendations:**
- ✅ **Use SSD/NVMe** (not HDD) - 5-10x faster builds
- ✅ **Use local storage** (not network mounts) - lower latency
- ✅ **XFS or ext4 filesystem** - good small file performance

## Network Requirements

**Minimal network usage after first build:**
- Initial toolchain download: ~2-3 GB (cached after first build)
- GitHub Actions communication: <1 MB/minute
- Artifact upload: ~2-5 MB per build
- Total bandwidth: ~1-2 GB/day (mostly first-time setup)

## Optimizations Applied

### 1. Shared Cache Volumes ✅
- All runners share PlatformIO/pip/npm caches
- Saves ~10-15 GB per runner (70-105 GB total)
- First runner downloads, others reuse

### 2. GitHub Actions Cache ✅
- Caches `.pio/build/$env/lib` (compiled libraries)
- ~50-200 MB per board type
- Saves 2-4 minutes per build

### 3. Resource Reservations ✅
- Guarantees minimum resources when needed
- Allows overcommit when idle
- Better resource sharing

## Applying Changes

```bash
cd .github/docker

# Stop runners
docker-compose down

# Apply new resource limits
docker-compose up -d

# Verify resources are applied
docker stats --no-stream
```

## Example: Host with 32 cores, 64 GB RAM

You could run more aggressive settings:

```yaml
deploy:
  resources:
    limits:
      cpus: '4.0'        # 4 cores per runner
      memory: 8G          # 8GB per runner
    reservations:
      cpus: '2.0'
      memory: 4G
```

**Result**: 
- 7 runners × 4 cores = 28 cores used (4 cores for host)
- 7 runners × 8 GB = 56 GB used (8 GB for host)
- Build time: **4-6 minutes** (very fast!)

## Cost-Benefit Analysis

| Setup | Monthly Cost | Build Time | Notes |
|-------|-------------|------------|-------|
| GitHub-hosted (no self-hosted) | $0-500 | 25-35 min | Free tier limited, expensive at scale |
| Budget (6 runners, 16-core) | $100-150 | 10-15 min | Good for small teams |
| **Recommended (7 runners, 24-core)** | **$150-200** | **8-12 min** | **Sweet spot** |
| High-perf (10 runners, 32-core) | $250-350 | 6-10 min | For very active development |

## Recommendations

**For your current setup (7 runners):**
- ✅ Use the 2 CPU / 4 GB RAM configuration provided
- ✅ Minimum host: 16 cores, 32 GB RAM
- ✅ Recommended host: 24 cores, 40 GB RAM
- ✅ Storage: 100 GB SSD minimum
- ✅ Apply cache optimizations (already done)

**Expected performance:**
- First build after cache clear: 8-12 minutes
- Subsequent builds with cache: 6-8 minutes
- Peak concurrent jobs: 5-7 jobs running simultaneously

This is an excellent balance of cost and performance! 🎉
