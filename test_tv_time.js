const tt = undefined;
const date_now = 1790322840000;
const tick_time = (tt * 1000) || date_now;

console.log(tick_time);
console.log(JSON.stringify({ time: tick_time / 1000000 }));
