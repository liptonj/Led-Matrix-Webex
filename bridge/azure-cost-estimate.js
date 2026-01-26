#!/usr/bin/env node
/**
 * Azure Cost Estimator for Webex Bridge
 *
 * Calculate monthly costs for running the bridge on Azure Container Instances
 */

// Pricing (US East, as of Jan 2026)
const PRICING = {
  // Container Instance (per vCPU-second)
  cpu_per_second: 0.0000125, // $0.0000125/vCPU-second
  memory_per_second: 0.0000014, // $0.0000014/GB-second

  // Container Registry (using GitHub - FREE!)
  registry_basic: 0.0, // $0/month with GitHub Container Registry (was $5 with Azure CR)

  // Storage
  storage_per_gb: 0.05, // $0.05/GB/month

  // Azure Free Tier (per day)
  free_vcpu_seconds: 240,
  free_memory_gb_seconds: 360000,
};

function calculateCosts(cpu = 0.5, memory = 0.5, storageGB = 1) {
  const seconds_per_month = 30 * 24 * 60 * 60; // ~2.6M seconds

  // Calculate container costs
  const cpu_seconds_month = cpu * seconds_per_month;
  const memory_gb_seconds_month = memory * seconds_per_month;

  // Apply free tier (240 vCPU-seconds/day = 7200/month)
  const free_cpu_seconds_month = PRICING.free_vcpu_seconds * 30;
  const free_memory_gb_seconds_month = PRICING.free_memory_gb_seconds;

  const billable_cpu_seconds = Math.max(
    0,
    cpu_seconds_month - free_cpu_seconds_month,
  );
  const billable_memory_gb_seconds = Math.max(
    0,
    memory_gb_seconds_month - free_memory_gb_seconds_month,
  );

  const cpu_cost = billable_cpu_seconds * PRICING.cpu_per_second;
  const memory_cost = billable_memory_gb_seconds * PRICING.memory_per_second;

  const container_cost = cpu_cost + memory_cost;
  const registry_cost = PRICING.registry_basic;
  const storage_cost = storageGB * PRICING.storage_per_gb;

  const total_cost = container_cost + registry_cost + storage_cost;

  return {
    container: {
      cpu: {
        total: cpu_seconds_month,
        free: free_cpu_seconds_month,
        billable: billable_cpu_seconds,
        cost: cpu_cost,
      },
      memory: {
        total: memory_gb_seconds_month,
        free: free_memory_gb_seconds_month,
        billable: billable_memory_gb_seconds,
        cost: memory_cost,
      },
      total: container_cost,
    },
    registry: registry_cost,
    storage: storage_cost,
    total: total_cost,
    covered_by_credit: total_cost <= 100,
  };
}

// Parse command line args
const args = process.argv.slice(2);
let cpu = 0.5;
let memory = 0.5;
let storage = 1;

if (args.length >= 1) cpu = parseFloat(args[0]);
if (args.length >= 2) memory = parseFloat(args[1]);
if (args.length >= 3) storage = parseFloat(args[2]);

const costs = calculateCosts(cpu, memory, storage);

console.log("\n╔════════════════════════════════════════════════════╗");
console.log("║     Azure Cost Estimator - Webex Bridge           ║");
console.log("╚════════════════════════════════════════════════════╝\n");

console.log("Configuration:");
console.log(`  CPU:     ${cpu} vCPU`);
console.log(`  Memory:  ${memory} GB`);
console.log(`  Storage: ${storage} GB`);
console.log("");

console.log("Monthly Costs:");
console.log("┌─────────────────────────┬─────────────┐");
console.log("│ Resource                │ Cost        │");
console.log("├─────────────────────────┼─────────────┤");
console.log(
  `│ Container Instance      │ $${costs.container.total.toFixed(2).padStart(6)}    │`,
);
console.log(
  `│   CPU (${cpu} vCPU)         │ $${costs.container.cpu.cost.toFixed(2).padStart(6)}    │`,
);
console.log(
  `│   Memory (${memory} GB)      │ $${costs.container.memory.cost.toFixed(2).padStart(6)}    │`,
);
console.log(
  `│ Container Registry      │ $${costs.registry.toFixed(2).padStart(6)}    │`,
);
console.log(
  `│ File Storage (${storage} GB)   │ $${costs.storage.toFixed(2).padStart(6)}    │`,
);
console.log("├─────────────────────────┼─────────────┤");
console.log(
  `│ Total                   │ $${costs.total.toFixed(2).padStart(6)}    │`,
);
console.log("└─────────────────────────┴─────────────┘");
console.log("");

console.log("Azure Free Tier Applied:");
console.log(
  `  CPU:    ${costs.container.cpu.free.toLocaleString()} seconds/month FREE`,
);
console.log(
  `  Memory: ${costs.container.memory.free.toLocaleString()} GB-seconds/month FREE`,
);
console.log("");

if (costs.covered_by_credit) {
  console.log("✅ Covered by $100 Azure developer credit");
  console.log(`   Remaining: $${(100 - costs.total).toFixed(2)}/month`);
} else {
  console.log("⚠️  Exceeds $100 developer credit");
  console.log(`   Additional cost: $${(costs.total - 100).toFixed(2)}/month`);
}

console.log("");
console.log("Usage:");
console.log("  node azure-cost-estimate.js [cpu] [memory] [storage]");
console.log("  Examples:");
console.log("    node azure-cost-estimate.js 0.5 0.5 1   # Current config");
console.log("    node azure-cost-estimate.js 1 1 1       # Double resources");
console.log("    node azure-cost-estimate.js 0.25 0.25 1 # Half resources");
console.log("");
