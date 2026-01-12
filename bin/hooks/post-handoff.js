#!/usr/bin/env node

/**
 * Post-Handoff Hook
 *
 * Runs after a context import/handoff is received.
 * - Verifies environment matches expectations
 * - Checks for missing dependencies
 */

import { execSync } from 'child_process';

function checkNodeModules() {
  try {
    execSync('npm list --depth=0', { stdio: 'ignore' });
  } catch {
    console.warn('⚠️  Warning: Node modules may be out of sync or missing. Run `npm install`.');
  }
}

console.log('🔄 Running post-handoff verification...');
checkNodeModules();
console.log('✅ Verification complete.');
