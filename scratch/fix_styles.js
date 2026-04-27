import fs from 'fs';
let code = fs.readFileSync('src/TenantApp.tsx', 'utf8');

code = code.replace(/rgba\(255,255,255,0\.05\)/g, 'rgba(0,0,0,0.05)');
code = code.replace(/rgba\(255,255,255,0\.1\)/g, 'rgba(0,0,0,0.1)');
code = code.replace(/color: '#fff'/g, "color: 'var(--text-primary)'");
code = code.replace(/background: '#09090b'/g, "background: '#ffffff'");

fs.writeFileSync('src/TenantApp.tsx', code);
console.log('Fixed inline styles in TenantApp.tsx');
