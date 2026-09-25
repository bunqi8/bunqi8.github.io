const fs = require('fs');

async function test() {
    const res = await fetch("https://api-t1.fyers.in/data/quotes?symbols=NSE:NIFTY50-INDEX");
    const data = await res.json();
    console.log(data);
}
test();
