/**
 * ReDeploy CLI — Deploy Module
 * Handles project file collection, upload, and live log streaming.
 * 
 * @module redeploy/deploy
 * @private
 */

"use strict";

const fs = require("fs");
const path = require("path");
const config = require("./config");

const ALWAYS_IGNORE_DIRS = new Set([
    "node_modules", ".git", ".next", ".vercel", "__pycache__",
    ".DS_Store", ".cache", ".turbo", ".svelte-kit",
    ".nuxt", ".output", "coverage", ".nyc_output", ".redeploy",
]);
const ALWAYS_IGNORE_FILES = new Set([
    ".redeploy.json", ".env.local", ".env.production",
]);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file

// ── .gitignore parser ──────────────────────────────────

function parseGitignore(baseDir) {
    const gitignorePath = path.join(baseDir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) return [];

    const content = fs.readFileSync(gitignorePath, "utf8");
    return content
        .split("\n")
        .map(l => l.trim())
        .filter(l => l && !l.startsWith("#"));
}

function matchesGitignore(relPath, patterns) {
    const normalized = relPath.replace(/\\/g, "/");
    for (const pattern of patterns) {
        const clean = pattern.replace(/^\//, "").replace(/\/$/, "");

        // Exact match
        if (normalized === clean) return true;

        // Directory match (pattern ends with /)
        if (pattern.endsWith("/") && normalized.startsWith(clean + "/")) return true;
        if (pattern.endsWith("/") && normalized === clean) return true;

        // Basename match (no slash in pattern = match anywhere)
        if (!pattern.includes("/")) {
            const basename = path.basename(normalized);
            if (basename === clean) return true;
            // Glob: *.ext
            if (clean.startsWith("*.")) {
                const ext = clean.slice(1);
                if (basename.endsWith(ext)) return true;
            }
        }

        // Path prefix match
        if (normalized.startsWith(clean + "/")) return true;
    }
    return false;
}

// ── File collector ─────────────────────────────────────

function collectFiles(dir, baseDir, gitignorePatterns, files = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return files;
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

        if (entry.isDirectory()) {
            if (ALWAYS_IGNORE_DIRS.has(entry.name)) continue;
            if (entry.name.startsWith(".") && entry.name !== ".env") continue;
            if (matchesGitignore(relPath, gitignorePatterns)) continue;
            collectFiles(fullPath, baseDir, gitignorePatterns, files);
        } else {
            if (ALWAYS_IGNORE_FILES.has(entry.name)) continue;
            if (matchesGitignore(relPath, gitignorePatterns)) continue;

            try {
                const stat = fs.statSync(fullPath);
                if (stat.size > MAX_FILE_SIZE || stat.size === 0) continue;

                files.push({
                    file: relPath,
                    data: fs.readFileSync(fullPath).toString("base64"),
                    size: stat.size,
                });
            } catch {
                continue;
            }
        }
    }
    return files;
}

// ── Framework auto-detection ───────────────────────────

function detectFramework(cwd) {
    const pkgPath = path.join(cwd, "package.json");
    if (!fs.existsSync(pkgPath)) {
        if (fs.existsSync(path.join(cwd, "index.html"))) return "static";
        return "other";
    }

    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps["next"]) return "nextjs";
        if (deps["nuxt"] || deps["nuxt3"]) return "nuxt";
        if (deps["@sveltejs/kit"]) return "sveltekit";
        if (deps["svelte"]) return "svelte";
        if (deps["vue"]) return "vue";
        if (deps["react"]) return "react";
        if (deps["astro"]) return "astro";
        if (deps["vite"]) return "vite";
        return "node";
    } catch {
        return "other";
    }
}

// ── Deploy ─────────────────────────────────────────────

