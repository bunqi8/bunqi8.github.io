/**
 * ScriptRepoManager - GitHub & Hugging Face Indicator & Strategy Sync Engine
 * 
 * Features:
 * - Multi-repository management (GitHub & Hugging Face)
 * - Multi-token / reusable token management with browser-side masking
 * - Commit-SHA change detection to avoid redundant fetches & respect API limits
 * - Dynamic script discovery in /, indicators/, strategy/, strategies/
 * - Fail-safe offline caching (local fallback if network is offline / rate-limited)
 * - Coexistence of remote synced scripts and local working copies (forks)
 * - Hot-swap triggers for active chart studies
 */

(function (window) {
    'use strict';

    const REPOS_STORAGE_KEY = 'tv_script_repos';
    const TOKENS_STORAGE_KEY = 'tv_script_tokens';
    const REMOTE_INDICATORS_KEY = 'tv_remote_indicators';

    class ScriptRepoManager {
        constructor() {
            this.repos = this._loadRepos();
            this.tokens = this._loadTokens();
            this.remoteIndicators = this._loadRemoteIndicators();
            this.isSyncing = false;
        }

        // ==========================================
        // STORAGE METHODS
        // ==========================================

        _loadRepos() {
            try {
                return JSON.parse(localStorage.getItem(REPOS_STORAGE_KEY) || '[]');
            } catch (_) {
                return [];
            }
        }

        _saveRepos() {
            localStorage.setItem(REPOS_STORAGE_KEY, JSON.stringify(this.repos));
            window.dispatchEvent(new CustomEvent('tv_script_repos_updated', { detail: this.repos }));
        }

        _loadTokens() {
            try {
                return JSON.parse(localStorage.getItem(TOKENS_STORAGE_KEY) || '[]');
            } catch (_) {
                return [];
            }
        }

        _saveTokens() {
            localStorage.setItem(TOKENS_STORAGE_KEY, JSON.stringify(this.tokens));
            window.dispatchEvent(new CustomEvent('tv_script_tokens_updated', { detail: this.tokens }));
        }

        _loadRemoteIndicators() {
            try {
                return JSON.parse(localStorage.getItem(REMOTE_INDICATORS_KEY) || '{}');
            } catch (_) {
                return {};
            }
        }

        _saveRemoteIndicators() {
            localStorage.setItem(REMOTE_INDICATORS_KEY, JSON.stringify(this.remoteIndicators));
            window.dispatchEvent(new CustomEvent('tv_remote_scripts_updated', { detail: this.remoteIndicators }));
        }

        // ==========================================
        // TOKEN MANAGEMENT
        // ==========================================

        getTokens() {
            return [...this.tokens];
        }

        getTokenById(tokenId) {
            return this.tokens.find(t => t.id === tokenId);
        }

        addToken(name, provider, tokenValue) {
            if (!tokenValue || !tokenValue.trim()) throw new Error("Token value cannot be empty.");
            const cleanToken = tokenValue.trim();
            const id = 'token_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
            const tokenObj = {
                id,
                name: (name && name.trim()) || (provider === 'github' ? 'GitHub Token' : 'HF Token'),
                provider: provider || (cleanToken.startsWith('hf_') ? 'huggingface' : 'github'),
                token: cleanToken,
                createdAt: Date.now()
            };
            this.tokens.push(tokenObj);
            this._saveTokens();
            return tokenObj;
        }

        updateToken(tokenId, name, tokenValue) {
            const idx = this.tokens.findIndex(t => t.id === tokenId);
            if (idx === -1) throw new Error("Token not found.");
            if (name && name.trim()) this.tokens[idx].name = name.trim();
            if (tokenValue && tokenValue.trim() && !tokenValue.includes('•••')) {
                this.tokens[idx].token = tokenValue.trim();
            }
            this._saveTokens();
            return this.tokens[idx];
        }

        deleteToken(tokenId) {
            this.tokens = this.tokens.filter(t => t.id !== tokenId);
            // Unlink from repos
            this.repos.forEach(r => {
                if (r.tokenId === tokenId) r.tokenId = null;
            });
            this._saveTokens();
            this._saveRepos();
        }

        maskToken(rawToken) {
            if (!rawToken || typeof rawToken !== 'string') return '';
            if (rawToken.length <= 8) return '••••••••';
            const prefix = rawToken.substring(0, 4);
            const suffix = rawToken.substring(rawToken.length - 4);
            return `${prefix}••••••••${suffix}`;
        }

        // ==========================================
        // REPOSITORY MANAGEMENT
        // ==========================================

        getRepos() {
            return [...this.repos];
        }

        getRepoById(repoId) {
            return this.repos.find(r => r.id === repoId);
        }

        /**
         * Parses repository URL or shorthand string
         */
        parseRepoInput(inputUrl) {
            if (!inputUrl || typeof inputUrl !== 'string') throw new Error("Repository URL is required.");
            const trimmed = inputUrl.trim();

            // 1. Hugging Face
            if (trimmed.includes('huggingface.co') || trimmed.startsWith('hf:')) {
                let clean = trimmed.replace(/^https?:\/\/huggingface\.co\//, '').replace(/^hf:/, '').replace(/\/$/, '');
                let repoType = 'dataset';
                if (clean.startsWith('datasets/')) {
                    repoType = 'dataset';
                    clean = clean.replace('datasets/', '');
                } else if (clean.startsWith('models/')) {
                    repoType = 'model';
                    clean = clean.replace('models/', '');
                } else if (clean.startsWith('spaces/')) {
                    repoType = 'space';
                    clean = clean.replace('spaces/', '');
                }
                const parts = clean.split('/').filter(Boolean);
                if (parts.length < 2) throw new Error("Invalid Hugging Face repo format. Expected 'owner/repo' or 'datasets/owner/repo'.");
                const repoId = `${parts[0]}/${parts[1]}`;
                return {
                    type: 'huggingface',
                    repoType,
                    repoId,
                    owner: parts[0],
                    repo: parts[1],
                    url: `https://huggingface.co/${repoType === 'dataset' ? 'datasets/' : (repoType === 'space' ? 'spaces/' : '')}${repoId}`
                };
            }

            // 2. GitHub
            let clean = trimmed.replace(/^https?:\/\/github\.com\//, '').replace(/^github\.com\//, '').replace(/\/$/, '');
            let branch = 'main';
            if (clean.includes('/tree/')) {
                const [repoPart, branchPart] = clean.split('/tree/');
                clean = repoPart;
                branch = branchPart || 'main';
            }
            const parts = clean.split('/').filter(Boolean);
            if (parts.length < 2) throw new Error("Invalid GitHub repo format. Expected 'https://github.com/owner/repo' or 'owner/repo'.");
            const owner = parts[0];
            const repo = parts[1].replace(/\.git$/, '');

            return {
                type: 'github',
                owner,
                repo,
                branch,
                url: `https://github.com/${owner}/${repo}`
            };
        }

        addRepo(inputUrl, branch = 'main', tokenId = null) {
            const parsed = this.parseRepoInput(inputUrl);
            const id = 'repo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
            
            const repoObj = {
                id,
                type: parsed.type,
                url: parsed.url,
                owner: parsed.owner,
                repo: parsed.repo,
                repoId: parsed.repoId || `${parsed.owner}/${parsed.repo}`,
                repoType: parsed.repoType || 'dataset',
                branch: (branch && branch.trim()) || parsed.branch || 'main',
                tokenId: tokenId || null,
                lastCommitSha: null,
                lastSyncTime: null,
                syncStatus: 'idle',
                error: null,
                scriptCount: 0
            };

            this.repos.push(repoObj);
            this._saveRepos();
            return repoObj;
        }

        updateRepo(repoId, inputUrl, branch, tokenId) {
            const idx = this.repos.findIndex(r => r.id === repoId);
            if (idx === -1) throw new Error("Repository not found.");
            
            if (inputUrl && inputUrl.trim()) {
                const parsed = this.parseRepoInput(inputUrl);
                this.repos[idx].type = parsed.type;
                this.repos[idx].url = parsed.url;
                this.repos[idx].owner = parsed.owner;
                this.repos[idx].repo = parsed.repo;
                this.repos[idx].repoId = parsed.repoId || `${parsed.owner}/${parsed.repo}`;
                this.repos[idx].repoType = parsed.repoType || 'dataset';
            }
            if (branch && branch.trim()) {
                this.repos[idx].branch = branch.trim();
            }
            this.repos[idx].tokenId = tokenId !== undefined ? tokenId : this.repos[idx].tokenId;
            this._saveRepos();
            return this.repos[idx];
        }

        deleteRepo(repoId) {
            this.repos = this.repos.filter(r => r.id !== repoId);
            // Remove associated remote indicators
            for (const key in this.remoteIndicators) {
                if (this.remoteIndicators[key].repoId === repoId) {
                    delete this.remoteIndicators[key];
                }
            }
            this._saveRepos();
            this._saveRemoteIndicators();
        }

        // ==========================================
        // GITHUB API CLIENT
        // ==========================================

        async _fetchGitHubLatestCommit(repo) {
            const tokenObj = repo.tokenId ? this.getTokenById(repo.tokenId) : null;
            const headers = { 'Accept': 'application/vnd.github.v3+json' };
            if (tokenObj && tokenObj.token) {
                headers['Authorization'] = `Bearer ${tokenObj.token}`;
            }

            const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${repo.branch}`;
            const res = await fetch(apiUrl, { headers });
            if (!res.ok) {
                if (res.status === 404) throw new Error(`Repository or branch '${repo.branch}' not found on GitHub.`);
                if (res.status === 403) throw new Error("GitHub rate limit exceeded or access denied. Check access token.");
                throw new Error(`GitHub API error (${res.status}): ${res.statusText}`);
            }
            const data = await res.json();
            return data.sha;
        }

        async _fetchGitHubTree(repo, commitSha) {
            const tokenObj = repo.tokenId ? this.getTokenById(repo.tokenId) : null;
            const headers = { 'Accept': 'application/vnd.github.v3+json' };
            if (tokenObj && tokenObj.token) {
                headers['Authorization'] = `Bearer ${tokenObj.token}`;
            }

            const treeUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/${commitSha}?recursive=1`;
            const res = await fetch(treeUrl, { headers });
            if (!res.ok) throw new Error(`Failed to fetch GitHub tree (${res.status})`);
            const data = await res.json();
            const tree = data.tree || [];

            // Filter valid directories: root (/), indicators/, strategy/, strategies/
            return tree.filter(item => {
                if (item.type !== 'blob') return false;
                const path = item.path;
                if (!path.endsWith('.js')) return false;

                // Root .js file (no slash)
                if (!path.includes('/')) return true;

                // Inside indicators/ or strategy/ or strategies/
                const lower = path.toLowerCase();
                return lower.startsWith('indicators/') || lower.startsWith('strategy/') || lower.startsWith('strategies/');
            });
        }

        async _fetchGitHubFileContent(repo, filePath, commitSha) {
            const tokenObj = repo.tokenId ? this.getTokenById(repo.tokenId) : null;
            const headers = {};
            if (tokenObj && tokenObj.token) {
                headers['Authorization'] = `Bearer ${tokenObj.token}`;
            }

            // Raw GitHub URL
            const rawUrl = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${commitSha}/${filePath}`;
            try {
                const res = await fetch(rawUrl, { headers });
                if (res.ok) return await res.text();
            } catch (_) {}

            // Fallback to GitHub Contents API
            headers['Accept'] = 'application/vnd.github.v3.raw';
            const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${filePath}?ref=${commitSha}`;
            const res = await fetch(apiUrl, { headers });
            if (!res.ok) throw new Error(`Failed to read ${filePath} (${res.status})`);
            return await res.text();
        }

        // ==========================================
        // HUGGING FACE API CLIENT
        // ==========================================

        async _fetchHFLatestCommit(repo) {
            const tokenObj = repo.tokenId ? this.getTokenById(repo.tokenId) : null;
            const headers = {};
            if (tokenObj && tokenObj.token) {
                headers['Authorization'] = `Bearer ${tokenObj.token}`;
            }

            const typePath = repo.repoType === 'dataset' ? 'datasets' : (repo.repoType === 'space' ? 'spaces' : 'models');
            const apiUrl = `https://huggingface.co/api/${typePath}/${repo.repoId}/revision/${repo.branch}`;
            const res = await fetch(apiUrl, { headers });
            if (!res.ok) {
                if (res.status === 404) throw new Error(`Hugging Face repo '${repo.repoId}' or revision '${repo.branch}' not found.`);
                if (res.status === 401 || res.status === 403) throw new Error("Hugging Face unauthorized or private repo. Provide a valid HF token.");
                throw new Error(`Hugging Face API error (${res.status}): ${res.statusText}`);
            }
            const data = await res.json();
            return data.sha || data.oid || (data.commit && data.commit.id) || repo.branch;
        }

        async _fetchHFTree(repo) {
            const tokenObj = repo.tokenId ? this.getTokenById(repo.tokenId) : null;
            const headers = {};
            if (tokenObj && tokenObj.token) {
                headers['Authorization'] = `Bearer ${tokenObj.token}`;
            }

            const typePath = repo.repoType === 'dataset' ? 'datasets' : (repo.repoType === 'space' ? 'spaces' : 'models');
            const treeUrl = `https://huggingface.co/api/${typePath}/${repo.repoId}/tree/${repo.branch}?recursive=true`;
            const res = await fetch(treeUrl, { headers });
            if (!res.ok) throw new Error(`Failed to fetch Hugging Face tree (${res.status})`);
            const data = await res.json();
            const tree = Array.isArray(data) ? data : (data.entries || []);

            return tree.filter(item => {
                if (item.type !== 'file') return false;
                const path = item.path;
                if (!path.endsWith('.js')) return false;

                // Root .js file (no slash)
                if (!path.includes('/')) return true;

                // Inside indicators/ or strategy/ or strategies/
                const lower = path.toLowerCase();
                return lower.startsWith('indicators/') || lower.startsWith('strategy/') || lower.startsWith('strategies/');
            });
        }

        async _fetchHFFileContent(repo, filePath) {
            const tokenObj = repo.tokenId ? this.getTokenById(repo.tokenId) : null;
            const headers = {};
            if (tokenObj && tokenObj.token) {
                headers['Authorization'] = `Bearer ${tokenObj.token}`;
            }

            const prefix = repo.repoType === 'dataset' ? 'datasets/' : (repo.repoType === 'space' ? 'spaces/' : '');
            const rawUrl = `https://huggingface.co/${prefix}${repo.repoId}/raw/${repo.branch}/${filePath}`;
            const res = await fetch(rawUrl, { headers });
            if (!res.ok) throw new Error(`Failed to read HF file ${filePath} (${res.status})`);
            return await res.text();
        }

        // ==========================================
        // SCRIPT VALIDATION & EXTRACTION
        // ==========================================

        validateAndParsePineJS(code, filePath, repo) {
            if (!code || typeof code !== 'string') return null;
            try {
                // Safe factory execution to inspect PineJS metainfo & name
                const factory = new Function('PineJS', 'return (' + code + ');');
                const obj = factory({ Std: {} });
                if (!obj || !obj.name) return null;

                const name = obj.name;
                const hasBuy = /this\.strategy\.buy|strategy\.buy|action\s*:\s*['"]BUY['"]/i.test(code);
                const hasSell = /this\.strategy\.sell|strategy\.sell|action\s*:\s*['"]SELL['"]/i.test(code);
                const isStrategy = (hasBuy && hasSell) || name.toLowerCase().includes('strategy') || filePath.toLowerCase().includes('strategy');

                // Generate clean, deterministic, namespaced metainfo ID to avoid collision with local copies
                const cleanRepoSlug = (repo.repoId || `${repo.owner}_${repo.repo}`).replace(/[^a-zA-Z0-9]/g, '_');
                const cleanNameSlug = name.replace(/[^a-zA-Z0-9]/g, '_');
                const metainfoId = `${cleanNameSlug}_${repo.type}_${cleanRepoSlug}@tv-basicstudies-1`;

                return {
                    name,
                    metainfoId,
                    isStrategy,
                    description: (obj.metainfo && obj.metainfo.description) || name,
                    shortDescription: (obj.metainfo && obj.metainfo.shortDescription) || name,
                    code
                };
            } catch (e) {
                console.warn(`[ScriptRepoManager] File ${filePath} in ${repo.url} is not a valid PineJS script:`, e);
                return null;
            }
        }

        // ==========================================
        // SYNCHRONIZATION ENGINE
        // ==========================================

        async syncRepo(repo) {
            repo.syncStatus = 'syncing';
            repo.error = null;
            this._saveRepos();

            try {
                let latestCommitSha;
                if (repo.type === 'github') {
                    latestCommitSha = await this._fetchGitHubLatestCommit(repo);
                } else {
                    latestCommitSha = await this._fetchHFLatestCommit(repo);
                }

                // Check if commit SHA unchanged: use cached scripts, avoid redundant download!
                const hasExistingScripts = Object.values(this.remoteIndicators).some(s => s.repoId === repo.id);
                if (repo.lastCommitSha && repo.lastCommitSha === latestCommitSha && hasExistingScripts) {
                    repo.syncStatus = 'synced';
                    repo.lastSyncTime = Date.now();
                    this._saveRepos();
                    return { repoId: repo.id, updated: false, scriptCount: repo.scriptCount };
                }

                // Discover candidates in /, indicators/, strategy/, strategies/
                let matchingFiles = [];
                if (repo.type === 'github') {
                    matchingFiles = await this._fetchGitHubTree(repo, latestCommitSha);
                } else {
                    matchingFiles = await this._fetchHFTree(repo);
                }

                let newIndicatorsCount = 0;
                const updatedScriptKeys = [];

                for (const file of matchingFiles) {
                    try {
                        let content = '';
                        if (repo.type === 'github') {
                            content = await this._fetchGitHubFileContent(repo, file.path, latestCommitSha);
                        } else {
                            content = await this._fetchHFFileContent(repo, file.path);
                        }

                        const parsed = this.validateAndParsePineJS(content, file.path, repo);
                        if (parsed) {
                            const uniqueKey = `${repo.type}:${repo.repoId || repo.owner + '/' + repo.repo}:${file.path}`;
                            this.remoteIndicators[uniqueKey] = {
                                key: uniqueKey,
                                id: parsed.metainfoId,
                                name: parsed.name,
                                repoId: repo.id,
                                repoName: repo.repoId || `${repo.owner}/${repo.repo}`,
                                provider: repo.type,
                                path: file.path,
                                commitSha: latestCommitSha,
                                code: parsed.code,
                                isStrategy: parsed.isStrategy,
                                sourceType: repo.type,
                                lastUpdated: Date.now()
                            };
                            updatedScriptKeys.push(uniqueKey);
                            newIndicatorsCount++;
                        }
                    } catch (fileErr) {
                        console.warn(`[ScriptRepoManager] Failed to fetch file ${file.path}:`, fileErr);
                    }
                }

                // Prune any deleted remote scripts for this repo
                for (const k in this.remoteIndicators) {
                    if (this.remoteIndicators[k].repoId === repo.id && !updatedScriptKeys.includes(k)) {
                        delete this.remoteIndicators[k];
                    }
                }

                repo.lastCommitSha = latestCommitSha;
                repo.lastSyncTime = Date.now();
                repo.syncStatus = 'synced';
                repo.scriptCount = newIndicatorsCount;
                repo.error = null;

                this._saveRepos();
                this._saveRemoteIndicators();

                return { repoId: repo.id, updated: true, scriptCount: newIndicatorsCount };
            } catch (err) {
                console.error(`[ScriptRepoManager] Failed to sync repo ${repo.url}:`, err);
                repo.syncStatus = 'error';
                repo.error = err.message || 'Sync failed';
                this._saveRepos();
                // Fail-safe caching: existing scripts in tv_remote_indicators remain intact!
                return { repoId: repo.id, updated: false, error: err.message };
            }
        }

        async syncAll(force = false) {
            if (this.isSyncing) return;
            this.isSyncing = true;
            window.dispatchEvent(new CustomEvent('tv_sync_started'));

            const results = [];
            for (const repo of this.repos) {
                if (force) repo.lastCommitSha = null;
                const res = await this.syncRepo(repo);
                results.push(res);
            }

            this.isSyncing = false;
            window.dispatchEvent(new CustomEvent('tv_sync_completed', { detail: results }));

            // Check if any updated script is currently applied on chart -> trigger hot-swap
            this._checkAndHotSwapActiveChartStudies();
            return results;
        }

        _checkAndHotSwapActiveChartStudies() {
            if (!window.tvWidget) return;
            try {
                const chart = window.tvWidget.activeChart();
                if (!chart) return;
                const activeStudies = chart.getAllStudies() || [];
                if (activeStudies.length === 0) return;

                const remoteScripts = Object.values(this.remoteIndicators);
                activeStudies.forEach(study => {
                    // Check study's metaInfo id to ensure we do NOT hot-swap local clones!
                    let isLocalClone = false;
                    try {
                        const model = chart._chartWidget && chart._chartWidget.model() && chart._chartWidget.model().model();
                        const stModel = model && model.getStudyById && model.getStudyById(study.id);
                        if (stModel && typeof stModel.metaInfo === 'function') {
                            const mId = stModel.metaInfo().id || "";
                            if (mId.includes('_Local_')) {
                                isLocalClone = true;
                            }
                        }
                    } catch (_) {}
                    if (isLocalClone) return;

                    const sName = (study.name || '').toLowerCase();
                    const matchingRemote = remoteScripts.find(r => r.name.toLowerCase() === sName || r.id.toLowerCase() === sName);
                    if (matchingRemote && (Date.now() - matchingRemote.lastUpdated < 15000)) {
                        console.log(`[ScriptRepoManager] Hot-swapping active chart study '${study.name}' with newly synced version...`);
                        try {
                            chart.removeEntity(study.id);
                            setTimeout(() => {
                                chart.createStudy(matchingRemote.name, false, false);
                            }, 150);
                        } catch (e) {
                            console.warn("Hot-swap error:", e);
                        }
                    }
                });
            } catch (_) {}
        }

        // ==========================================
        // FORKING / WORKING COPY CREATION
        // ==========================================

        /**
         * Creates an independent local working copy of a remote script
         * allowing both the remote auto-updating version and local copy to coexist
         */
        forkRemoteScript(remoteKey, customName = null) {
            const remoteItem = this.remoteIndicators[remoteKey];
            if (!remoteItem) throw new Error("Remote script not found.");

            const displayName = customName || remoteItem.name;
            const uniqueLocalId = (window.generateUniqueStudyId)
                ? window.generateUniqueStudyId(displayName, remoteItem.id)
                : `${displayName.replace(/[^a-zA-Z0-9]/g, '_')}_Local_${Date.now()}@tv-basicstudies-1`;

            // Rewrite code metainfo id to guarantee separate identity in PineJS
            let code = remoteItem.code;
            if (window.injectStudyMetaId) {
                code = window.injectStudyMetaId(code, uniqueLocalId);
            } else if (/id\s*:\s*["'][^"']*@tv-basicstudies[^"']*["']/.test(code)) {
                code = code.replace(/id\s*:\s*["'][^"']*@tv-basicstudies[^"']*["']/, `id: "${uniqueLocalId}"`);
            } else {
                code = code.replace(/id:\s*["'][^"']+["']/, `id: "${uniqueLocalId}"`);
            }

            if (window.TVLocalStore) {
                window.TVLocalStore.saveIndicator(displayName, code);
            } else {
                let localStored = {};
                try {
                    localStored = JSON.parse(localStorage.getItem('tv_local_indicators') || '{}');
                } catch (_) {}
                localStored[displayName] = code;
                localStorage.setItem('tv_local_indicators', JSON.stringify(localStored));
            }

            return {
                name: displayName,
                id: uniqueLocalId,
                code
            };
        }

        /**
         * Returns an array of parsed PineJS indicator objects from remote sync
         * to be registered in window.getCustomIndicators
         */
        getRemotePineJSIndicators(PineJS) {
            const list = [];
            for (const key in this.remoteIndicators) {
                const item = this.remoteIndicators[key];
                try {
                    const factory = new Function('PineJS', 'return (' + item.code + ');');
                    const indicatorObj = factory(PineJS);
                    if (indicatorObj && indicatorObj.name) {
                        indicatorObj._sourceType = item.provider;
                        indicatorObj._repoName = item.repoName;
                        indicatorObj._isRemoteSynced = true;
                        indicatorObj._remoteKey = key;
                        indicatorObj.isStrategy = !!item.isStrategy;
                        indicatorObj._isStrat = !!item.isStrategy;
                        list.push(indicatorObj);
                    }
                } catch (e) {
                    console.error("[ScriptRepoManager] Failed to instantiate remote indicator:", item.name, e);
                }
            }
            return list;
        }
    }

    // Initialize singleton on window
    window.ScriptRepoManager = new ScriptRepoManager();

    // Auto-sync on DOM ready / startup in background without blocking chart initialization
    window.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (window.ScriptRepoManager.repos.length > 0) {
                console.log("[ScriptRepoManager] Performing background repository sync...");
                window.ScriptRepoManager.syncAll(false);
            }
        }, 1200);
    });

})(window);
