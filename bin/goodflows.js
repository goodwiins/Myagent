#!/usr/bin/env node

/**
 * GoodFlows CLI
 * AI-powered code review automation with CodeRabbit, Linear, and Claude
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { ContextStore } from '../lib/context-store.js';
import { PatternTracker } from '../lib/pattern-tracker.js';
import { SyncManager } from '../lib/sync-manager.js';

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
      case 'loop':
      case 'watch':
      case 'sync':
      case 'health':
        options.command = arg;
        break;
      case 'add':
      case 'query':
      case 'export':
      case 'clear':
      case 'import':
      case 'merge':
      case 'status':
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
      // Context query filters
      case '--type':
      case '-t':
        options.type = args[++i];
        break;
      case '--file':
      case '-f':
        options.file = args[++i];
        break;
      case '--status':
      case '-s':
        options.status = args[++i];
        break;
      case '--limit':
      case '-n':
        options.limit = parseInt(args[++i], 10) || 20;
        break;
      // Sync options
      case '--llm':
        options.llm = args[++i];
        break;
      case '--role':
      case '-r':
        options.role = args[++i];
        break;
      case '--message':
      case '-m':
        options.message = args[++i];
        break;
      case '--strategy':
        options.strategy = args[++i];
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
  sync        Cross-CLI sync (export, import, merge, status)
  health      Show context files health dashboard
  migrate     Migrate from legacy markdown memories
  stats       Show context storage statistics
  loop        Run continuous review loop (interval mode)
  watch       Run file-watching review loop
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
  ${colors.cyan}goodflows sync export --llm claude${colors.reset}   # Export context for other LLMs
  ${colors.cyan}goodflows sync import --llm gemini${colors.reset}   # Import from another LLM
  ${colors.cyan}goodflows sync merge${colors.reset}                 # Merge contexts from all LLMs
  ${colors.cyan}goodflows sync status${colors.reset}                # Show sync status
  ${colors.cyan}goodflows migrate${colors.reset}                    # Migrate legacy memories
  ${colors.cyan}goodflows stats${colors.reset}                      # Show storage statistics
  ${colors.cyan}goodflows health${colors.reset}                     # Show context health dashboard
  ${colors.cyan}goodflows loop${colors.reset}                       # Start interval review loop
  ${colors.cyan}goodflows watch${colors.reset}                      # Start file-watching loop

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

    // Copy CLAUDE.md only if it doesn't exist
    const claudeSource = join(PACKAGE_ROOT, 'CLAUDE.md');
    const claudeExists = existsSync('CLAUDE.md');
    if (existsSync(claudeSource) && !claudeExists) {
      copyFileSync(claudeSource, 'CLAUDE.md');
    } else if (claudeExists && verbose) {
      log.info('CLAUDE.md already exists, skipping');
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
  ${claudeExists ? `${colors.yellow}•${colors.reset} CLAUDE.md (skipped - already exists)` : `${colors.green}•${colors.reset} CLAUDE.md (project documentation)`}
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
  const { subcommand, type, file, status, limit } = options;

  const store = new ContextStore({ basePath: '.goodflows/context' });

  switch (subcommand) {
    case 'query': {
      // Build filters from CLI options
      const filters = {
        type: type,
        file: file,
        status: status,
        limit: limit || 20,
      };

      // Remove undefined values
      Object.keys(filters).forEach(k => filters[k] === undefined && delete filters[k]);

      const filterDesc = Object.entries(filters)
        .filter(([k, v]) => k !== 'limit' && v)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') || 'all';

      log.info(`Querying context store (${filterDesc})...`);
      const results = store.query(filters);

      if (results.length === 0) {
        console.log('No findings match the query.');
      } else {
        console.log(`\n${colors.bold}Findings (${results.length}):${colors.reset}\n`);
        console.log('| Hash | File | Type | Status | Issue |');
        console.log('|------|------|------|--------|-------|');
        for (const r of results) {
          console.log(`| ${r._hash.slice(0, 8)} | ${r.file || '-'} | ${r.type || '-'} | ${r.status || 'open'} | ${r.issueId || '-'} |`);
        }
      }
      break;
    }

    case 'export': {
      // Build filters for export
      const filters = { type, file, status };
      Object.keys(filters).forEach(k => filters[k] === undefined && delete filters[k]);

      log.info('Exporting to markdown...');
      const markdown = store.exportToMarkdown(filters);
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

// Show context health dashboard
async function health() {
  const { getHealthSummary, formatHealthReport } = await import('../lib/context-health.js');

  showLogo();

  if (!existsSync('.goodflows')) {
    log.warning('Context files not initialized. Run: goodflows init');
    return;
  }

  log.info('Analyzing context files health...');

  try {
    const summary = await getHealthSummary({ basePath: '.goodflows' });
    const report = formatHealthReport(summary, { color: true });

    console.log('');
    console.log(report);

    // Show actionable next steps
    if (summary.suggestions.length > 0 && summary.overallScore < 80) {
      console.log(`
${colors.bold}Next Steps:${colors.reset}
  Run ${colors.cyan}goodflows context-file init${colors.reset} to create missing files
  Run ${colors.cyan}goodflows context-file write <type>${colors.reset} to update files
`);
    }
  } catch (error) {
    log.error(`Health check failed: ${error.message}`);
  }
}

// Sync command for cross-CLI collaboration
function syncCommand(options) {
  const { subcommand, llm, role, message, strategy } = options;

  const syncManager = new SyncManager({ basePath: process.cwd() });

  switch (subcommand) {
    case 'export': {
      if (!llm) {
        log.error('LLM identifier required. Use: --llm <name>');
        console.log(`\n${colors.bold}Available LLMs:${colors.reset} ${SyncManager.getKnownLLMs().join(', ')}`);
        return;
      }

      log.info(`Exporting context for ${llm}...`);

      // Get context store and session info
      const store = existsSync('.goodflows/context')
        ? new ContextStore({ basePath: '.goodflows/context' })
        : null;

      const findings = store ? store.query({ limit: 50 }) : [];

      try {
        const result = syncManager.export({
          llm,
          role,
          message,
          findings,
          projectContext: {
            project: { name: basename(process.cwd()) },
            github: {},
          },
        });

        log.success(`Exported to ${result.path}`);
        console.log(`
${colors.bold}Export Summary:${colors.reset}
  LLM:      ${colors.cyan}${result.llm}${colors.reset}
  Role:     ${result.role}
  Files:    ${result.stats.trackedFiles}
  Hash:     ${result.contentHash}

${colors.bold}Next Steps:${colors.reset}
  Another LLM can import with:
  ${colors.cyan}goodflows sync import --llm ${llm}${colors.reset}
`);
      } catch (error) {
        log.error(`Export failed: ${error.message}`);
      }
      break;
    }

    case 'import': {
      if (!llm) {
        log.error('LLM identifier required. Use: --llm <name>');
        return;
      }

      log.info(`Importing context from ${llm}...`);

      try {
        const result = syncManager.import({ llm });

        log.success(`Imported from ${result.importedFrom}`);
        console.log(`
${colors.bold}Import Summary:${colors.reset}
  From:       ${colors.cyan}${result.importedFrom}${colors.reset}
  Role:       ${result.role}
  Exported:   ${result.exportedAt}
  Findings:   ${result.findings?.length || 0}
  ${result.message ? `\n${colors.bold}Message:${colors.reset} ${result.message}` : ''}

${colors.bold}Session:${colors.reset}
  ${result.session ? `ID: ${result.session.id}` : 'No session data'}
`);

        // Optionally restore findings to context store
        if (result.findings?.length > 0) {
          const store = new ContextStore({ basePath: '.goodflows/context' });
          let added = 0;
          for (const finding of result.findings) {
            const res = store.addFinding(finding);
            if (res.added) added++;
          }
          if (added > 0) {
            console.log(`${colors.green}Imported ${added} new findings to context store${colors.reset}`);
          }
        }
      } catch (error) {
        log.error(`Import failed: ${error.message}`);
      }
      break;
    }

    case 'merge': {
      log.info('Merging contexts from all LLMs...');

      try {
        const result = syncManager.merge({ strategy });

        if (!result.success) {
          log.error(result.error);
          return;
        }

        log.success(`Merged ${result.sourcesCount} sources`);
        console.log(`
${colors.bold}Merge Summary:${colors.reset}
  Sources:    ${result.sources.map(s => s.llm).join(', ')}
  Strategy:   ${strategy || 'latest-wins'}
  Sessions:   ${result.stats.sessions}
  Findings:   ${result.stats.findings}
  Files:      ${result.stats.filesCreated + result.stats.filesModified} tracked

${result.conflicts ? `${colors.yellow}Conflicts:${colors.reset} ${result.conflicts.length} (see ${result.conflictsPath})` : `${colors.green}No conflicts${colors.reset}`}
`);
      } catch (error) {
        log.error(`Merge failed: ${error.message}`);
      }
      break;
    }

    case 'status': {
      const result = syncManager.status({ llm });

      console.log(`
${colors.bold}${colors.cyan}Sync Status${colors.reset}

${colors.bold}Sync Directory:${colors.reset} ${result.syncPath}
${colors.bold}Available Handoffs:${colors.reset} ${result.available.length}
`);

      if (result.available.length === 0) {
        console.log(`${colors.yellow}No sync data available yet.${colors.reset}`);
        console.log(`\nExport with: ${colors.cyan}goodflows sync export --llm <name>${colors.reset}`);
      } else {
        console.log('| LLM | Role | Exported | Message |');
        console.log('|-----|------|----------|---------|');
        for (const h of result.available) {
          const time = h.exportedAt ? new Date(h.exportedAt).toLocaleString() : '-';
          console.log(`| ${h.llm} | ${h.role || '-'} | ${time} | ${h.message?.slice(0, 30) || '-'} |`);
        }
      }

      if (result.sharedState) {
        console.log(`\n${colors.bold}Shared State:${colors.reset}`);
        console.log(`  Merged: ${result.sharedState.mergedAt}`);
        console.log(`  Sources: ${result.sharedState.sources?.map(s => s.llm).join(', ') || '-'}`);
      }

      if (result.conflicts?.length > 0) {
        console.log(`\n${colors.yellow}Conflicts:${colors.reset} ${result.conflicts.length} unresolved`);
      }
      break;
    }

    default:
      console.log(`
${colors.bold}Sync Commands:${colors.reset}

  ${colors.cyan}goodflows sync export --llm <name>${colors.reset}   Export context for another LLM
  ${colors.cyan}goodflows sync import --llm <name>${colors.reset}   Import context from another LLM
  ${colors.cyan}goodflows sync merge${colors.reset}                 Merge all available contexts
  ${colors.cyan}goodflows sync status${colors.reset}                Show sync status

${colors.bold}Options:${colors.reset}
  --llm <name>       LLM identifier (claude, gemini, gpt4, copilot, cursor, windsurf)
  --role <role>      Filter by role (frontend, backend, testing, devops)
  --message <msg>    Message for receiving LLM
  --strategy <s>     Merge strategy (latest-wins, manual, theirs, ours)

${colors.bold}Available Roles:${colors.reset}
  ${colors.green}frontend${colors.reset}  - Components, pages, styles, hooks
  ${colors.green}backend${colors.reset}   - API, server, database, lib
  ${colors.green}testing${colors.reset}   - Tests and test configs
  ${colors.green}devops${colors.reset}    - Docker, CI/CD, scripts

${colors.bold}Workflow Example:${colors.reset}

  ${colors.cyan}# Claude exports backend work${colors.reset}
  goodflows sync export --llm claude --role backend --message "API ready"

  ${colors.cyan}# Gemini imports and continues${colors.reset}
  goodflows sync import --llm claude

  ${colors.cyan}# Gemini exports frontend work${colors.reset}
  goodflows sync export --llm gemini --role frontend

  ${colors.cyan}# Merge all work${colors.reset}
  goodflows sync merge
`);
  }
}

// Loop/Watch mode for continuous review
async function loopCommand(options) {
  const mode = options.command === 'watch' ? 'watch' : 'interval';

  showLogo();
  log.info(`Starting ${mode} mode review loop...`);

  if (!existsSync('.goodflows/context')) {
    log.warning('Context store not initialized. Run: goodflows init');
    return;
  }

  const store = new ContextStore({ basePath: '.goodflows/context' });
  const tracker = new PatternTracker({ basePath: '.goodflows/context/patterns' });

  const config = {
    mode,
    intervalMs: 60000,        // 1 minute default
    maxIterations: 100,
    autoFix: false,
    sessionId: `loop_${Date.now()}`,
  };

  const state = {
    iteration: 0,
    startTime: Date.now(),
    totalFindings: 0,
    issuesCreated: [],
    issuesFixed: [],
    running: true,
  };

  // Save session
  const saveState = () => {
    const sessionFile = `.goodflows/context/sessions/${config.sessionId}.json`;
    writeFileSync(sessionFile, JSON.stringify({
      ...state,
      config,
      lastUpdate: new Date().toISOString(),
    }, null, 2));
  };

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n${colors.yellow}[Loop] Received interrupt signal...${colors.reset}`);
    state.running = false;
    saveState();
    showLoopSummary(state);
    process.exit(0);
  });

  console.log(`
${colors.bold}Loop Configuration:${colors.reset}
  Mode:           ${colors.cyan}${mode}${colors.reset}
  Interval:       ${config.intervalMs / 1000}s
  Max Iterations: ${config.maxIterations}
  Session ID:     ${config.sessionId}

${colors.yellow}Press Ctrl+C to stop the loop${colors.reset}
`);

  if (mode === 'watch') {
    // Watch mode - file system watching
    log.info('Watching for file changes...');
    const { watch: fsWatch } = await import('fs');

    const watcher = fsWatch('.', { recursive: true }, async (_event, filename) => {
      if (!filename || filename.startsWith('.') || filename.includes('node_modules')) return;
      if (!state.running) return;

      // Debounce rapid changes
      const now = Date.now();
      if (state.lastChange && now - state.lastChange < 2000) return;
      state.lastChange = now;

      state.iteration++;
      console.log(`\n${colors.cyan}[Loop ${state.iteration}]${colors.reset} Change detected: ${filename}`);

      await runCycle(state, store, tracker);
      saveState();

      if (state.iteration >= config.maxIterations) {
        log.warning('Max iterations reached, stopping loop.');
        state.running = false;
        watcher.close();
        showLoopSummary(state);
      }
    });

    // Keep process alive (intentionally never resolves)
    await new Promise(() => { /* keep alive */ });

  } else {
    // Interval mode
    while (state.running && state.iteration < config.maxIterations) {
      state.iteration++;
      console.log(`\n${colors.cyan}[Loop ${state.iteration}/${config.maxIterations}]${colors.reset} Running review cycle...`);

      await runCycle(state, store, tracker);
      saveState();

      if (state.running) {
        console.log(`${colors.blue}[Loop]${colors.reset} Waiting ${config.intervalMs / 1000}s for next cycle...`);
        await sleep(config.intervalMs);
      }
    }

    showLoopSummary(state);
  }
}

