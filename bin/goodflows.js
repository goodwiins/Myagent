#!/usr/bin/env node

/**
 * GoodFlows CLI
 * AI-powered code review automation with CodeRabbit, Linear, and Claude
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { ContextStore } from '../lib/context-store.js';
import { PatternTracker } from '../lib/pattern-tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, '..');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}[WARNING]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`),
};

// CLI configurations for different tools
const CLI_CONFIGS = {
  claude: {
    name: 'Claude Code',
    localDir: '.claude',
    globalDir: join(homedir(), '.claude'),
    agentsSubdir: 'agents',
    configFile: 'settings.json',
  },
  cursor: {
    name: 'Cursor',
    localDir: '.cursor',
    globalDir: join(homedir(), '.cursor'),
    agentsSubdir: 'agents',
    configFile: 'agents.json',
  },
  continue: {
    name: 'Continue.dev',
    localDir: '.continue',
    globalDir: join(homedir(), '.continue'),
    agentsSubdir: 'agents',
    configFile: 'config.json',
  },
  aider: {
    name: 'Aider',
    localDir: '.aider',
    globalDir: join(homedir(), '.aider'),
    agentsSubdir: 'agents',
    configFile: '.aider.conf.yml',
  },
  windsurf: {
    name: 'Windsurf',
    localDir: '.windsurf',
    globalDir: join(homedir(), '.windsurf'),
    agentsSubdir: 'agents',
    configFile: 'agents.json',
  },
};

// Agent files to install
const AGENT_FILES = [
  'review-orchestrator.md',
  'issue-creator.md',
  'coderabbit-auto-fixer.md',
];

// Parse command line arguments
function parseArgs(args) {
  const options = {
    command: 'help',
    cli: 'claude',
    global: false,
    verbose: false,
    subcommand: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case 'install':
      case 'uninstall':
      case 'init':
      case 'list':
      case 'help':
      case 'version':
      case 'context':
      case 'migrate':
      case 'stats':
        options.command = arg;
        break;
      case 'add':
      case 'query':
      case 'export':
      case 'clear':
        options.subcommand = arg;
        break;
      case '--cli':
      case '-c':
        options.cli = args[++i] || 'claude';
        break;
      case '--global':
      case '-g':
        options.global = true;
        break;
      case '--local':
      case '-l':
        options.global = false;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        options.command = 'help';
        break;
      case '--version':
        options.command = 'version';
        break;
    }
  }

  return options;
}

// ASCII Art Logo
function showLogo() {
  console.log(`
${colors.cyan}${colors.bold}
   ██████╗  ██████╗  ██████╗ ██████╗ ███████╗██╗      ██████╗ ██╗    ██╗███████╗
  ██╔════╝ ██╔═══██╗██╔═══██╗██╔══██╗██╔════╝██║     ██╔═══██╗██║    ██║██╔════╝
  ██║  ███╗██║   ██║██║   ██║██║  ██║█████╗  ██║     ██║   ██║██║ █╗ ██║███████╗
  ██║   ██║██║   ██║██║   ██║██║  ██║██╔══╝  ██║     ██║   ██║██║███╗██║╚════██║
  ╚██████╔╝╚██████╔╝╚██████╔╝██████╔╝██║     ███████╗╚██████╔╝╚███╔███╔╝███████║
   ╚═════╝  ╚═════╝  ╚═════╝ ╚═════╝ ╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝
${colors.reset}
  ${colors.magenta}AI Code Review Automation Suite${colors.reset}
`);
}

// Show help message
function showHelp() {
  showLogo();
  console.log(`
${colors.bold}USAGE:${colors.reset}
  goodflows <command> [options]

${colors.bold}COMMANDS:${colors.reset}
  install     Install agents for a CLI tool
  uninstall   Remove installed agents
  init        Initialize configuration in current directory
  list        List available agents
  context     Manage context storage (query, export, clear)
  migrate     Migrate from legacy markdown memories
  stats       Show context storage statistics
  help        Show this help message
  version     Show version information

${colors.bold}OPTIONS:${colors.reset}
  -c, --cli <name>    Target CLI: claude, cursor, continue, aider, windsurf
  -g, --global        Install globally (to ~/.config/)
  -l, --local         Install locally to current project (default)
  -v, --verbose       Enable verbose output

${colors.bold}EXAMPLES:${colors.reset}
  ${colors.cyan}goodflows install${colors.reset}                    # Install for Claude Code (local)
  ${colors.cyan}goodflows install --global${colors.reset}           # Install for Claude Code (global)
  ${colors.cyan}goodflows install --cli cursor${colors.reset}       # Install for Cursor
  ${colors.cyan}goodflows install --cli continue -g${colors.reset}  # Install for Continue.dev (global)
  ${colors.cyan}goodflows uninstall${colors.reset}                  # Remove installation
  ${colors.cyan}goodflows init${colors.reset}                       # Initialize config
  ${colors.cyan}goodflows context query --type bug${colors.reset}   # Query findings by type
  ${colors.cyan}goodflows context export${colors.reset}             # Export to markdown
  ${colors.cyan}goodflows migrate${colors.reset}                    # Migrate legacy memories
  ${colors.cyan}goodflows stats${colors.reset}                      # Show storage statistics

${colors.bold}SUPPORTED CLIs:${colors.reset}
  ${colors.green}•${colors.reset} Claude Code (claude)  - Default
  ${colors.green}•${colors.reset} Cursor (cursor)
  ${colors.green}•${colors.reset} Continue.dev (continue)
  ${colors.green}•${colors.reset} Aider (aider)
  ${colors.green}•${colors.reset} Windsurf (windsurf)

${colors.bold}AFTER INSTALLATION:${colors.reset}
  Set environment variables:
    ${colors.cyan}export LINEAR_API_KEY="your-linear-api-key"${colors.reset}
    ${colors.cyan}export ANTHROPIC_API_KEY="your-anthropic-api-key"${colors.reset}

  Then use in your CLI:
    ${colors.cyan}> review and track my changes${colors.reset}
    ${colors.cyan}> /fix-linear GOO-31${colors.reset}
`);
}

// Show version
function showVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'));
    console.log(`${colors.cyan}GoodFlows${colors.reset} v${pkg.version}`);
  } catch {
    console.log(`${colors.cyan}GoodFlows${colors.reset} v1.0.0`);
  }
}

// List available agents
function listAgents() {
  showLogo();
  console.log(`${colors.bold}Available Agents:${colors.reset}\n`);

  const agents = [
    {
      name: 'review-orchestrator',
      model: 'Sonnet',
      color: 'cyan',
      description: 'Orchestrates complete code review workflow',
      triggers: ['review and track', 'run coderabbit', 'full code review'],
    },
    {
      name: 'issue-creator',
      model: 'Haiku',
      color: 'blue',
      description: 'Creates structured Linear issues from findings',
      triggers: ['create Linear issues', 'track in Linear'],
    },
    {
      name: 'coderabbit-auto-fixer',
      model: 'Opus',
      color: 'orange',
      description: 'Safely applies and verifies code fixes',
      triggers: ['/fix-linear <id>', 'auto-fix issue'],
    },
  ];

  for (const agent of agents) {
    console.log(`${colors.cyan}${colors.bold}${agent.name}${colors.reset} ${colors.yellow}(${agent.model})${colors.reset}`);
    console.log(`  ${agent.description}`);
    console.log(`  ${colors.blue}Triggers:${colors.reset} ${agent.triggers.join(', ')}`);
    console.log();
  }
}

// Create directory if it doesn't exist
function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Get install directory based on CLI and mode
function getInstallDir(cli, global) {
  const config = CLI_CONFIGS[cli];
  if (!config) {
    throw new Error(`Unknown CLI: ${cli}. Supported: ${Object.keys(CLI_CONFIGS).join(', ')}`);
  }

  const baseDir = global ? config.globalDir : config.localDir;
  return {
    base: baseDir,
    agents: join(baseDir, config.agentsSubdir),
    config: config.configFile,
    name: config.name,
  };
}

// Create CLI-specific configuration
function createCliConfig(cli, installDir) {
  const configPath = join(installDir.base, installDir.config);

  const configs = {
    claude: {
      agents: {
        'review-orchestrator': { enabled: true },
        'issue-creator': { enabled: true },
        'coderabbit-auto-fixer': { enabled: true },
      },
      memory: { enabled: true, path: '.serena/memories' },
    },
    cursor: {
      version: '1.0',
      agents: AGENT_FILES.map((f) => ({
        name: f.replace('.md', ''),
        file: `agents/${f}`,
      })),
    },
    continue: {
      customCommands: [
        { name: 'review', description: 'Run code review workflow' },
        { name: 'fix-linear', description: 'Fix a Linear issue' },
      ],
    },
    windsurf: {
      version: '1.0',
      agents: AGENT_FILES.map((f) => ({
        name: f.replace('.md', ''),
        file: `agents/${f}`,
      })),
    },
    aider: `# GoodFlows Aider Configuration
model: claude-3-5-sonnet-20241022
prompts-dir: agents/
auto-commits: false
`,
  };

  const content = configs[cli];
  if (cli === 'aider') {
    writeFileSync(configPath, content);
  } else {
    writeFileSync(configPath, JSON.stringify(content, null, 2));
  }

  return configPath;
}

// Install agents
function install(options) {
  const { cli, global, verbose } = options;

  showLogo();
  log.info(`Installing GoodFlows for ${CLI_CONFIGS[cli]?.name || cli}...`);

  try {
    const installDir = getInstallDir(cli, global);

    // Create directories
    ensureDir(installDir.agents);
    if (verbose) log.info(`Created directory: ${installDir.agents}`);

    // Copy agent files
    const agentsSourceDir = join(PACKAGE_ROOT, 'agents');

    for (const file of AGENT_FILES) {
      let sourcePath = join(agentsSourceDir, file);

      // Check if source exists, if not try root directory
      if (!existsSync(sourcePath)) {
        sourcePath = join(PACKAGE_ROOT, file);
      }

      const destPath = join(installDir.agents, file);

      if (existsSync(sourcePath)) {
        copyFileSync(sourcePath, destPath);
        if (verbose) log.info(`Copied: ${file}`);
      } else {
        log.warning(`Agent file not found: ${file}`);
      }
    }

    // Create CLI configuration
    const configPath = createCliConfig(cli, installDir);
    if (verbose) log.info(`Created config: ${configPath}`);

    // Create memory directories
    const memoryDir = global
      ? join(homedir(), '.serena', 'memories')
      : join('.serena', 'memories');
    ensureDir(memoryDir);

    // Initialize memory files
    const findingsPath = join(memoryDir, 'coderabbit_findings.md');
    if (!existsSync(findingsPath)) {
      writeFileSync(findingsPath, '# CodeRabbit Findings Log\n\n');
    }

    const patternsPath = join(memoryDir, 'auto_fix_patterns.md');
    if (!existsSync(patternsPath)) {
      writeFileSync(patternsPath, '# Auto-Fix Patterns\n\n');
    }

    log.success('Installation complete!');
    console.log(`
${colors.bold}Next steps:${colors.reset}

1. Set environment variables:
   ${colors.cyan}export LINEAR_API_KEY="your-linear-api-key"${colors.reset}
   ${colors.cyan}export ANTHROPIC_API_KEY="your-anthropic-api-key"${colors.reset}

2. Start using the agents in ${CLI_CONFIGS[cli].name}:
   ${colors.cyan}> review and track my changes${colors.reset}
   ${colors.cyan}> /fix-linear GOO-31${colors.reset}
`);
  } catch (error) {
    log.error(`Installation failed: ${error.message}`);
    process.exit(1);
  }
}

// Uninstall agents
function uninstall(options) {
  const { cli, global, verbose } = options;

  log.info(`Uninstalling GoodFlows from ${CLI_CONFIGS[cli]?.name || cli}...`);

  try {
    const installDir = getInstallDir(cli, global);

    // Remove agent files
    for (const file of AGENT_FILES) {
      const filePath = join(installDir.agents, file);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        if (verbose) log.info(`Removed: ${file}`);
      }
    }

    // Remove config file
    const configPath = join(installDir.base, installDir.config);
    if (existsSync(configPath)) {
      unlinkSync(configPath);
      if (verbose) log.info(`Removed: ${installDir.config}`);
    }

    log.success('Uninstallation complete!');
  } catch (error) {
    log.error(`Uninstallation failed: ${error.message}`);
    process.exit(1);
  }
}

// Initialize configuration
function init(options = {}) {
  const { verbose } = options;
  showLogo();
  log.info('Initializing GoodFlows configuration...');

  try {
    // Create local directories
    ensureDir('.claude/agents');
    ensureDir('.serena/memories');

    // Copy config.json
    const configSource = join(PACKAGE_ROOT, 'config.json');
    if (existsSync(configSource)) {
      copyFileSync(configSource, 'goodflows.config.json');
    } else {
      // Create default config
      writeFileSync('goodflows.config.json', JSON.stringify({
        team: { name: 'YOUR_TEAM', prefix: 'GOO' },
        review: { autoFix: false, groupByFile: true },
        memory: { enabled: true, path: '.serena/memories' },
      }, null, 2));
    }

    // Copy CLAUDE.md
    const claudeSource = join(PACKAGE_ROOT, 'CLAUDE.md');
    if (existsSync(claudeSource)) {
      copyFileSync(claudeSource, 'CLAUDE.md');
    }

    // Initialize legacy memory files
    writeFileSync('.serena/memories/coderabbit_findings.md', '# CodeRabbit Findings Log\n\n');
    writeFileSync('.serena/memories/auto_fix_patterns.md', '# Auto-Fix Patterns\n\n');

    // Initialize enhanced context store
    ensureDir('.goodflows/context');
    ensureDir('.goodflows/context/findings');
    ensureDir('.goodflows/context/patterns');
    ensureDir('.goodflows/context/sessions');

    // Initialize context store (creates index)
    const store = new ContextStore({ basePath: '.goodflows/context' });
    const storeStats = store.getStats();
    if (verbose) log.info(`Context store initialized (${storeStats.uniqueFindings} findings)`);

    // Initialize pattern tracker
    const tracker = new PatternTracker({ basePath: '.goodflows/context/patterns' });
    const trackerStats = tracker.getStats();
    if (verbose) log.info(`Pattern tracker initialized (${trackerStats.totalPatterns} patterns)`);

    log.success('Configuration initialized!');
    console.log(`
${colors.bold}Created:${colors.reset}
  ${colors.green}•${colors.reset} goodflows.config.json (configuration file)
  ${colors.green}•${colors.reset} CLAUDE.md (project documentation)
  ${colors.green}•${colors.reset} .claude/agents/ (agent directory)
  ${colors.green}•${colors.reset} .serena/memories/ (legacy memory storage)
  ${colors.green}•${colors.reset} .goodflows/context/ (enhanced context store)

Edit ${colors.cyan}goodflows.config.json${colors.reset} to customize behavior.

Next: Run ${colors.cyan}goodflows install${colors.reset} to install agents.
`);
  } catch (error) {
    log.error(`Initialization failed: ${error.message}`);
    process.exit(1);
  }
}

// Context store management
function contextCommand(options) {
  const { subcommand } = options;

  const store = new ContextStore({ basePath: '.goodflows/context' });

  switch (subcommand) {
    case 'query': {
      log.info('Querying context store...');
      const results = store.query({ limit: 20 });
      if (results.length === 0) {
        console.log('No findings in context store.');
      } else {
        console.log(`\n${colors.bold}Findings (${results.length}):${colors.reset}\n`);
        console.log('| Hash | File | Type | Status |');
        console.log('|------|------|------|--------|');
        for (const r of results) {
          console.log(`| ${r._hash.slice(0, 8)} | ${r.file || '-'} | ${r.type || '-'} | ${r.status || 'open'} |`);
        }
      }
      break;
    }

    case 'export': {
      log.info('Exporting to markdown...');
      const markdown = store.exportToMarkdown();
      const outputPath = '.goodflows/export.md';
      writeFileSync(outputPath, markdown);
      log.success(`Exported to ${outputPath}`);
      break;
    }

    case 'clear': {
      log.warning('This will clear all context data. Use with caution.');
      // Clear would need confirmation - just show stats for now
      const stats = store.getStats();
      console.log(`\n${colors.bold}Current Stats:${colors.reset}`);
      console.log(`  Unique Findings: ${stats.uniqueFindings}`);
      console.log(`  Files Covered: ${stats.filesCovered}`);
      console.log(`\nTo clear, manually delete .goodflows/context/`);
      break;
    }

    default:
      console.log(`
${colors.bold}Context Store Commands:${colors.reset}

  ${colors.cyan}goodflows context query${colors.reset}    Query stored findings
  ${colors.cyan}goodflows context export${colors.reset}   Export to markdown
  ${colors.cyan}goodflows context clear${colors.reset}    Clear context data (shows stats)

${colors.bold}Query Options:${colors.reset}
  --type <type>     Filter by type (bug, security, etc.)
  --file <path>     Filter by file path
  --limit <n>       Limit results (default: 20)
`);
  }
}

// Migrate from legacy markdown memories
function migrate() {
  showLogo();
  log.info('Migrating from legacy markdown memories...');

  const legacyPath = '.serena/memories';
  const findingsFile = join(legacyPath, 'coderabbit_findings.md');
  const patternsFile = join(legacyPath, 'auto_fix_patterns.md');

  if (!existsSync(legacyPath)) {
    log.warning('No legacy memories found at .serena/memories/');
    return;
  }

  // Initialize context store
  const store = new ContextStore({ basePath: '.goodflows/context' });
  const tracker = new PatternTracker({ basePath: '.goodflows/context/patterns' });

  let findingsMigrated = 0;
  let patternsMigrated = 0;

  // Migrate findings
  if (existsSync(findingsFile)) {
    log.info('Parsing legacy findings...');
    const content = readFileSync(findingsFile, 'utf-8');

    // Parse markdown tables (simple extraction)
    const tableMatch = content.match(/\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|/g);
    if (tableMatch) {
      for (const row of tableMatch) {
        if (row.includes('Hash') || row.includes('---')) continue; // Skip header

        const cells = row.split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length >= 4) {
          const result = store.addFinding({
            file: cells[1] !== '-' ? cells[1] : undefined,
            type: cells[2] !== '-' ? cells[2] : 'unknown',
            status: cells[3] !== '-' ? cells[3] : 'open',
            description: `Migrated from legacy: ${cells[0]}`,
            migrated: true,
          });

          if (result.added) findingsMigrated++;
        }
      }
    }
  }

  // Migrate patterns
  if (existsSync(patternsFile)) {
    log.info('Parsing legacy patterns...');
    const content = readFileSync(patternsFile, 'utf-8');

    // Parse pattern sections
    const patternSections = content.split(/^## /gm).filter(Boolean);
    for (const section of patternSections) {
      const lines = section.split('\n');
      const patternId = lines[0]?.trim();
      if (!patternId || patternId.startsWith('#')) continue;

      let description = '';
      let type = 'unknown';

      for (const line of lines) {
        if (line.includes('Description:')) {
          description = line.split('Description:')[1]?.trim() || '';
        }
        if (line.includes('Type:')) {
          type = line.split('Type:')[1]?.trim()?.replace(/`/g, '') || 'unknown';
        }
      }

      if (description) {
        tracker.registerPattern({
          patternId,
          description,
          type,
          file: 'migrated',
        });
        patternsMigrated++;
      }
    }
  }

  log.success('Migration complete!');
  console.log(`
${colors.bold}Migration Summary:${colors.reset}
  ${colors.green}•${colors.reset} Findings migrated: ${findingsMigrated}
  ${colors.green}•${colors.reset} Patterns migrated: ${patternsMigrated}
  ${colors.green}•${colors.reset} New location: .goodflows/context/

${colors.yellow}Note:${colors.reset} Legacy files preserved at .serena/memories/
`);
}

// Show context store statistics
function stats() {
  showLogo();

  if (!existsSync('.goodflows/context')) {
    log.warning('Context store not initialized. Run: goodflows init');
    return;
  }

  const store = new ContextStore({ basePath: '.goodflows/context' });
  const tracker = new PatternTracker({ basePath: '.goodflows/context/patterns' });

  const storeStats = store.getStats();
  const patternStats = tracker.getStats();

  console.log(`
${colors.bold}${colors.cyan}Context Store Statistics${colors.reset}

${colors.bold}Findings:${colors.reset}
  Total Processed:    ${storeStats.totalFindings}
  Unique Stored:      ${storeStats.uniqueFindings}
  Duplicates Skipped: ${storeStats.duplicatesSkipped}
  Files Covered:      ${storeStats.filesCovered}
  Types Tracked:      ${storeStats.typesCovered}

${colors.bold}Patterns:${colors.reset}
  Total Patterns:     ${patternStats.totalPatterns}
  Custom Patterns:    ${patternStats.customPatterns}
  Builtin Patterns:   ${patternStats.builtinPatterns}
  Avg Confidence:     ${(patternStats.avgConfidence * 100).toFixed(1)}%
  Total Applications: ${patternStats.totalApplications}
  Overall Success:    ${(patternStats.successRate * 100).toFixed(1)}%
`);

  if (patternStats.topPatterns.length > 0) {
    console.log(`${colors.bold}Top Patterns:${colors.reset}`);
    for (const p of patternStats.topPatterns) {
      console.log(`  ${colors.cyan}${p.id}${colors.reset}: ${p.instances} uses, ${(p.confidence * 100).toFixed(0)}% confidence`);
    }
    console.log('');
  }
}

// Main function
function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  switch (options.command) {
    case 'install':
      install(options);
      break;
    case 'uninstall':
      uninstall(options);
      break;
    case 'init':
      init(options);
      break;
    case 'list':
      listAgents();
      break;
    case 'context':
      contextCommand(options);
      break;
    case 'migrate':
      migrate();
      break;
    case 'stats':
      stats();
      break;
    case 'version':
      showVersion();
      break;
    case 'help':
    default:
      showHelp();
      break;
  }
}

main();
