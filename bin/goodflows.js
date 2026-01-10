#!/usr/bin/env node

/**
 * GoodFlows CLI
 * AI-powered code review automation with CodeRabbit, Linear, and Claude
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

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
        options.command = arg;
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
function init() {
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

    // Initialize memory files
    writeFileSync('.serena/memories/coderabbit_findings.md', '# CodeRabbit Findings Log\n\n');
    writeFileSync('.serena/memories/auto_fix_patterns.md', '# Auto-Fix Patterns\n\n');

    log.success('Configuration initialized!');
    console.log(`
${colors.bold}Created:${colors.reset}
  ${colors.green}•${colors.reset} goodflows.config.json (configuration file)
  ${colors.green}•${colors.reset} CLAUDE.md (project documentation)
  ${colors.green}•${colors.reset} .claude/agents/ (agent directory)
  ${colors.green}•${colors.reset} .serena/memories/ (memory storage)

Edit ${colors.cyan}goodflows.config.json${colors.reset} to customize behavior.

Next: Run ${colors.cyan}goodflows install${colors.reset} to install agents.
`);
  } catch (error) {
    log.error(`Initialization failed: ${error.message}`);
    process.exit(1);
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
      init();
      break;
    case 'list':
      listAgents();
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