// Run a single review cycle (using spawnSync for safety)
async function runCycle(state, store) {
  const cycleStart = Date.now();
  const { spawnSync } = await import('child_process');

  try {
    // Check git status for changes (using spawnSync - no shell injection)
    let hasChanges = false;

    const gitResult = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf-8' });
    if (gitResult.status === 0) {
      hasChanges = gitResult.stdout.trim().length > 0;
    } else {
      log.warning('Not a git repository or git not available');
    }

    if (!hasChanges) {
      console.log(`${colors.blue}[Cycle]${colors.reset} No uncommitted changes detected.`);
      return;
    }

    console.log(`${colors.blue}[Cycle]${colors.reset} Found uncommitted changes, checking for CodeRabbit...`);

    // Check if coderabbit is available (using spawnSync)
    const whichResult = spawnSync('which', ['coderabbit'], { encoding: 'utf-8' });
    const coderabbitAvailable = whichResult.status === 0;

    if (coderabbitAvailable) {
      console.log(`${colors.blue}[Cycle]${colors.reset} Running CodeRabbit review...`);

      const reviewResult = spawnSync('coderabbit', ['review', '--type', 'uncommitted', '--plain'], {
        encoding: 'utf-8',
        timeout: 120000,
      });

      if (reviewResult.status === 0) {
        // Parse findings (simplified)
        const findings = parseCodeRabbitOutput(reviewResult.stdout);
        state.totalFindings += findings.length;

        // Check for duplicates
        let newFindings = 0;
        for (const finding of findings) {
          if (!store.exists(finding)) {
            store.addFinding(finding);
            newFindings++;
          }
        }

        console.log(`${colors.green}[Cycle]${colors.reset} Found ${findings.length} findings (${newFindings} new)`);
      } else {
        log.warning(`CodeRabbit review failed: ${reviewResult.stderr}`);
      }
    } else {
      console.log(`${colors.yellow}[Cycle]${colors.reset} CodeRabbit not installed. Skipping review.`);
      console.log(`  Install with: ${colors.cyan}npm install -g @coderabbit/cli${colors.reset}`);
    }

    const duration = Date.now() - cycleStart;
    console.log(`${colors.blue}[Cycle]${colors.reset} Completed in ${duration}ms`);

  } catch (err) {
    log.error(`Cycle error: ${err.message}`);
  }
}

