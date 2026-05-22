const fs = require('fs');

const path = './src/components/PackProductionScheduler.tsx';
let code = fs.readFileSync(path, 'utf8');

// The markers in the file
const MAGIC_GANTT_START = '              {/* VIRTUALIZED CONTINUOUS GANTT CHART */}';
const MAGIC_TIMELINE_START = '              {/* DETAILED LINES MANAGEMENT AND PLANNING TIMELINE */}';
const MAGIC_END = '            </div>\n          )}';

// Extract the Gantt block
const ganttStartIdx = code.indexOf(MAGIC_GANTT_START);
const timelineStartIdx = code.indexOf(MAGIC_TIMELINE_START);
const endIdx = code.indexOf(MAGIC_END, timelineStartIdx);

if (ganttStartIdx > -1 && timelineStartIdx > -1) {
  const ganttBlock = code.substring(ganttStartIdx, timelineStartIdx);
  
  // Remove gantt from start
  let newCode = code.slice(0, ganttStartIdx) + code.slice(timelineStartIdx);
  
  // Insert gantt near the bottom, before closing div of main section
  const newEndIdx = newCode.indexOf(MAGIC_END);
  newCode = newCode.slice(0, newEndIdx) + '\n' + ganttBlock + '\n' + newCode.slice(newEndIdx);
  
  fs.writeFileSync(path, newCode, 'utf8');
  console.log('Swapped successfully');
} else {
  console.log('Markers not found', ganttStartIdx, timelineStartIdx);
}
