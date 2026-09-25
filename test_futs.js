// just write a tiny script that can be run in the browser console
console.log("Run this in devtools:");
console.log("window.SyncManager.getAllExpiries().then(ex => { console.log(ex.length); let f = new Set(); ex.forEach(e => e.files.forEach(x => { if(x.path.includes('FUT_')) f.add(x.path.split('/').pop().split('_')[0]) })); console.log(f); });");