async function deploy(options = {}) {
    const chalk = (await import("chalk")).default;
    const ora = (await import("ora")).default;

    const token = config.getToken();
    if (!token) {
        console.log(chalk.red("\n  ✗ Not authenticated. Run: redeploy login\n"));
        process.exit(1);
    }

    const baseUrl = config.getBaseUrl();
    const cwd = process.cwd();
    const projectConfig = config.getProjectConfig(cwd);
    const projectName = options.name || projectConfig?.name || path.basename(cwd);
    const slug = options.slug || projectConfig?.slug || undefined;
    const framework = detectFramework(cwd);

    console.log();
    console.log(chalk.bold("  ReDeploy Deploy"));
    console.log(chalk.dim("  ─────────────────────────────"));
    console.log(chalk.dim(`  Project:    ${chalk.white(projectName)}`));
    console.log(chalk.dim(`  Framework:  ${chalk.white(framework)}`));
    console.log(chalk.dim(`  Dir:        ${cwd}`));
    console.log(chalk.dim(`  Server:     ${baseUrl}`));
    console.log();

    // Parse .gitignore
    const gitignorePatterns = parseGitignore(cwd);

    // Collect files
    const spinner = ora("Scanning files...").start();
    const files = collectFiles(cwd, cwd, gitignorePatterns);

    if (files.length === 0) {
        spinner.fail(chalk.red("No deployable files found"));
        process.exit(1);
    }

    const totalSize = files.reduce((s, f) => s + f.size, 0);
    spinner.succeed(chalk.green(
        `Found ${files.length} files (${(totalSize / 1024).toFixed(0)} KB)`
    ));

    if (gitignorePatterns.length > 0) {
        console.log(chalk.dim(`  .gitignore: ${gitignorePatterns.length} patterns applied`));
    }

    // Upload as JSON (no zip — instant)
    const uploadSpinner = ora("Uploading to ReDeploy...").start();

    try {
        const payload = {
            project_name: projectName,
            framework,
            files: files.map(f => ({ file: f.file, data: f.data })),
        };
        if (slug) payload.slug = slug;

        // Env vars from .redeploy.json
        if (projectConfig?.env && Object.keys(projectConfig.env).length > 0) {
            payload.env_vars = projectConfig.env;
        }

        const body = JSON.stringify(payload);
        uploadSpinner.text = `Uploading ${files.length} files (${(Buffer.byteLength(body) / 1024).toFixed(0)} KB)...`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout

        const res = await fetch(`${baseUrl}/api/deploy/cli`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body,
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
            let errMsg;
            try {
                const errData = await res.json();
                errMsg = errData.error || `HTTP ${res.status}`;
            } catch {
                errMsg = `HTTP ${res.status} ${res.statusText}`;
            }
            uploadSpinner.fail(chalk.red(`Deploy failed: ${errMsg}`));
            process.exit(1);
        }

        const data = await res.json();

        if (!data.success) {
            uploadSpinner.fail(chalk.red(`Deploy failed: ${data.error}`));
            process.exit(1);
        }

        uploadSpinner.succeed(chalk.green("Uploaded successfully"));

        if (data.framework) {
            console.log(chalk.dim(`  Framework: ${data.framework}`));
        }
        console.log(chalk.dim(`  Files:     ${data.files_count}`));
        if (data.url) {
            console.log(chalk.dim(`  URL:       ${chalk.cyan(data.url)}`));
        }
        console.log();

        // Stream build logs
        console.log(chalk.bold.cyan("  ▶ Build Output"));
        console.log(chalk.dim("  ─────────────────────────────"));

        await streamLogs(baseUrl, token, data.deployment_id, data.project_id, data.vercel_project_id, chalk);

    } catch (err) {
        if (err.name === "AbortError") {
            uploadSpinner.fail(chalk.red("Upload timed out (120s). Check your network connection."));
        } else {
            uploadSpinner.fail(chalk.red(`Upload failed: ${err.message}`));
        }
        process.exit(1);
    }
}

// ── Stream Logs ────────────────────────────────────────

