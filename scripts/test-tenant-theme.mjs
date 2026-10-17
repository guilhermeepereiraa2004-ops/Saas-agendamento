import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/tenantTheme.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { getTenantTheme, parseHexColor, contrastRatio } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

assert.deepEqual(parseHexColor('#abc'), [170, 187, 204]);
assert.equal(parseHexColor('invalid'), null);
assert.equal(getTenantTheme('invalid').brand, '#7257d9');
assert.equal(getTenantTheme('#abc').brand, '#aabbcc');

let combinations = 0;
for (let r = 0; r <= 255; r += 17) {
  for (let g = 0; g <= 255; g += 17) {
    for (let b = 0; b <= 255; b += 17) {
      const brand = `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
      for (const preferred of ['#ffffff', '#000000', brand]) {
        const theme = getTenantTheme(brand, preferred);
        assert.equal(theme.brand, brand, 'Preserve the saved brand color');
        assert.ok(contrastRatio(parseHexColor(theme.action), [255, 255, 255]) >= 5.5, `Accent text on white: ${brand}`);
        assert.ok(contrastRatio(parseHexColor(theme.action), parseHexColor(theme.onAction)) >= 4.5, `Button label: ${brand}/${preferred}`);
        combinations++;
      }
    }
  }
}
console.log(`Theme contrast passed for ${combinations.toLocaleString('en-US')} color combinations.`);
