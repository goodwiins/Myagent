#!/usr/bin/env node

/**
 * GoodFlows Post-Install Script
 * Runs after npm/bun install to set up the package
 */

import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, '..');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  bold: '\x1b[1m',
};

console.log(`
${colors.bold}${colors.cyan}GoodFlows${colors.reset} - AI Code Review Automation Suite
`);

// Create agents directory if it doesn't exist
const agentsDir = join(PACKAGE_ROOT, 'agents');
if (!existsSync(agentsDir)) {
  mkdirSync(agentsDir, { recursive: true });
}

// Move agent files to agents/ directory if they're in root
const agentFiles = [
  'review-orchestrator.md',
  'issue-creator.md',
  'coderabbit-auto-fixer.md',
];

for (const file of agentFiles) {
  const rootPath = join(PACKAGE_ROOT, file);
  const agentPath = join(agentsDir, file);

  if (existsSync(rootPath) && !existsSync(agentPath)) {
    copyFileSync(rootPath, agentPath);
  }
}

console.log(`${colors.green}Installation complete!${colors.reset}

${colors.bold}Quick Start:${colors.reset}

1. Install agents for your CLI:
   ${colors.cyan}npx goodflows install${colors.reset}
   ${colors.cyan}npx goodflows install --cli cursor${colors.reset}

2. Set environment variables:
   ${colors.cyan}export LINEAR_API_KEY="your-key"${colors.reset}
   ${colors.cyan}export ANTHROPIC_API_KEY="your-key"${colors.reset}

3. Start using:
   ${colors.cyan}> review and track my changes${colors.reset}

For more info: ${colors.cyan}npx goodflows help${colors.reset}
`);