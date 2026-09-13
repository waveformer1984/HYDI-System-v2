const fs = require('fs');
let c = fs.readFileSync('tests/unit/heidi-campaign-loop-qualification.test.ts', 'utf8');
let counter = 0;
c = c.replace(/makeCsvProspects\((\d+)\)/g, function(match, n) {
  counter++;
  return 'makeCsvProspects(' + n + ', "t' + counter + '")';
});
fs.writeFileSync('tests/unit/heidi-campaign-loop-qualification.test.ts', c);
console.log('done, replaced ' + counter + ' calls');
