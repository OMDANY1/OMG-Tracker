const fs = require('fs');
const path = require('path');

function searchDir(dir, pattern, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      searchDir(fullPath, pattern, results);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (pattern.test(line)) {
          results.push({ file: fullPath, lineNum: idx + 1, line: line.trim() });
        }
      });
    }
  }
  return results;
}

const root = path.resolve(__dirname, '..');
const results = searchDir(root, /role\s*===\s*['"]owner['"]/);
console.log(`Found ${results.length} occurrences of role === "owner":`);
results.forEach(r => {
  const rel = path.relative(root, r.file);
  console.log(`${rel}:${r.lineNum}: ${r.line}`);
});

const viewerResults = searchDir(root, /business_owner_viewer/);
console.log(`\nFound ${viewerResults.length} occurrences of business_owner_viewer:`);
viewerResults.forEach(r => {
  const rel = path.relative(root, r.file);
  console.log(`${rel}:${r.lineNum}: ${r.line}`);
});