// Parse CodeRabbit output (simplified)
function parseCodeRabbitOutput(output) {
  const findings = [];

  // Look for patterns like "file.py:123 - issue description"
  const lines = output.split('\n');
  for (const line of lines) {
    const match = line.match(/([^\s:]+):(\d+)(?:-(\d+))?\s*[-:]\s*(.+)/);
    if (match) {
      findings.push({
        file: match[1],
        lines: match[3] ? `${match[2]}-${match[3]}` : match[2],
        description: match[4],
        type: inferFindingType(match[4]),
        timestamp: new Date().toISOString(),
      });
    }
  }

  return findings;
}

// Infer finding type from description
function inferFindingType(description) {
  const lower = description.toLowerCase();
  if (lower.includes('security') || lower.includes('api key') || lower.includes('secret')) return 'security';
  if (lower.includes('bug') || lower.includes('error') || lower.includes('null')) return 'bug';
  if (lower.includes('performance') || lower.includes('slow')) return 'performance';
  if (lower.includes('refactor') || lower.includes('clean')) return 'refactor';
  return 'unknown';
}

// Show loop summary
function showLoopSummary(state) {
  const duration = Date.now() - state.startTime;
  const minutes = Math.floor(duration / 60000);
  const seconds = Math.floor((duration % 60000) / 1000);

  console.log(`
${colors.bold}${colors.cyan}Loop Summary${colors.reset}

  Iterations:      ${state.iteration}
  Duration:        ${minutes}m ${seconds}s
  Total Findings:  ${state.totalFindings}
  Issues Created:  ${state.issuesCreated.length}
  Issues Fixed:    ${state.issuesFixed.length}
`);
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    case 'sync':
      syncCommand(options);
      break;
    case 'migrate':
      migrate();
      break;
    case 'stats':
      stats();
      break;
    case 'health':
      health();
      break;
    case 'loop':
    case 'watch':
      loopCommand(options);
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
