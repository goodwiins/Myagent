
import { ContextStore } from '../lib/context-store.js';
import { SessionContextManager } from '../lib/session-context.js';
import { join, isAbsolute } from 'path';
import { existsSync, rmSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

const TEST_DIR = '.goodflows-test-handoff';

// Cleanup
if (existsSync(TEST_DIR)) {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

console.log('🧪 Starting Handoff Workflow Test...');

try {
  // 1. Test ContextStore Relative Path Normalization
  console.log('\n[1] Testing ContextStore path normalization...');
  const contextStore = new ContextStore({ basePath: join(TEST_DIR, 'context') });
  
  const absPath = join(process.cwd(), 'src', 'test-file.ts');
  const finding = {
    file: absPath,
    type: 'bug',
    description: 'Test finding',
    status: 'open'
  };
  
  const result = contextStore.addFinding(finding);
  const savedFinding = contextStore.getByHash(result.hash);
  
  if (savedFinding.file === 'src/test-file.ts') {
    console.log('✅ ContextStore correctly normalized absolute path to relative.');
  } else {
    console.error(`❌ ContextStore failed to normalize. Expected 'src/test-file.ts', got '${savedFinding.file}'`);
    process.exit(1);
  }

  // 2. Test SessionContextManager Relative Path Normalization
  console.log('\n[2] Testing SessionContextManager path normalization...');
  const sessionManager = new SessionContextManager({ basePath: join(TEST_DIR, 'context', 'sessions') });
  sessionManager.start({ trigger: 'test' });
  
  sessionManager.trackFile(absPath, 'modified');
  
  // Force save since trackFile uses debounce
  sessionManager._save();
  
  // Read back raw file to check storage
  const sessionFile = join(TEST_DIR, 'context', 'sessions', `${sessionManager.getId()}.json`);
  const sessionData = JSON.parse(readFileSync(sessionFile, 'utf-8'));
  const trackedFile = sessionData.tracking.files.modified[0];
  
  if (trackedFile.path === 'src/test-file.ts') {
    console.log('✅ SessionContextManager correctly normalized absolute path to relative.');
  } else {
    console.error(`❌ SessionContextManager failed to normalize. Expected 'src/test-file.ts', got '${trackedFile.path}'`);
    process.exit(1);
  }

  // 3. Test Hooks Execution
  console.log('\n[3] Testing Hooks...');
  
  console.log('Running pre-handoff hook...');
  try {
    const preOutput = execSync('node bin/hooks/pre-handoff.js').toString();
    console.log('✅ Pre-handoff hook executed successfully.');
    // console.log(preOutput); // Optional: print output
  } catch (e) {
    console.error('❌ Pre-handoff hook failed:', e.message);
    process.exit(1);
  }

  console.log('Running post-handoff hook...');
  try {
    const postOutput = execSync('node bin/hooks/post-handoff.js').toString();
    console.log('✅ Post-handoff hook executed successfully.');
    // console.log(postOutput); // Optional: print output
  } catch (e) {
    console.error('❌ Post-handoff hook failed:', e.message);
    process.exit(1);
  }

  console.log('\n🎉 All tests passed!');

} catch (error) {
  console.error('\n❌ Test failed with error:', error);
  process.exit(1);
} finally {
  // Cleanup
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}
