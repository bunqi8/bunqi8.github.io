const fs = require('fs');
const acorn = require('acorn');

const files = ['public/options_chain.js', 'public/datafeed.js', 'public/cache.js', 'public/main.js'];
let failed = false;
for (const file of files) {
    try {
        const code = fs.readFileSync(file, 'utf-8');
        acorn.parse(code, {ecmaVersion: 2022, sourceType: 'module'});
        console.log(`[OK] ${file}`);
    } catch (e) {
        console.error(`[ERROR] ${file}: ${e.message}`);
        failed = true;
    }
}
process.exit(failed ? 1 : 0);
