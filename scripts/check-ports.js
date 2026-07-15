#!/usr/bin/env node
/**
 * Port Registry Checker
 * Validates that all configured ports are available before startup
 * Run before launching HYDI services
 */

const net = require('net');
const fs = require('fs');
const path = require('path');

const PORTS_CONFIG = require('../.ports.json');

// Color output
const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

/**
 * Try to open a TCP connection — success means something is listening.
 */
function canConnect(port, host) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
    socket.connect(port, host);
  });
}

/**
 * Try to bind exclusively — on Windows a plain bind to one address can
 * succeed even while another process listens on the wildcard address,
 * so `exclusive: true` (SO_EXCLUSIVEADDRUSE) is required for a real test.
 */
function canBind(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen({ port, host, exclusive: true });
  });
}

/**
 * Check if a port is in use: a live listener on loopback (IPv4 or IPv6)
 * counts, and so does anything that blocks an exclusive wildcard bind
 * (e.g. a service bound only to a LAN/Tailscale interface).
 */
async function isPortInUse(port) {
  if (await canConnect(port, '127.0.0.1')) return true;
  if (await canConnect(port, '::1')) return true;
  if (!(await canBind(port, '0.0.0.0'))) return true;
  return false;
}

/**
 * Check all ports and report status
 */
async function checkAllPorts() {
  console.log(`\n${colors.cyan('🔍 HYDI Port Registry Check')}\n`);
  console.log(`Registry file: ${path.resolve('.ports.json')}\n`);

  const services = PORTS_CONFIG.services;
  const results = [];
  let available = 0;
  let conflicts = 0;

  // Check each port
  for (const [key, config] of Object.entries(services)) {
    // Skip external services (already running elsewhere)
    if (config.external) {
      console.log(`  ${colors.cyan('ℹ External')}  Port ${config.port.toString().padEnd(5)} — ${config.name}`);
      continue;
    }

    const inUse = await isPortInUse(config.port);
    const status = inUse
      ? colors.red(`✗ IN USE`)
      : colors.green(`✓ Available`);

    console.log(`  ${status}  Port ${config.port.toString().padEnd(5)} — ${config.name}`);
    if (inUse) console.log(`           ${colors.yellow('⚠ ' + config.description)}`);

    results.push({
      key,
      port: config.port,
      name: config.name,
      inUse,
    });

    if (inUse) conflicts++;
    else available++;
  }

  // Summary
  console.log(`\n${colors.cyan('📊 Summary')}`);
  console.log(`  Available: ${colors.green(available)}`);
  console.log(`  In use:    ${conflicts > 0 ? colors.red(conflicts) : colors.green('0')}\n`);

  // If conflicts, show how to resolve
  if (conflicts > 0) {
    console.log(colors.yellow('⚠️  Conflicts detected. To resolve:'));
    console.log('');
    for (const result of results) {
      if (result.inUse) {
        const config = services[result.key];
        console.log(`  1. Kill process on port ${result.port}:`);
        console.log(`     Windows: netstat -ano | findstr :${result.port}`);
        console.log(`             taskkill /PID <PID> /F`);
        console.log(`     Linux:   lsof -i :${result.port} | awk 'NR==2 {print $2}' | xargs kill -9`);
        console.log('');
        console.log(`  2. Or change ${config.name} port in .env:`);
        console.log(`     ${config.env_var}=${result.port + 1}`);
        console.log('');
      }
    }

    process.exit(1);
  }

  console.log(colors.green('✅ All ports available. Ready to start services.\n'));
  process.exit(0);
}

// Run
checkAllPorts().catch((err) => {
  console.error(colors.red('❌ Port check failed:'), err.message);
  process.exit(1);
});
