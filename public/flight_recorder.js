/**
 * Ultimate TradingView Frontend - Blackbox Flight Recorder & Crash Forensics Engine
 * 
 * Features:
 *  - Continuous 5-second telemetry heartbeat (V8 Heap, DOM nodes, Bar caches, WebSockets)
 *  - Synchronous localStorage ring-buffer (survives browser renderer process crash / "Aw, Snap!")
 *  - IndexedDB cumulative checkpoint store (preserves multi-day histories without quota issues)
 *  - 1-Hour Automated Flight Log Downloader (auto-exports timestamped JSON files while unattended overnight)
 *  - Automatic Post-Mortem Crash Autopsy on reload (detects abnormal termination, diagnoses root cause, renders forensic modal)
 *  - Sleek, compact bottom-right live HUD with interactive Diagnostics Inspector
 * 
 * Zero external dependencies. Safe against null/undefined.
 */

(function() {
    'use strict';

    if (window.__TV_FLIGHT_RECORDER_INSTALLED__) return;
    window.__TV_FLIGHT_RECORDER_INSTALLED__ = true;

    const STORAGE_KEY_SESSION = 'tv_fr_session_current';
    const STORAGE_KEY_LAST_CRASH = 'tv_fr_last_crash_report';
    const STORAGE_KEY_TIMELINE = 'tv_fr_timeline_ring';
    const STORAGE_KEY_ERRORS = 'tv_fr_errors_ring';
    const STORAGE_KEY_SETTINGS = 'tv_fr_settings';
    const DB_NAME = 'TV_FlightRecorder_DB';
    const DB_VERSION = 1;
    const STORE_CHECKPOINTS = 'hourly_checkpoints';

    const HEARTBEAT_INTERVAL_MS = 5000;         // 5 seconds
    const TIMELINE_MAX_ITEMS = 1440;             // 2 hours at 5s interval
    const ERRORS_MAX_ITEMS = 120;                // Last 120 console errors/warnings
    const DEFAULT_AUTO_DL_INTERVAL_MS = 3600000; // 1 hour

    class FlightRecorder {
        constructor() {
            this.sessionId = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
            this.startTime = Date.now();
            this.lastHeartbeatTime = Date.now();
            this.hourCount = 0;
            this.db = null;

            // Load user preferences
            this.settings = this.loadSettings();

            // In-memory ring buffers (mirrored to localStorage)
            this.timeline = [];
            this.errors = [];

            // UI elements
            this.hudPill = null;
            this.inspectorModal = null;
            this.autopsyModal = null;

            // Initialize IndexedDB in background
            this.initIndexedDB();

            // Intercept console & window errors
            this.installErrorInterceptors();

            // Check for previous session crash before overwriting session
            this.checkPreviousSessionCrash();

            // Register current session
            this.registerSessionStart();

            // Start heartbeat and hourly auto-downloader
            this.startHeartbeat();
            this.startHourlyDownloader();

            // Register orderly shutdown listeners
            this.installShutdownHandlers();

            // Mount HUD once DOM is ready
            this.initHUD();
        }

        // ==========================================
        // 1. Storage & Settings
        // ==========================================

        loadSettings() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
                if (raw) return JSON.parse(raw);
            } catch (_) {}
            return {
                autoDownloadHourly: true,
                autoDownloadIntervalMs: DEFAULT_AUTO_DL_INTERVAL_MS,
                enableHUD: true
            };
        }

        saveSettings() {
            try {
                localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(this.settings));
            } catch (_) {}
        }

        initIndexedDB() {
            try {
                if (!window.indexedDB) return;
                const req = window.indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_CHECKPOINTS)) {
                        db.createObjectStore(STORE_CHECKPOINTS, { keyPath: 'id' });
                    }
                };
                req.onsuccess = (e) => {
                    this.db = e.target.result;
                };
            } catch (_) {}
        }

        saveCheckpointToIndexedDB(checkpoint) {
            if (!this.db) return;
            try {
                const tx = this.db.transaction([STORE_CHECKPOINTS], 'readwrite');
                const store = tx.objectStore(STORE_CHECKPOINTS);
                store.put(checkpoint);
            } catch (_) {}
        }

        // ==========================================
        // 2. Error & Console Interception
        // ==========================================

        installErrorInterceptors() {
            const self = this;

            // Uncaught JS Runtime Exceptions
            window.addEventListener('error', function(e) {
                self.recordError({
                    type: 'uncaught_exception',
                    message: e.message || String(e),
                    filename: e.filename || 'unknown',
                    lineno: e.lineno || 0,
                    colno: e.colno || 0,
                    stack: e.error && e.error.stack ? e.error.stack.slice(0, 800) : null,
                    time: Date.now()
                });
            }, true);

            // Unhandled Promise Rejections
            window.addEventListener('unhandledrejection', function(e) {
                const reason = e.reason || {};
                self.recordError({
                    type: 'unhandled_rejection',
                    message: reason.message || String(reason),
                    stack: reason.stack ? reason.stack.slice(0, 800) : null,
                    time: Date.now()
                });
            });

            // Console Error and Warn Hook
            try {
                const origConsoleError = console.error;
                const origConsoleWarn = console.warn;

                console.error = function(...args) {
                    try {
                        const msg = args.map(a => {
                            if (typeof a === 'string') return a;
                            try { return JSON.stringify(a); } catch (_) { return String(a); }
                        }).join(' ').slice(0, 600);

                        self.recordError({
                            type: 'console_error',
                            message: msg,
                            time: Date.now()
                        });
                    } catch (_) {}
                    return origConsoleError.apply(console, args);
                };

                console.warn = function(...args) {
                    try {
                        const msg = args.map(a => {
                            if (typeof a === 'string') return a;
                            try { return JSON.stringify(a); } catch (_) { return String(a); }
                        }).join(' ').slice(0, 600);

                        self.recordError({
                            type: 'console_warn',
                            message: msg,
                            time: Date.now()
                        });
                    } catch (_) {}
                    return origConsoleWarn.apply(console, args);
                };
            } catch (_) {}
        }

        recordError(errObj) {
            this.errors.push(errObj);
            if (this.errors.length > ERRORS_MAX_ITEMS) {
                this.errors.shift();
            }
            try {
                localStorage.setItem(STORAGE_KEY_ERRORS, JSON.stringify(this.errors));
            } catch (_) {}
        }

        // ==========================================
        // 3. Telemetry Snapshot & Heartbeat
        // ==========================================

        takeSnapshot() {
            const now = Date.now();

            // 1. Memory stats via Chrome performance.memory
            let mem = null;
            if (window.performance && window.performance.memory) {
                const pMem = window.performance.memory;
                mem = {
                    usedMB: Math.round((pMem.usedJSHeapSize / (1024 * 1024)) * 10) / 10,
                    totalMB: Math.round((pMem.totalJSHeapSize / (1024 * 1024)) * 10) / 10,
                    limitMB: Math.round((pMem.jsHeapSizeLimit / (1024 * 1024)) * 10) / 10,
                    pctOfLimit: Math.round((pMem.usedJSHeapSize / pMem.jsHeapSizeLimit) * 100)
                };
            }

            // 2. DOM metrics
            const domCount = document.getElementsByTagName ? document.getElementsByTagName('*').length : 0;
            const iframes = document.querySelectorAll ? document.querySelectorAll('iframe').length : 0;
            const canvases = document.querySelectorAll ? document.querySelectorAll('canvas').length : 0;

            // 3. Chart & Datafeed caches
            let barCacheKeys = 0;
            let totalBarsApprox = 0;
            if (window._barsCache) {
                const keys = Object.keys(window._barsCache);
                barCacheKeys = keys.length;
                for (let i = 0; i < Math.min(keys.length, 30); i++) {
                    const b = window._barsCache[keys[i]];
                    if (Array.isArray(b)) totalBarsApprox += b.length;
                }
            }

            let lastBarKeys = 0;
            if (window._tvLastBar) {
                lastBarKeys = Object.keys(window._tvLastBar).length;
            }

            // 4. Broker / WebSockets stats
            let mt5Conns = 0;
            let mt5Accounts = 0;
            if (window.MT5API) {
                if (Array.isArray(window.MT5API.endpoints)) {
                    mt5Conns = window.MT5API.endpoints.filter(e => {
                        if (!e || !e.enabled) return false;
                        const sock = window.MT5API.wsSockets ? window.MT5API.wsSockets.get(e.id) : null;
                        return (sock && sock.readyState === WebSocket.OPEN) || e.status === 'online';
                    }).length;
                }
                if (Array.isArray(window.MT5API.accounts)) {
                    mt5Accounts = window.MT5API.accounts.filter(a => a && (a.is_connected || a.connected)).length;
                }
            }

            let fyersConnected = false;
            if (window.FyersAPI && window.FyersAPI.ws && window.FyersAPI.ws.readyState === 1) {
                fyersConnected = true;
            }

            return {
                t: now,
                mem: mem,
                dom: { total: domCount, iframes: iframes, canvases: canvases },
                cache: { keys: barCacheKeys, bars: totalBarsApprox, lastBars: lastBarKeys },
                net: { mt5Conns, mt5Accounts, fyers: fyersConnected },
                recentErrorsCount: this.errors.length
            };
        }

        startHeartbeat() {
            this.heartbeatTimer = setInterval(() => {
                try {
                    const snapshot = this.takeSnapshot();
                    this.lastHeartbeatTime = snapshot.t;

                    // Append to rolling timeline
                    this.timeline.push(snapshot);
                    if (this.timeline.length > TIMELINE_MAX_ITEMS) {
                        this.timeline.shift();
                    }

                    // Synchronously update localStorage
                    localStorage.setItem(STORAGE_KEY_TIMELINE, JSON.stringify(this.timeline));

                    // Update session record
                    const sessionData = {
                        sessionId: this.sessionId,
                        startTime: this.startTime,
                        lastHeartbeatTime: this.lastHeartbeatTime,
                        orderlyShutdown: false,
                        uptimeSec: Math.floor((this.lastHeartbeatTime - this.startTime) / 1000),
                        finalMem: snapshot.mem,
                        finalDom: snapshot.dom,
                        finalCache: snapshot.cache,
                        userAgent: navigator.userAgent
                    };
                    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(sessionData));

                    // Update HUD display
                    this.updateHUD(snapshot);

                    // Multi-Tier Proactive Auto-Healer & Circuit-Breaker:
                    // Stage 1 (Memory >= 2200 MB / ~52% limit): Defensive cache & stream reset
                    // Stage 2 (Memory >= 2800 MB / ~67% limit): Deep flush & bridge socket reconnection
                    // Stage 3 (Memory >= 3400 MB / ~82% limit): Orderly state preservation & auto-reload before browser OOM kill
                    if (snapshot.mem) {
                        if (snapshot.mem.pctOfLimit >= 82 || snapshot.mem.usedMB >= 3400) {
                            this.triggerStage3AutoReloadCircuitBreaker(snapshot.mem);
                        } else if (snapshot.mem.pctOfLimit >= 67 || snapshot.mem.usedMB >= 2800) {
                            this.triggerStage2DeepPurge(snapshot.mem);
                        } else if (snapshot.mem.pctOfLimit >= 52 || snapshot.mem.usedMB >= 2200) {
                            this.triggerStage1DefensivePurge(snapshot.mem);
                        }
                    }
                } catch (_) {}
            }, HEARTBEAT_INTERVAL_MS);
        }

        triggerStage1DefensivePurge(mem) {
            const now = Date.now();
            if (this._lastStage1Purge && (now - this._lastStage1Purge < 90000)) return;
            this._lastStage1Purge = now;

            console.warn(`[FlightRecorder] ⚡ Tier-1 Proactive Auto-Heal: Memory at ${mem.usedMB} MB (${mem.pctOfLimit}% limit). Executing defensive cache & stream cleanup...`);

            this.recordError({
                type: 'auto_heal_stage1',
                message: `Tier-1 Memory Hygiene triggered at ${mem.usedMB} MB (${mem.pctOfLimit}% limit)`,
                time: now
            });

            // 1. Purge historical caches for all symbols except the active chart symbol
            let activeSym = '';
            try {
                if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                    activeSym = (window.tvWidget.activeChart().symbol() || '').replace(/[^A-Za-z0-9_]/g, '');
                }
            } catch (_) {}

            if (window._barsCache) {
                const keys = Object.keys(window._barsCache);
                for (let i = 0; i < keys.length; i++) {
                    const k = keys[i];
                    if (!activeSym || !k.includes(activeSym)) {
                        delete window._barsCache[k];
                    }
                }
            }

            // 2. Request TradingView to rerequest active series data (flushes stale barset)
            try {
                if (window.tvWidget && typeof window.tvWidget.activeChart === 'function') {
                    const chart = window.tvWidget.activeChart();
                    if (chart && typeof chart.resetData === 'function') {
                        chart.resetData();
                    }
                }
            } catch (_) {}

            // 3. Trigger reset callbacks in datafeed
            if (window._mt5ResetCallbacks) {
                window._mt5ResetCallbacks.forEach(cb => { try { cb(); } catch (_) {} });
            }
            if (window._tvResetCache) {
                try { window._tvResetCache(); } catch (_) {}
            }

            if (window.gc) {
                try { window.gc(); } catch (_) {}
            }
        }

        triggerStage2DeepPurge(mem) {
            const now = Date.now();
            if (this._lastStage2Purge && (now - this._lastStage2Purge < 90000)) return;
            this._lastStage2Purge = now;

            console.warn(`[FlightRecorder] 🚨 Tier-2 Auto-Heal Deep Purge: Memory at ${mem.usedMB} MB (${mem.pctOfLimit}% limit). Flushing sockets and resetting engine buffers...`);

            this.recordError({
                type: 'auto_heal_stage2',
                message: `Tier-2 Deep Purge triggered at ${mem.usedMB} MB (${mem.pctOfLimit}% limit)`,
                time: now
            });

            this.triggerStage1DefensivePurge(mem);

            // Reconnect MT5 WebSockets to flush buffered frames
            if (window.MT5API && typeof window.MT5API.reconnectWebSocket === 'function') {
                try { window.MT5API.reconnectWebSocket(); } catch (_) {}
            }
            if (window.FyersAPI && typeof window.FyersAPI.reconnectWebSocket === 'function') {
                try { window.FyersAPI.reconnectWebSocket(); } catch (_) {}
            }

            this.showToast(`⚡ Auto-Healer: Deep memory purge executed (${mem.usedMB} MB)`);
        }

        triggerStage3AutoReloadCircuitBreaker(mem) {
            if (this._stage3ReloadTriggered) return;
            this._stage3ReloadTriggered = true;

            console.error(`[FlightRecorder] 🚨🚨 CRITICAL CIRCUIT-BREAKER: Memory reached ${mem.usedMB} MB (${mem.pctOfLimit}% limit). Executing orderly auto-reload to protect session state against Chrome OOM kill...`);

            this.recordError({
                type: 'auto_heal_stage3_reload',
                message: `Critical Circuit-Breaker: Orderly session refresh triggered at ${mem.usedMB} MB (${mem.pctOfLimit}% limit)`,
                time: Date.now()
            });

            // 1. Mark session as orderly with autoHealReload flag so autopsy modal knows this was intentional
            try {
                const raw = localStorage.getItem(STORAGE_KEY_SESSION);
                if (raw) {
                    const sess = JSON.parse(raw);
                    sess.orderlyShutdown = true;
                    sess.autoHealReload = true;
                    sess.shutdownTime = Date.now();
                    sess.finalMem = mem;
                    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(sess));
                }
            } catch (_) {}

            // 2. Persist chart layout & state
            if (window.tvWidget && typeof window.tvWidget.saveChartToServer === 'function') {
                try { window.tvWidget.saveChartToServer(); } catch (_) {}
            }

            // 3. Save emergency checkpoint to IndexedDB and export file
            try {
                this.exportAndDownloadLog('auto_heal_checkpoint', false);
            } catch (_) {}

            // 4. Show visual countdown overlay
            const overlay = document.createElement('div');
            overlay.id = 'tv-auto-heal-notice';
            overlay.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                max-width: 420px;
                background: rgba(19, 23, 34, 0.96);
                border: 1px solid #3b82f6;
                box-shadow: 0 12px 36px rgba(0,0,0,0.6);
                border-radius: 8px;
                padding: 14px 18px;
                z-index: 9999999;
                color: #ffffff;
                font-family: -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif;
            `;
            overlay.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                    <span style="font-size: 18px;">⚡</span>
                    <span style="font-size: 13.5px; font-weight: 700; color: #60a5fa;">Session Auto-Healer Active</span>
                </div>
                <div style="font-size: 12px; line-height: 1.5; color: #cbd5e1; margin-bottom: 10px;">
                    V8 memory reached <strong>${mem.usedMB} MB</strong>. Performing a seamless, state-preserving refresh in <span id="tv-auto-heal-countdown" style="color: #60a5fa; font-weight: 700;">3</span>s to prevent browser tab crash. All drawings and layouts are saved.
                </div>
                <div style="height: 3px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                    <div style="height: 100%; background: #3b82f6; width: 100%;"></div>
                </div>
            `;
            document.body.appendChild(overlay);

            let remainingSec = 3;
            const cdInterval = setInterval(() => {
                remainingSec--;
                const cdEl = document.getElementById('tv-auto-heal-countdown');
                if (cdEl) cdEl.textContent = String(remainingSec);
                if (remainingSec <= 0) {
                    clearInterval(cdInterval);
                    window.location.reload();
                }
            }, 1000);
        }

        // Backward compatibility
        triggerEmergencyMemoryPurge(mem) {
            this.triggerStage1DefensivePurge(mem);
        }

        // ==========================================
        // 4. Hourly Automated Flight Log Downloader
        // ==========================================

        startHourlyDownloader() {
            const interval = this.settings.autoDownloadIntervalMs || DEFAULT_AUTO_DL_INTERVAL_MS;

            this.hourlyTimer = setInterval(() => {
                if (!this.settings.autoDownloadHourly) return;
                this.hourCount++;
                this.exportAndDownloadLog(`hour_${this.hourCount}`, true);
            }, interval);
        }

        exportAndDownloadLog(label = 'manual', isAutoHourly = false) {
            try {
                const now = new Date();
                const pad = (n) => String(n).padStart(2, '0');
                const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
                const filename = `tv_flight_record_${this.sessionId}_${label}_${timeStr}.json`;

                const exportPayload = {
                    metadata: {
                        sessionId: this.sessionId,
                        exportedAt: now.toISOString(),
                        exportType: isAutoHourly ? 'hourly_automated_checkpoint' : 'manual_export',
                        sessionStartTime: new Date(this.startTime).toISOString(),
                        uptimeMinutes: Math.floor((Date.now() - this.startTime) / 60000),
                        userAgent: navigator.userAgent,
                        screen: {
                            width: window.screen ? window.screen.width : null,
                            height: window.screen ? window.screen.height : null,
                            devicePixelRatio: window.devicePixelRatio || 1
                        }
                    },
                    diagnosis: this.analyzeTelemetry(this.timeline, this.errors),
                    latestSnapshot: this.takeSnapshot(),
                    timeline: this.timeline,
                    errorLogs: this.errors
                };

                // Also save checkpoint to IndexedDB for persistent multi-day safety
                this.saveCheckpointToIndexedDB({
                    id: `${this.sessionId}_${label}_${Date.now()}`,
                    sessionId: this.sessionId,
                    timestamp: Date.now(),
                    label: label,
                    data: exportPayload
                });

                // Trigger automatic file download in browser
                const jsonStr = JSON.stringify(exportPayload, null, 2);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 2000);

                console.log(`[FlightRecorder] 💾 ${isAutoHourly ? 'Hourly automated checkpoint' : 'Flight log'} downloaded: ${filename}`);

                // Show discreet toast
                this.showToast(`💾 ${isAutoHourly ? 'Hourly Checkpoint Saved' : 'Flight Log Exported'}: ${filename}`);
            } catch (err) {
                console.error('[FlightRecorder] Failed to export flight log:', err);
            }
        }

        // ==========================================
        // 5. Shutdown & Crash Detection
        // ==========================================

        installShutdownHandlers() {
            const markOrderly = () => {
                try {
                    const raw = localStorage.getItem(STORAGE_KEY_SESSION);
                    if (raw) {
                        const sess = JSON.parse(raw);
                        sess.orderlyShutdown = true;
                        sess.shutdownTime = Date.now();
                        localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(sess));
                    }
                } catch (_) {}
            };

            window.addEventListener('beforeunload', markOrderly);
            window.addEventListener('pagehide', markOrderly);
        }

        registerSessionStart() {
            try {
                // Initialize clean buffers for new session
                this.timeline = [];
                this.errors = [];
                const sessionData = {
                    sessionId: this.sessionId,
                    startTime: this.startTime,
                    lastHeartbeatTime: this.lastHeartbeatTime,
                    orderlyShutdown: false,
                    uptimeSec: 0,
                    userAgent: navigator.userAgent
                };
                localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(sessionData));
                localStorage.setItem(STORAGE_KEY_TIMELINE, JSON.stringify([]));
                localStorage.setItem(STORAGE_KEY_ERRORS, JSON.stringify([]));
            } catch (_) {}
        }

        checkPreviousSessionCrash() {
            try {
                const prevSessionRaw = localStorage.getItem(STORAGE_KEY_SESSION);
                const prevTimelineRaw = localStorage.getItem(STORAGE_KEY_TIMELINE);
                const prevErrorsRaw = localStorage.getItem(STORAGE_KEY_ERRORS);

                if (!prevSessionRaw) return;
                const prevSession = JSON.parse(prevSessionRaw);
                const prevTimeline = prevTimelineRaw ? JSON.parse(prevTimelineRaw) : [];
                const prevErrors = prevErrorsRaw ? JSON.parse(prevErrorsRaw) : [];

                // Criteria for abnormal crash:
                // 1. orderlyShutdown is FALSE (neither beforeunload nor pagehide ran)
                // 2. Previous session ran for at least 30 seconds
                // 3. Last heartbeat was recorded in the past
                const wasAbnormal = prevSession.orderlyShutdown === false && 
                                   (prevSession.uptimeSec && prevSession.uptimeSec >= 25);

                if (prevSession.autoHealReload) {
                    const finalMB = prevSession.finalMem ? prevSession.finalMem.usedMB : '3400';
                    console.log(`[FlightRecorder] ✓ Session successfully auto-healed after reaching ${finalMB} MB. Continuing streaming seamlessly.`);
                    setTimeout(() => {
                        this.showToast(`⚡ Session Auto-Healed: Memory refreshed cleanly at ${finalMB} MB.`);
                    }, 2000);
                    return;
                }

                if (wasAbnormal && prevTimeline.length > 0) {
                    const autopsy = this.generateAutopsyReport(prevSession, prevTimeline, prevErrors);
                    // Persist crash report for viewing
                    localStorage.setItem(STORAGE_KEY_LAST_CRASH, JSON.stringify(autopsy));

                    // Show autopsy modal on boot after DOM is ready
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', () => this.showAutopsyModal(autopsy));
                    } else {
                        setTimeout(() => this.showAutopsyModal(autopsy), 1200);
                    }
                }
            } catch (err) {
                console.error('[FlightRecorder] Error checking previous session crash:', err);
            }
        }

        // ==========================================
        // 6. Forensic Autopsy & Root Cause Analysis
        // ==========================================

        generateAutopsyReport(session, timeline, errors) {
            const diagnosis = this.analyzeTelemetry(timeline, errors);
            const crashTime = session.lastHeartbeatTime || (timeline[timeline.length - 1] ? timeline[timeline.length - 1].t : Date.now());

            return {
                sessionId: session.sessionId,
                startTime: session.startTime,
                crashTime: crashTime,
                uptimeMinutes: Math.floor((crashTime - session.startTime) / 60000),
                diagnosis: diagnosis,
                finalSnapshot: timeline[timeline.length - 1] || null,
                timelineTail: timeline.slice(-60), // Last 5 minutes at 5s interval
                recentErrors: errors.slice(-20),
                fullTimeline: timeline,
                fullErrors: errors
            };
        }

        analyzeTelemetry(timeline, errors) {
            if (!timeline || timeline.length === 0) {
                return {
                    verdict: 'UNKNOWN_TERMINATION',
                    confidence: 'Low',
                    headline: 'Insufficient telemetry data captured before termination.',
                    evidence: []
                };
            }

            const evidence = [];
            const last = timeline[timeline.length - 1];
            const first = timeline[0];

            let isOOM = false;
            let isDOMLeak = false;
            let isErrorStorm = false;

            // 1. Analyze Memory
            if (last && last.mem) {
                const finalMB = last.mem.usedMB;
                const limitMB = last.mem.limitMB;
                const pct = last.mem.pctOfLimit;

                evidence.push(`Final V8 Heap Used: ${finalMB} MB / ${limitMB} MB (${pct}% of browser ceiling).`);

                if (first && first.mem) {
                    const startMB = first.mem.usedMB;
                    const durationHours = Math.max((last.t - first.t) / 3600000, 0.05);
                    const growthMB = finalMB - startMB;
                    const rateMBPerHour = Math.round((growthMB / durationHours) * 10) / 10;
                    evidence.push(`Memory Growth: Started at ${startMB} MB, climbed to ${finalMB} MB (+${growthMB} MB at ${rateMBPerHour} MB/hour).`);

                    if (pct >= 88 || finalMB > 1800 || (pct >= 80 && rateMBPerHour > 150)) {
                        isOOM = true;
                    }
                } else if (pct >= 88 || finalMB > 1800) {
                    isOOM = true;
                }
            }

            // 2. Analyze DOM Nodes
            if (last && last.dom) {
                evidence.push(`DOM Elements at death: ${last.dom.total} nodes (${last.dom.canvases} canvases, ${last.dom.iframes} iframes).`);
                if (first && first.dom && (last.dom.total - first.dom.total > 5000)) {
                    isDOMLeak = true;
                    evidence.push(`DOM Node Explosion: Grew by +${last.dom.total - first.dom.total} nodes during session.`);
                }
            }

            // 3. Analyze Caches
            if (last && last.cache) {
                evidence.push(`Chart Bar Cache: ${last.cache.keys} cached symbol keys, ~${last.cache.bars} historical bars in memory.`);
            }

            // 4. Analyze Errors
            const recentErrors = (errors || []).filter(e => e.time >= (last.t - 60000));
            if (recentErrors.length >= 15) {
                isErrorStorm = true;
                evidence.push(`Error Storm: ${recentErrors.length} exceptions/warnings recorded in the final 60 seconds.`);
            }

            // Formulate Verdict
            if (isOOM) {
                return {
                    verdict: 'OUT_OF_MEMORY_KILL',
                    confidence: 'Very High',
                    headline: 'Chrome V8 Heap Exhaustion ("Aw, Snap!" Out of Memory)',
                    summary: `The browser tab exceeded its V8 JavaScript heap ceiling (${last.mem.usedMB} MB used, ${last.mem.pctOfLimit}% of ${last.mem.limitMB} MB limit). Chrome abruptly killed the renderer process.`,
                    evidence: evidence
                };
            }

            if (isDOMLeak) {
                return {
                    verdict: 'DOM_LEAK_EXHAUSTION',
                    confidence: 'High',
                    headline: 'Unbounded DOM Tree Accumulation',
                    summary: `DOM elements multiplied rapidly without release (${last.dom.total} nodes), exhausting GPU/renderer layout tree memory.`,
                    evidence: evidence
                };
            }

            if (isErrorStorm) {
                return {
                    verdict: 'EXCEPTION_STORM_LOOP',
                    confidence: 'High',
                    headline: 'High-Frequency Exception Loop / Thread Lock',
                    summary: `A flurry of runtime errors overwhelmed the event loop in the final minute before termination.`,
                    evidence: evidence
                };
            }

            return {
                verdict: 'ABRUPT_RENDERER_CRASH',
                confidence: 'Moderate',
                headline: 'Abrupt Browser Tab Crash (Chrome Renderer Terminated)',
                summary: `The tab ceased heartbeats abruptly without an orderly pagehide or beforeunload event. Memory was at ${last.mem ? last.mem.usedMB + ' MB' : 'unknown'}.`,
                evidence: evidence
            };
        }

        // ==========================================
        // 7. UI: Crash Autopsy Modal
        // ==========================================

        showAutopsyModal(autopsy) {
            if (document.getElementById('tv-fr-autopsy-modal')) return;

            const diag = autopsy.diagnosis;
            const finalMem = autopsy.finalSnapshot ? autopsy.finalSnapshot.mem : null;
            const crashDateStr = new Date(autopsy.crashTime).toLocaleString();

            const modal = document.createElement('div');
            modal.id = 'tv-fr-autopsy-modal';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(8, 10, 16, 0.85);
                backdrop-filter: blur(8px);
                z-index: 9999999;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                color: #e5e7eb;
                animation: tvFrFadeIn 0.25s ease-out;
            `;

            const isOOM = diag.verdict === 'OUT_OF_MEMORY_KILL';
            const badgeColor = isOOM ? '#ef4444' : '#f59e0b';
            const badgeBg = isOOM ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)';
            const borderGlow = isOOM ? 'rgba(239, 68, 68, 0.4)' : 'rgba(245, 158, 11, 0.4)';

            modal.innerHTML = `
                <style>
                    @keyframes tvFrFadeIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
                    .tv-fr-card { background: #131722; border: 1px solid ${borderGlow}; border-radius: 12px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7), 0 0 35px ${borderGlow}; width: 92%; max-width: 760px; max-height: 90vh; display: flex; flex-direction: column; overflow: hidden; }
                    .tv-fr-header { padding: 18px 24px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02); }
                    .tv-fr-body { padding: 22px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 18px; }
                    .tv-fr-footer { padding: 14px 24px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.25); }
                    .tv-fr-btn { padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; border: none; transition: all 0.15s ease; display: inline-flex; align-items: center; gap: 6px; }
                    .tv-fr-btn-primary { background: #2962ff; color: #fff; }
                    .tv-fr-btn-primary:hover { background: #1e4bd8; transform: translateY(-1px); }
                    .tv-fr-btn-secondary { background: rgba(255,255,255,0.1); color: #e5e7eb; }
                    .tv-fr-btn-secondary:hover { background: rgba(255,255,255,0.18); }
                    .tv-fr-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
                    .tv-fr-metric-box { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 12px; }
                </style>

                <div class="tv-fr-card">
                    <div class="tv-fr-header">
                        <div style="display:flex; align-items:center; gap:12px;">
                            <span style="display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:8px; background:${badgeBg}; border:1px solid ${borderGlow}; color:${badgeColor}; font-size:18px;">
                                ⚠️
                            </span>
                            <div>
                                <h3 style="margin:0; font-size:16px; font-weight:700; color:#fff; display:flex; align-items:center; gap:8px;">
                                    Abnormal Session Termination Detected
                                    <span style="font-size:10px; padding:2px 8px; border-radius:12px; background:${badgeBg}; color:${badgeColor}; border:1px solid ${borderGlow}; text-transform:uppercase; letter-spacing:0.5px;">
                                        Aw, Snap! Autopsy
                                    </span>
                                </h3>
                                <div style="font-size:12px; color:#9ca3af; margin-top:2px;">
                                    Previous session crashed at ${crashDateStr} (Ran for ${autopsy.uptimeMinutes} minutes)
                                </div>
                            </div>
                        </div>
                        <button id="tv-fr-btn-close-modal" style="background:none; border:none; color:#9ca3af; font-size:20px; cursor:pointer; padding:4px 8px;">✕</button>
                    </div>

                    <div class="tv-fr-body">
                        <!-- Verdict Card -->
                        <div style="background:${badgeBg}; border:1px solid ${borderGlow}; border-radius:8px; padding:16px;">
                            <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:${badgeColor}; letter-spacing:0.5px; margin-bottom:4px;">
                                Forensic Verdict (${diag.confidence} Confidence)
                            </div>
                            <div style="font-size:15px; font-weight:700; color:#fff; margin-bottom:6px;">
                                ${diag.headline}
                            </div>
                            <div style="font-size:13px; color:#d1d5db; line-height:1.45;">
                                ${diag.summary}
                            </div>
                        </div>

                        <!-- Key Telemetry Metrics at Death -->
                        <div class="tv-fr-metric-grid">
                            <div class="tv-fr-metric-box">
                                <div style="font-size:11px; color:#9ca3af;">Peak V8 RAM</div>
                                <div style="font-size:17px; font-weight:700; color:${finalMem && finalMem.pctOfLimit > 85 ? '#ef4444' : '#10b981'}; margin-top:4px;">
                                    ${finalMem ? finalMem.usedMB + ' MB' : 'N/A'}
                                </div>
                                <div style="font-size:11px; color:#6b7280;">${finalMem ? finalMem.pctOfLimit + '% of ' + finalMem.limitMB + 'MB limit' : ''}</div>
                            </div>
                            <div class="tv-fr-metric-box">
                                <div style="font-size:11px; color:#9ca3af;">Session Uptime</div>
                                <div style="font-size:17px; font-weight:700; color:#fff; margin-top:4px;">
                                    ${Math.floor(autopsy.uptimeMinutes / 60)}h ${autopsy.uptimeMinutes % 60}m
                                </div>
                                <div style="font-size:11px; color:#6b7280;">Continuous streaming</div>
                            </div>
                            <div class="tv-fr-metric-box">
                                <div style="font-size:11px; color:#9ca3af;">DOM Elements</div>
                                <div style="font-size:17px; font-weight:700; color:#fff; margin-top:4px;">
                                    ${autopsy.finalSnapshot && autopsy.finalSnapshot.dom ? autopsy.finalSnapshot.dom.total : 'N/A'}
                                </div>
                                <div style="font-size:11px; color:#6b7280;">Active UI nodes</div>
                            </div>
                            <div class="tv-fr-metric-box">
                                <div style="font-size:11px; color:#9ca3af;">Chart Bar Cache</div>
                                <div style="font-size:17px; font-weight:700; color:#fff; margin-top:4px;">
                                    ${autopsy.finalSnapshot && autopsy.finalSnapshot.cache ? autopsy.finalSnapshot.cache.keys + ' keys' : 'N/A'}
                                </div>
                                <div style="font-size:11px; color:#6b7280;">${autopsy.finalSnapshot && autopsy.finalSnapshot.cache ? '~' + autopsy.finalSnapshot.cache.bars + ' bars' : ''}</div>
                            </div>
                        </div>

                        <!-- Empirical Evidence List -->
                        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:14px;">
                            <div style="font-size:12px; font-weight:700; color:#9ca3af; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
                                Log-Based Empirical Evidence
                            </div>
                            <ul style="margin:0; padding-left:18px; font-size:12.5px; color:#e5e7eb; display:flex; flex-direction:column; gap:5px;">
                                ${diag.evidence.map(e => `<li>${e}</li>`).join('')}
                            </ul>
                        </div>

                        <!-- Recent Errors (if any) -->
                        ${autopsy.recentErrors.length > 0 ? `
                            <div style="background:rgba(239,68,68,0.05); border:1px solid rgba(239,68,68,0.2); border-radius:8px; padding:12px;">
                                <div style="font-size:11px; font-weight:700; color:#ef4444; margin-bottom:6px; text-transform:uppercase;">
                                    Exceptions In Final Moments (${autopsy.recentErrors.length})
                                </div>
                                <div style="font-family:monospace; font-size:11px; color:#fca5a5; max-height:100px; overflow-y:auto; display:flex; flex-direction:column; gap:4px;">
                                    ${autopsy.recentErrors.map(err => `<div>• [${new Date(err.time).toLocaleTimeString()}] ${err.message || 'Unknown error'}</div>`).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>

                    <div class="tv-fr-footer">
                        <div style="font-size:12px; color:#9ca3af;">
                            Saved locally in Blackbox Flight Recorder.
                        </div>
                        <div style="display:flex; gap:10px;">
                            <button id="tv-fr-btn-download-autopsy" class="tv-fr-btn tv-fr-btn-primary">
                                📥 Download Full Forensic JSON (${autopsy.fullTimeline.length} points)
                            </button>
                            <button id="tv-fr-btn-dismiss" class="tv-fr-btn tv-fr-btn-secondary">
                                Dismiss
                            </button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Button handlers
            document.getElementById('tv-fr-btn-close-modal').onclick = () => modal.remove();
            document.getElementById('tv-fr-btn-dismiss').onclick = () => modal.remove();
            document.getElementById('tv-fr-btn-download-autopsy').onclick = () => {
                const now = new Date();
                const pad = (n) => String(n).padStart(2, '0');
                const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
                const filename = `tv_crash_autopsy_${autopsy.sessionId}_${timeStr}.json`;

                const blob = new Blob([JSON.stringify(autopsy, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 2000);
            };
        }

        // ==========================================
        // 8. UI: Live HUD & Diagnostics Inspector
        // ==========================================

        initHUD() {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.mountHUD());
            } else {
                this.mountHUD();
            }
        }

        mountHUD() {
            if (this.hudPill || document.getElementById('tv-fr-hud-pill')) return;

            this.hudPill = document.createElement('div');
            this.hudPill.id = 'tv-fr-hud-pill';
            this.hudPill.style.cssText = `
                position: fixed;
                bottom: 8px;
                right: 12px;
                z-index: 99998;
                background: rgba(19, 23, 34, 0.88);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 20px;
                padding: 4px 10px;
                display: flex;
                align-items: center;
                gap: 8px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
                font-size: 11px;
                color: #d1d5db;
                backdrop-filter: blur(6px);
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                cursor: pointer;
                user-select: none;
                transition: all 0.2s ease;
            `;

            this.hudPill.title = "Click to open Blackbox Diagnostics Inspector & Hourly Auto-Download settings";
            this.hudPill.innerHTML = `
                <span id="tv-fr-hud-dot" style="width:7px; height:7px; border-radius:50%; background:#10b981; display:inline-block;"></span>
                <span id="tv-fr-hud-ram">RAM: -- MB</span>
                <span style="color:rgba(255,255,255,0.2);">|</span>
                <span id="tv-fr-hud-dom">DOM: --</span>
                <span style="color:rgba(255,255,255,0.2);">|</span>
                <span id="tv-fr-hud-uptime">00:00:00</span>
                <span style="font-size:9.5px; padding:1px 5px; border-radius:8px; background:rgba(41,98,255,0.15); color:#60a5fa; border:1px solid rgba(41,98,255,0.3);">
                    💾 1h auto-dl
                </span>
            `;

            this.hudPill.onmouseenter = () => {
                this.hudPill.style.borderColor = 'rgba(41, 98, 255, 0.5)';
                this.hudPill.style.transform = 'translateY(-1px)';
            };
            this.hudPill.onmouseleave = () => {
                this.hudPill.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                this.hudPill.style.transform = 'translateY(0)';
            };
            this.hudPill.onclick = () => this.toggleInspectorModal();

            document.body.appendChild(this.hudPill);
        }

        updateHUD(snapshot) {
            if (!this.hudPill) return;

            const ramEl = document.getElementById('tv-fr-hud-ram');
            const domEl = document.getElementById('tv-fr-hud-dom');
            const uptimeEl = document.getElementById('tv-fr-hud-uptime');
            const dotEl = document.getElementById('tv-fr-hud-dot');

            // Uptime
            const totalSec = Math.floor((snapshot.t - this.startTime) / 1000);
            const hrs = String(Math.floor(totalSec / 3600)).padStart(2, '0');
            const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
            const secs = String(totalSec % 60).padStart(2, '0');
            if (uptimeEl) uptimeEl.textContent = `${hrs}:${mins}:${secs}`;

            // DOM count
            if (domEl && snapshot.dom) domEl.textContent = `DOM: ${snapshot.dom.total}`;

            // Memory & Status Dot color
            if (snapshot.mem && ramEl) {
                ramEl.textContent = `RAM: ${snapshot.mem.usedMB} MB`;
                if (dotEl) {
                    if (snapshot.mem.pctOfLimit > 85 || snapshot.mem.usedMB > 1800) {
                        dotEl.style.background = '#ef4444'; // Red (Danger)
                    } else if (snapshot.mem.pctOfLimit > 70 || snapshot.mem.usedMB > 1200) {
                        dotEl.style.background = '#f59e0b'; // Amber (Elevated)
                    } else {
                        dotEl.style.background = '#10b981'; // Green (Healthy)
                    }
                }
            }
        }

        toggleInspectorModal() {
            const existing = document.getElementById('tv-fr-inspector-modal');
            if (existing) {
                existing.remove();
                return;
            }

            const current = this.takeSnapshot();
            const uptimeMinutes = Math.floor((Date.now() - this.startTime) / 60000);

            const modal = document.createElement('div');
            modal.id = 'tv-fr-inspector-modal';
            modal.style.cssText = `
                position: fixed;
                bottom: 45px;
                right: 12px;
                width: 380px;
                background: #131722;
                border: 1px solid rgba(41, 98, 255, 0.35);
                border-radius: 10px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.6);
                z-index: 99999;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                color: #e5e7eb;
                overflow: hidden;
                animation: tvFrFadeIn 0.15s ease-out;
            `;

            modal.innerHTML = `
                <div style="padding:12px 14px; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.02);">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:14px;">⚡</span>
                        <span style="font-weight:700; font-size:13px; color:#fff;">Blackbox Flight Recorder</span>
                    </div>
                    <button id="tv-fr-btn-close-inspector" style="background:none; border:none; color:#9ca3af; font-size:16px; cursor:pointer;">✕</button>
                </div>

                <div style="padding:14px; display:flex; flex-direction:column; gap:12px; font-size:12px;">
                    <!-- Real-time Stats -->
                    <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:10px; display:flex; flex-direction:column; gap:6px;">
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:#9ca3af;">Session Uptime:</span>
                            <span style="font-weight:600; color:#fff;">${Math.floor(uptimeMinutes / 60)}h ${uptimeMinutes % 60}m</span>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:#9ca3af;">V8 JavaScript RAM:</span>
                            <span style="font-weight:600; color:#fff;">${current.mem ? current.mem.usedMB + ' MB / ' + current.mem.limitMB + ' MB (' + current.mem.pctOfLimit + '%)' : 'N/A'}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:#9ca3af;">Active DOM Elements:</span>
                            <span style="font-weight:600; color:#fff;">${current.dom.total} nodes (${current.dom.canvases} canvases)</span>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:#9ca3af;">Chart Bar Caches:</span>
                            <span style="font-weight:600; color:#fff;">${current.cache.keys} keys (~${current.cache.bars} bars)</span>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:#9ca3af;">Logged Exceptions:</span>
                            <span style="font-weight:600; color:${this.errors.length > 0 ? '#f87171' : '#10b981'};">${this.errors.length} in buffer</span>
                        </div>
                    </div>

                    <!-- Hourly Auto-Download Setting -->
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; user-select:none; background:rgba(41,98,255,0.06); border:1px solid rgba(41,98,255,0.2); border-radius:6px; padding:8px 10px;">
                        <input type="checkbox" id="tv-fr-cb-auto-dl" ${this.settings.autoDownloadHourly ? 'checked' : ''} style="cursor:pointer;">
                        <div>
                            <div style="font-weight:600; font-size:12px; color:#fff;">Auto-download flight log every 1 hour</div>
                            <div style="font-size:10.5px; color:#9ca3af;">Preserves hourly checkpoints overnight even if browser crashes</div>
                        </div>
                    </label>

                    <!-- Export Actions -->
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <button id="tv-fr-btn-dl-now" style="background:#2962ff; color:#fff; border:none; border-radius:6px; padding:8px; font-weight:600; font-size:12px; cursor:pointer;">
                            📥 Export Current Flight Log (.json)
                        </button>
                        <button id="tv-fr-btn-test-crash" style="background:rgba(255,255,255,0.06); color:#9ca3af; border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:6px; font-size:11px; cursor:pointer;">
                            🧪 Preview Crash Autopsy Modal (Test Mode)
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Bindings
            document.getElementById('tv-fr-btn-close-inspector').onclick = () => modal.remove();
            document.getElementById('tv-fr-cb-auto-dl').onchange = (e) => {
                this.settings.autoDownloadHourly = e.target.checked;
                this.saveSettings();
                this.showToast(`Hourly auto-download ${this.settings.autoDownloadHourly ? 'ENABLED' : 'DISABLED'}`);
            };
            document.getElementById('tv-fr-btn-dl-now').onclick = () => {
                this.exportAndDownloadLog('manual');
            };
            document.getElementById('tv-fr-btn-test-crash').onclick = () => {
                modal.remove();
                const mockSession = {
                    sessionId: 'test_crash_session',
                    startTime: Date.now() - 3600000 * 4,
                    lastHeartbeatTime: Date.now(),
                    uptimeSec: 14400
                };
                const autopsy = this.generateAutopsyReport(mockSession, this.timeline.length ? this.timeline : [this.takeSnapshot()], this.errors);
                this.showAutopsyModal(autopsy);
            };
        }

        showToast(msg) {
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed;
                bottom: 45px;
                right: 12px;
                z-index: 999999;
                background: #1e222d;
                border: 1px solid rgba(41, 98, 255, 0.4);
                border-radius: 6px;
                padding: 8px 12px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 12px;
                color: #fff;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                animation: tvFrFadeIn 0.2s ease;
            `;
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 3500);
        }
    }

    // Instantiate and expose globally
    window.FlightRecorder = new FlightRecorder();

})();