async function streamLogs(baseUrl, token, deploymentId, projectId, vercelProjectId, chalk) {
    let lastLogCount = 0;
    let done = false;
    let retries = 0;
    const maxRetries = 90; // 90 * 2s = 3 minutes max

    while (!done && retries < maxRetries) {
        await new Promise((r) => setTimeout(r, 2000));
        retries++;

        // Check status
        try {
            const statusUrl = `${baseUrl}/api/deploy/status?deployment_id=${deploymentId}&project_id=${projectId}&vercel_project_id=${vercelProjectId}`;
            const statusRes = await fetch(statusUrl, {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(10000),
            });
            const status = await statusRes.json();

            if (status.done) {
                done = true;

                // Final log fetch
                try {
                    const logRes = await fetch(`${baseUrl}/api/deploy/logs?deployment_id=${deploymentId}`, {
                        headers: { Authorization: `Bearer ${token}` },
                        signal: AbortSignal.timeout(10000),
                    });
                    const logData = await logRes.json();
                    if (logData.logs?.length > lastLogCount) {
                        for (let i = lastLogCount; i < logData.logs.length; i++) {
                            printLog(logData.logs[i], chalk);
                        }
                    }
                } catch { /* */ }

                console.log();
                if (status.status === "ready") {
                    console.log(chalk.bold.green("  ✓ Deployment ready!"));
                    if (status.url) {
                        console.log(chalk.dim(`  URL: ${chalk.cyan(status.url)}`));
                    }
                } else {
                    console.log(chalk.bold.red(`  ✗ Build failed: ${status.error_message || "Unknown error"}`));
                    process.exit(1);
                }
                console.log();
                return;
            }
        } catch { /* continue polling */ }

        // Fetch logs
        try {
            const logRes = await fetch(`${baseUrl}/api/deploy/logs?deployment_id=${deploymentId}`, {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(10000),
            });
            const logData = await logRes.json();
            if (logData.logs?.length > lastLogCount) {
                for (let i = lastLogCount; i < logData.logs.length; i++) {
                    printLog(logData.logs[i], chalk);
                }
                lastLogCount = logData.logs.length;
            }
        } catch { /* */ }
    }

    if (!done) {
        console.log();
        console.log(chalk.yellow("  ⚠ Timed out waiting for build. Check the dashboard for status."));
        console.log();
    }
}

function printLog(log, chalk) {
    const msg = log.message || "";
    if (!msg) return;
    const prefix = "  ";
    switch (log.level) {
        case "error":
            console.log(prefix + chalk.red(msg));
            break;
        case "warn":
            console.log(prefix + chalk.yellow(msg));
            break;
        case "success":
            console.log(prefix + chalk.green(msg));
            break;
        default:
            console.log(prefix + chalk.dim(msg));
    }
}

// ── Init ───────────────────────────────────────────────

