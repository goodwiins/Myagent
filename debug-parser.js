
import { parseMultiTaskPlan } from './lib/xml-task-parser.js';

const planContent = `---
phase: 01-foundation
plan: 01
type: execute
---

<tasks>

<task type="checkpoint:human-verify" id="cp-1">
  <what-built>CP1</what-built>
</task>

<task type="auto" id="task-1">
  <name>Task 1</name>
</task>

<task type="checkpoint:human-verify" id="cp-2">
  <what-built>CP2</what-built>
</task>

<task type="auto" id="task-2">
  <name>Task 2</name>
</task>

</tasks>
`;

const content = planContent;
const taskRegex = /<task([^>]*)>([\s\S]*?)<\/task>/gi;
let taskMatch;
console.log('--- Regex Debug ---');
while ((taskMatch = taskRegex.exec(content)) !== null) {
  console.log('Match found:');
  console.log('  Group 0 (Full):', taskMatch[0].substring(0, 30) + '...');
  console.log('  Group 1 (Attrs):', taskMatch[1]);
  console.log('  Group 2 (Content):', taskMatch[2].substring(0, 30).replace(/\n/g, '\\n') + '...');
}
console.log('--- End Debug ---\n');

const parsed = parseMultiTaskPlan(planContent);
console.log(JSON.stringify(parsed, null, 2));
