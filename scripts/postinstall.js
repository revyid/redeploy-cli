#!/usr/bin/env node

/**
 * ReDeploy CLI — Postinstall Script
 * Auto-generates package.json scripts AND .redeploy.json config.
 * Detects package manager (npm, pnpm, yarn, bun) automatically.
 *
 * Install via: npm install redeploy-cli --save-dev
 */

"use strict";

const fs = require("fs");
const path = require("path");

const SCRIPTS_TO_ADD = {
    "deploy": "redeploy deploy",
    "redeploy": "redeploy",
    "redeploy:login": "redeploy login",
    "redeploy:init": "redeploy init",
    "redeploy:whoami": "redeploy whoami",
    "redeploy:logout": "redeploy logout",
};

// ── Package Manager Detection ──────────────────────────

function detectPackageManager(projectDir) {
    const checks = [
        { file: "bun.lockb", name: "bun", run: "bun run", exec: "bunx" },
        { file: "bun.lock", name: "bun", run: "bun run", exec: "bunx" },
        { file: "pnpm-lock.yaml", name: "pnpm", run: "pnpm run", exec: "pnpm exec" },
        { file: "yarn.lock", name: "yarn", run: "yarn", exec: "yarn" },
        { file: "package-lock.json", name: "npm", run: "npm run", exec: "npx" },
    ];

    for (const c of checks) {
        if (fs.existsSync(path.join(projectDir, c.file))) {
            return { name: c.name, run: c.run, exec: c.exec };
        }
    }

    // Fallback: check npm_config_user_agent env
    const agent = process.env.npm_config_user_agent || "";
    if (agent.includes("pnpm")) return { name: "pnpm", run: "pnpm run", exec: "pnpm exec" };
    if (agent.includes("yarn")) return { name: "yarn", run: "yarn", exec: "yarn" };
    if (agent.includes("bun")) return { name: "bun", run: "bun run", exec: "bunx" };

    return { name: "npm", run: "npm run", exec: "npx" };
}

// ── Project Root Finder ────────────────────────────────

function findProjectRoot() {
    let dir = __dirname;
    for (let i = 0; i < 10; i++) {
        dir = path.dirname(dir);
        const pkgPath = path.join(dir, "package.json");
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
                if (pkg.name === "redeploy-cli") continue;
                return { dir, pkgPath, pkg };
            } catch {
                continue;
            }
        }
    }
    return null;
}

// ── Script Injection ───────────────────────────────────

function injectScripts(project) {
    const { pkgPath, pkg } = project;

    if (!pkg.scripts) pkg.scripts = {};

    let added = 0;
    const skipped = [];

    for (const [key, value] of Object.entries(SCRIPTS_TO_ADD)) {
        if (pkg.scripts[key] && pkg.scripts[key] !== value) {
            skipped.push(key);
            continue;
        }
        if (pkg.scripts[key] === value) continue;
        pkg.scripts[key] = value;
        added++;
    }

    if (added > 0) {
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    }

    return { added, skipped };
}

// ── Config Generation ──────────────────────────────────

function generateConfig(project, pm) {
    const configPath = path.join(project.dir, ".redeploy.json");

    if (fs.existsSync(configPath)) {
        return { created: false, existed: true };
    }

    const projectName = project.pkg.name || path.basename(project.dir);
    const config = {
        "$schema": "https://deploy.revy.my.id/schema/redeploy.json",
        "name": projectName,
        "slug": projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        "framework": "auto",
        "packageManager": pm.name,
        "buildCommand": project.pkg.scripts?.build || null,
        "outputDirectory": null,
        "env": {}
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    return { created: true, existed: false };
}

// ── Main ───────────────────────────────────────────────

function main() {
    const project = findProjectRoot();
    if (!project) return;

    const pm = detectPackageManager(project.dir);
    const scripts = injectScripts(project);
    const config = generateConfig(project, pm);

    console.log();
    console.log("  \x1b[36m◆\x1b[0m \x1b[1mReDeploy CLI\x1b[0m installed successfully!");
    console.log("  \x1b[2mDetected package manager: \x1b[0m\x1b[1m" + pm.name + "\x1b[0m");
    console.log();

    if (scripts.added > 0) {
        console.log("  \x1b[32m✓\x1b[0m Added \x1b[1m" + scripts.added + "\x1b[0m script(s) to package.json:");
        for (const [key, value] of Object.entries(SCRIPTS_TO_ADD)) {
            if (!scripts.skipped.includes(key)) {
                console.log("    \x1b[2m" + key + "\x1b[0m → \x1b[36m" + value + "\x1b[0m");
            }
        }
        console.log();
    }

    if (config.created) {
        console.log("  \x1b[32m✓\x1b[0m Generated \x1b[1m.redeploy.json\x1b[0m config");
        console.log();
    } else if (config.existed) {
        console.log("  \x1b[2m⊘ .redeploy.json already exists — skipped\x1b[0m");
        console.log();
    }

    console.log("  \x1b[2mQuick start:\x1b[0m");
    console.log("    \x1b[36m" + pm.run + " redeploy:login\x1b[0m   — Authenticate via browser");
    console.log("    \x1b[36m" + pm.run + " deploy\x1b[0m           — Deploy your project");
    console.log("    \x1b[36m" + pm.exec + " redeploy deploy\x1b[0m  — Or use directly");
    console.log();

    if (scripts.skipped.length > 0) {
        console.log("  \x1b[33m⚠\x1b[0m Skipped scripts (already defined): " + scripts.skipped.join(", "));
        console.log();
    }
}

try {
    main();
} catch {
    // Fail silently — postinstall should never break install
}