async function init(options = {}) {
    const chalk = (await import("chalk")).default;

    const cwd = process.cwd();
    const pkgPath = path.join(cwd, "package.json");

    // ── Detect package manager ─────────────────────────
    function detectPM() {
        const checks = [
            { file: "bun.lockb", name: "bun", run: "bun run", exec: "bunx" },
            { file: "bun.lock", name: "bun", run: "bun run", exec: "bunx" },
            { file: "pnpm-lock.yaml", name: "pnpm", run: "pnpm run", exec: "pnpm exec" },
            { file: "yarn.lock", name: "yarn", run: "yarn", exec: "yarn" },
            { file: "package-lock.json", name: "npm", run: "npm run", exec: "npx" },
        ];
        for (const c of checks) {
            if (fs.existsSync(path.join(cwd, c.file))) return c;
        }
        return { name: "npm", run: "npm run", exec: "npx" };
    }

    const pm = detectPM();
    const framework = detectFramework(cwd);

    // ── Create .redeploy.json ──────────────────────────
    const existing = config.getProjectConfig(cwd);
    let configCreated = false;

    if (existing && !options.force) {
        // Config exists, don't overwrite
    } else {
        const projectName = options.name || (fs.existsSync(pkgPath)
            ? JSON.parse(fs.readFileSync(pkgPath, "utf8")).name || path.basename(cwd)
            : path.basename(cwd));

        const cfg = {
            "$schema": "https://deploy.revy.my.id/schema/redeploy.json",
            name: projectName,
            slug: projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
            framework: framework,
            packageManager: pm.name,
            env: {},
        };

        config.writeProjectConfig(cwd, cfg);
        configCreated = true;
    }

    // ── Inject scripts into package.json ───────────────
    const SCRIPTS = {
        "deploy": "redeploy deploy",
        "redeploy": "redeploy",
        "redeploy:login": "redeploy login",
        "redeploy:init": "redeploy init",
        "redeploy:whoami": "redeploy whoami",
        "redeploy:logout": "redeploy logout",
    };

    let scriptsAdded = 0;
    const skippedScripts = [];

    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
            if (!pkg.scripts) pkg.scripts = {};

            for (const [key, value] of Object.entries(SCRIPTS)) {
                if (pkg.scripts[key] && pkg.scripts[key] !== value) {
                    skippedScripts.push(key);
                    continue;
                }
                if (pkg.scripts[key] === value) continue;
                pkg.scripts[key] = value;
                scriptsAdded++;
            }

            if (scriptsAdded > 0) {
                fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
            }
        } catch { /* skip */ }
    }

    // ── Add .redeploy.json to .gitignore ──────────────
    let gitignoreUpdated = false;
    const gitignorePath = path.join(cwd, ".gitignore");

    try {
        let content = "";
        if (fs.existsSync(gitignorePath)) {
            content = fs.readFileSync(gitignorePath, "utf8");
        }

        const entries = [".redeploy.json"];
        const toAdd = entries.filter(e => !content.split("\n").some(line => line.trim() === e));

        if (toAdd.length > 0) {
            const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
            const header = content.length === 0 ? "" : separator;
            const block = `${header}\n# ReDeploy\n${toAdd.join("\n")}\n`;
            fs.appendFileSync(gitignorePath, block);
            gitignoreUpdated = true;
        }
    } catch { /* skip */ }

    // ── Print summary ──────────────────────────────────
    console.log();
    console.log(chalk.bold("  ReDeploy Init"));
    console.log(chalk.dim("  ─────────────────────────────"));
    console.log(chalk.dim(`  Package manager: ${chalk.white(pm.name)}`));
    console.log(chalk.dim(`  Framework:       ${chalk.white(framework)}`));
    console.log();

    if (configCreated) {
        console.log(chalk.green("  ✓ Created .redeploy.json"));
    } else if (existing) {
        console.log(chalk.dim("  ⊘ .redeploy.json already exists (use --force to overwrite)"));
    }

    if (gitignoreUpdated) {
        console.log(chalk.green("  ✓ Added .redeploy.json to .gitignore"));
    }

    if (scriptsAdded > 0) {
        console.log(chalk.green(`  ✓ Added ${scriptsAdded} script(s) to package.json:`));
        for (const [key, value] of Object.entries(SCRIPTS)) {
            if (!skippedScripts.includes(key)) {
                console.log(chalk.dim(`    ${key}`) + " → " + chalk.cyan(value));
            }
        }
    }

    if (skippedScripts.length > 0) {
        console.log(chalk.yellow(`  ⚠ Skipped (already defined): ${skippedScripts.join(", ")}`));
    }

    console.log();
    console.log(chalk.dim("  Quick start:"));
    console.log(chalk.cyan(`    ${pm.run} redeploy:login`) + chalk.dim("   — Authenticate via browser"));
    console.log(chalk.cyan(`    ${pm.run} deploy`) + chalk.dim("           — Deploy your project"));
    console.log();
}

module.exports = { deploy, init };
