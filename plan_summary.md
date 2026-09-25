# Historical Data Architecture & Fallback Plan

We have successfully resolved the design for the historical data engine. Here is the finalized architecture we agreed upon:

### 1. The Priority Hierarchy (Layered Merging)
When a user scrolls back and requests historical data, we will fetch from multiple sources and stitch them together, strictly respecting this overriding priority:
1. **Parquet Data (King):** Highest priority. If data exists here, it completely overwrites everything else.
2. **Base/Index CSV Folder:** Secondary priority. (To be implemented later).
3. **Fyers API (Live Gaps):** Lowest priority. Used only to fill in the missing gaps where Parquet/CSV data is absent.

*Note: I have already updated the deduplication logic in `datafeed.js` to strictly enforce Parquet data overriding Fyers API data.*

### 2. Intelligent Fyers API Fallback
When we fall back to the Fyers API to fill historical gaps:
- **Indices:** Fetches exactly as normal.
- **Options:** **Blocked.** We will strictly abort Fyers historical API calls for expired options (returning `noData` natively) to avoid Invalid Symbol errors, since Fyers drops them after the golden period.
- **Futures:** When fetching missing historical data for *any* future (even expired ones from 2023), we will dynamically intercept the request and fetch from the **current active month future** instead.

### 3. Dynamic Future Symbol Resolution
To determine the "current active month future" on the fly, the code will dynamically scan the downloaded `window.HF_EXPIRIES` list:
- It will filter for `expiry_type === "M"` (Monthly).
- It will select the closest expiry where `dateObjValue` + 24 hours (Golden Period) has *not* passed yet.
- If the current month is expired on Fyers, it automatically rolls over to the next "M" expiry in the list and uses that symbol for the API call.

### 4. Smart API Chunking & 30-Day Caching
To respect Fyers' API rate limits while allowing deep 5-year scrolls:
- We will strictly respect Fyers' hard limits per request (e.g., 100 days for minutes, 366 days for daily).
- The historical Fyers API responses will be cached locally in IndexedDB to instantly serve subsequent scrolls.
- Unlike the Parquet cache (7 days), this historical API cache will be granted a **30-day Time-To-Live (TTL)** before eviction.
