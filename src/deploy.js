/**
 * ReDeploy CLI — Deploy Module
 * Handles project zipping, upload, and live log streaming.
 * 
 * @module redeploy/deploy
 * @private
 */

"use strict";

const fs = require("fs");
const path = require("path");
const config = require("./config");

const IGNORE_DIRS = new Set([
    "node_modules", ".git", ".next", ".vercel", "__pycache__",
    ".DS_Store", "dist", ".cache", ".turbo", ".svelte-kit",
    ".nuxt", ".output", "build", "coverage", ".nyc_output",
]);
const IGNORE_EXTS = new Set([".lock", ".log", ".map"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function collectFiles(dir, baseDir, files = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(baseDir, fullPath);

        if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name)) continue;
            if (entry.name.startsWith(".") && entry.name !== ".env") continue;
            collectFiles(fullPath, baseDir, files);
        } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (IGNORE_EXTS.has(ext)) continue;

            const stat = fs.statSync(fullPath);
            if (stat.size > MAX_FILE_SIZE) continue;
            if (stat.size === 0) continue;

            files.push({
                path: relPath.replace(/\\/g, "/"),
                content: fs.readFileSync(fullPath),
                size: stat.size,
            });
        }
    }
    return files;
}

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

    console.log();
    console.log(chalk.bold("  ReDeploy Deploy"));
    console.log(chalk.dim("  ─────────────────────────────"));
    console.log(chalk.dim(`  Project:  ${chalk.white(projectName)}`));
    console.log(chalk.dim(`  Dir:      ${cwd}`));
    console.log(chalk.dim(`  Server:   ${baseUrl}`));
    console.log();

    // Collect files
    const spinner = ora("Scanning files...").start();
    const files = collectFiles(cwd, cwd);

    if (files.length === 0) {
        spinner.fail(chalk.red("No deployable files found"));
        process.exit(1);
    }

    spinner.text = `Packaging ${files.length} files...`;

    // Create zip in memory
    const archiver = (await import("archiver")).default;
    const { Writable } = require("stream");

    const chunks = [];
    const bufferStream = new Writable({
        write(chunk, encoding, callback) {
            chunks.push(chunk);
            callback();
        },
    });

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(bufferStream);

    for (const file of files) {
        archive.append(file.content, { name: file.path });
    }

    await archive.finalize();
    await new Promise((resolve) => bufferStream.on("finish", resolve));

    const zipBuffer = Buffer.concat(chunks);
    const totalSize = files.reduce((s, f) => s + f.size, 0);

    spinner.succeed(chalk.green(
        `Packaged ${files.length} files (${(totalSize / 1024).toFixed(0)} KB → ${(zipBuffer.length / 1024).toFixed(0)} KB zipped)`
    ));

    // Upload
    const uploadSpinner = ora("Uploading to ReDeploy...").start();

    try {
        const form = new FormData();
        form.set("project_name", projectName);
        form.set("file", new Blob([zipBuffer], { type: "application/zip" }), `${projectName}.zip`);
        if (slug) form.set("vercel_slug", slug);

        // Env vars from .redeploy.json
        if (projectConfig?.env) {
            form.set("env_vars", JSON.stringify(projectConfig.env));
        }

        const res = await fetch(`${baseUrl}/api/deploy/cli`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
        });

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
        console.log();

        // Stream build logs
        console.log(chalk.bold.cyan("  ▶ Build Output"));
        console.log(chalk.dim("  ─────────────────────────────"));

        await streamLogs(baseUrl, token, data.deployment_id, data.project_id, data.vercel_project_id, chalk);

    } catch (err) {
        uploadSpinner.fail(chalk.red(`Upload failed: ${err.message}`));
        process.exit(1);
    }
}

async function streamLogs(baseUrl, token, deploymentId, projectId, vercelProjectId, chalk) {
    let lastLogCount = 0;
    let done = false;

    while (!done) {
        await new Promise((r) => setTimeout(r, 2000));

        // Check status
        try {
            const statusUrl = `${baseUrl}/api/deploy/status?deployment_id=${deploymentId}&project_id=${projectId}&vercel_project_id=${vercelProjectId}`;
            const statusRes = await fetch(statusUrl, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const status = await statusRes.json();

            if (status.done) {
                done = true;

                // Final log fetch
                try {
                    const logRes = await fetch(`${baseUrl}/api/deploy/logs?deployment_id=${deploymentId}`, {
                        headers: { Authorization: `Bearer ${token}` },
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

async function init(options = {}) {
    const chalk = (await import("chalk")).default;

    const cwd = process.cwd();
    const existing = config.getProjectConfig(cwd);

    if (existing && !options.force) {
        console.log(chalk.yellow("\n  ⚠ .redeploy.json already exists"));
        console.log(chalk.dim("  Use --force to overwrite\n"));
        return;
    }

    const projectName = options.name || path.basename(cwd);
    const cfg = {
        name: projectName,
        slug: projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        env: {},
    };

    config.writeProjectConfig(cwd, cfg);

    console.log();
    console.log(chalk.green("  ✓ Created .redeploy.json"));
    console.log(chalk.dim(`  Project: ${cfg.name}`));
    console.log(chalk.dim(`  Slug:    ${cfg.slug}.vercel.app`));
    console.log();
    console.log(chalk.dim("  Add environment variables to the 'env' field."));
    console.log(chalk.dim("  Then run: redeploy deploy"));
    console.log();
}

module.exports = { deploy, init };
