const fs = require('fs');
const file = 'src/components/NewReportForm.tsx';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(/\{...field\}\n\s*onChange=\{\(e\) => field\.onChange\(Number\(e\.target\.value\)\)\}/g, 
  "{...field}\n                            value={field.value === 0 ? '' : field.value}\n                            onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}");
fs.writeFileSync(file, content);
console.log('Done');
