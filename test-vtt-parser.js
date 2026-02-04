/**
 * Simple test script for VTT parser
 * Run with: node test-vtt-parser.js
 */

const fs = require('fs');
const path = require('path');

// Read sample VTT file
const vttPath = path.join(__dirname, 'mock-data', 'sample-transcript.vtt');
const vttContent = fs.readFileSync(vttPath, 'utf-8');

console.log('Testing VTT Parser...\n');
console.log('Input VTT:');
console.log('─────────────────────────────────────');
console.log(vttContent);
console.log('─────────────────────────────────────\n');

// Simple VTT parser (inline for testing without TypeScript)
function parseVTT(vttContent) {
  const entries = [];
  const lines = vttContent
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  let i = lines[0] === 'WEBVTT' ? 1 : 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.includes('-->')) {
      const timestampMatch = line.match(/^([\d:\.]+)\s+-->\s+([\d:\.]+)$/);

      if (timestampMatch && i + 1 < lines.length) {
        const startTime = timestampMatch[1];
        const textLine = lines[i + 1];

        const speakerMatch = textLine.match(/<v\s+([^>]+)>([^<]*)<\/v>/);

        if (speakerMatch) {
          const speaker = speakerMatch[1].trim();
          const text = speakerMatch[2].trim();

          entries.push({
            timestamp: startTime,
            speaker,
            text,
          });
        }

        i += 2;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return entries;
}

// Parse and display results
const parsed = parseVTT(vttContent);

console.log('Parsed Output:');
console.log('─────────────────────────────────────');
console.log(JSON.stringify(parsed, null, 2));
console.log('─────────────────────────────────────\n');

console.log(`✅ Successfully parsed ${parsed.length} transcript entries\n`);

// Display in readable format
console.log('Transcript Summary:');
console.log('─────────────────────────────────────');
parsed.forEach((entry, index) => {
  console.log(`${index + 1}. [${entry.timestamp}] ${entry.speaker}:`);
  console.log(`   "${entry.text}"\n`);
});
