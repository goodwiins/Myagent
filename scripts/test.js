#!/usr/bin/env node

/**
 * GoodFlows Test Script
 * Validates agent files and configuration
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, '..');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  bold: '\x1b[1m',
};

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`${colors.green}✓${colors.reset} ${name}`);
    passed++;
  } else {
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    failed++;
  }
}

function testFileContains(file, pattern, testName) {
  try {
    const content = readFileSync(file, 'utf-8');
    test(testName, content.includes(pattern) || new RegExp(pattern).test(content));
  } catch {
    test(testName, false);
  }
}

console.log(`\n${colors.bold}GoodFlows Test Suite${colors.reset}\n`);

// Test agent files exist
const agentFiles = [
  'review-orchestrator.md',
  'issue-creator.md',
  'coderabbit-auto-fixer.md',
];

console.log('Agent Files:');
for (const file of agentFiles) {
  const agentPath = join(PACKAGE_ROOT, 'agents', file);
  const rootPath = join(PACKAGE_ROOT, file);
  test(`  ${file} exists`, existsSync(agentPath) || existsSync(rootPath));
}

// Test MCP tool naming
console.log('\nMCP Tool Configuration:');
for (const file of agentFiles) {
  const agentPath = join(PACKAGE_ROOT, 'agents', file);
  const rootPath = join(PACKAGE_ROOT, file);
  const path = existsSync(agentPath) ? agentPath : rootPath;

  if (existsSync(path)) {
    testFileContains(path, 'mcp__plugin_serena_serena__', `  ${file}: Correct Serena tool naming`);
    testFileContains(path, 'mcp__plugin_linear_linear__', `  ${file}: Correct Linear tool naming`);
  }
}

// Test frontmatter
console.log('\nAgent Frontmatter:');
for (const file of agentFiles) {
  const agentPath = join(PACKAGE_ROOT, 'agents', file);
  const rootPath = join(PACKAGE_ROOT, file);
  const path = existsSync(agentPath) ? agentPath : rootPath;

  if (existsSync(path)) {
    testFileContains(path, 'name:', `  ${file}: Has name field`);
    testFileContains(path, 'model:', `  ${file}: Has model field`);
    testFileContains(path, 'triggers:', `  ${file}: Has triggers field`);
  }
}

// Test error handling sections
console.log('\nError Handling:');
for (const file of agentFiles) {
  const agentPath = join(PACKAGE_ROOT, 'agents', file);
  const rootPath = join(PACKAGE_ROOT, file);
  const path = existsSync(agentPath) ? agentPath : rootPath;

  if (existsSync(path)) {
    testFileContains(path, 'Error Handling', `  ${file}: Has error handling section`);
  }
}

// Test package.json
console.log('\nPackage Configuration:');
test('  package.json exists', existsSync(join(PACKAGE_ROOT, 'package.json')));
test('  bin/goodflows.js exists', existsSync(join(PACKAGE_ROOT, 'bin', 'myagent.js')) || existsSync(join(PACKAGE_ROOT, 'bin', 'goodflows.js')));

// Test documentation
console.log('\nDocumentation:');
test('  README.md exists', existsSync(join(PACKAGE_ROOT, 'README.md')));
test('  CLAUDE.md exists', existsSync(join(PACKAGE_ROOT, 'CLAUDE.md')));

// Summary
console.log(`
${colors.bold}Results:${colors.reset} ${colors.green}${passed} passed${colors.reset}, ${failed > 0 ? colors.red : ''}${failed} failed${colors.reset}
`);

process.exit(failed > 0 ? 1 : 0);