async function test() {
    let currentUrl = `https://huggingface.co/api/datasets/deep776/fyers-market-data/tree/main/BSE_SENSEX_INDEX/option_data/parquet/BSE_SENSEX_INDEX_20260917_112035`;
    let allFiles = [];
    while (currentUrl) {
        console.log("Fetching: " + currentUrl);
        const res = await fetch(currentUrl);
        const chunk = await res.json();
        allFiles = allFiles.concat(chunk);
        
        const linkHeader = res.headers.get('link');
        console.log("Link header: " + linkHeader);
        if (linkHeader && linkHeader.includes('rel="next"')) {
            const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
            if (match) {
                currentUrl = match[1];
            } else {
                currentUrl = null;
            }
        } else {
            currentUrl = null;
        }
    }
    console.log("Total files fetched: " + allFiles.length);
    console.log("Does FUT exist: " + allFiles.some(f => f.path.includes("FUT")));
}
test();
