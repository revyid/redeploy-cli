/**
 * ReDeploy CLI — Browser-based Authentication
 * Opens browser for OAuth, captures token via local HTTP server.
 * 
 * @module redeploy/auth
 * @private
 */

"use strict";

const http = require("http");
const crypto = require("crypto");
const config = require("./config");

async function login(options = {}) {
    const chalk = (await import("chalk")).default;
    const ora = (await import("ora")).default;
    const open = (await import("open")).default;

    const existing = config.getToken();
    if (existing && !options.force) {
        const user = config.getUserInfo();
        console.log(chalk.yellow("⚠ Already logged in" + (user ? ` as ${user.email}` : "")));
        console.log(chalk.dim("  Use --force to re-authenticate"));
        return;
    }

    const baseUrl = options.url || config.getBaseUrl();
    const state = crypto.randomBytes(24).toString("hex");

    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost`);

            if (url.pathname === "/callback") {
                const token = url.searchParams.get("token");
                const returnedState = url.searchParams.get("state");
                const userId = url.searchParams.get("user_id");
                const email = url.searchParams.get("email");

                // CSRF check
                if (returnedState !== state) {
                    res.writeHead(400, { "Content-Type": "text/html" });
                    res.end("<html><body style='background:#0a0f15;color:#ff4444;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div><h2>⚠ Security Error</h2><p>State mismatch — please try again.</p></div></body></html>");
                    server.close();
                    reject(new Error("State mismatch"));
                    return;
                }

                if (token) {
                    config.setToken(token);
                    if (userId || email) {
                        config.setUserInfo({ userId, email });
                    }

                    res.writeHead(200, { "Content-Type": "text/html" });
                    res.end(`<html><body style='background:#0a0f15;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>
                        <div style='text-align:center'>
                            <div style='width:60px;height:60px;border-radius:50%;background:rgba(19,127,236,0.1);display:flex;align-items:center;justify-content:center;margin:0 auto 16px'>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#137fec" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            </div>
                            <h2 style='margin:0 0 8px;color:#137fec'>Authenticated!</h2>
                            <p style='color:#8b9ab5;margin:0'>You can close this tab and return to your terminal.</p>
                        </div>
                    </body></html>`);

                    server.close();
                    resolve(token);
                } else {
                    res.writeHead(400, { "Content-Type": "text/html" });
                    res.end("<html><body style='background:#0a0f15;color:#ff4444;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div><h2>⚠ Authentication Failed</h2><p>No token received.</p></div></body></html>");
                    server.close();
                    reject(new Error("No token received"));
                }
                return;
            }

            res.writeHead(404);
            res.end();
        });

        server.listen(0, "127.0.0.1", async () => {
            const port = server.address().port;
            const authUrl = `${baseUrl}/auth/cli?port=${port}&state=${state}`;

            console.log();
            console.log(chalk.bold("  ReDeploy CLI Authentication"));
            console.log(chalk.dim("  ─────────────────────────────"));
            console.log();

            const spinner = ora({
                text: "Opening browser for authentication...",
                color: "cyan",
            }).start();

            try {
                await open(authUrl);
                spinner.text = "Waiting for browser authentication...";
                spinner.color = "yellow";
            } catch {
                spinner.stop();
                console.log(chalk.yellow("  Could not open browser automatically."));
                console.log(chalk.dim("  Open this URL manually:"));
                console.log();
                console.log(chalk.cyan(`  ${authUrl}`));
                console.log();
            }

            // Timeout after 5 minutes
            const timeout = setTimeout(() => {
                server.close();
                spinner?.stop();
                reject(new Error("Authentication timed out (5 minutes)"));
            }, 5 * 60 * 1000);

            server.on("close", () => {
                clearTimeout(timeout);
                spinner?.stop();
            });
        });

        server.on("error", (err) => {
            reject(new Error(`Could not start auth server: ${err.message}`));
        });
    });
}

async function logout() {
    const chalk = (await import("chalk")).default;
    config.clearAuth();
    console.log(chalk.green("✓ Logged out successfully."));
    console.log(chalk.dim(`  Config cleared: ${config.CONFIG_DIR}`));
}

async function whoami() {
    const chalk = (await import("chalk")).default;
    const ora = (await import("ora")).default;

    const token = config.getToken();
    if (!token) {
        console.log(chalk.red("✗ Not logged in."));
        console.log(chalk.dim("  Run: redeploy login"));
        return;
    }

    const spinner = ora("Verifying session...").start();
    const baseUrl = config.getBaseUrl();

    try {
        const res = await fetch(`${baseUrl}/api/auth/cli/verify`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (data.valid) {
            spinner.succeed(chalk.green("Authenticated"));
            console.log(chalk.dim(`  User ID:  ${data.user_id}`));
            if (data.email) console.log(chalk.dim(`  Email:    ${data.email}`));
            console.log(chalk.dim(`  Server:   ${baseUrl}`));
        } else {
            spinner.fail(chalk.red("Token expired or invalid"));
            console.log(chalk.dim("  Run: redeploy login"));
        }
    } catch (err) {
        spinner.fail(chalk.red("Could not verify: " + err.message));
    }
}

module.exports = { login, logout, whoami };
