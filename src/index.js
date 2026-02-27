/**
 * ReDeploy CLI
 * Command-line interface for deploying to ReDeploy.
 * 
 * @module redeploy
 * @version 1.0.0
 */

"use strict";

const { Command } = require("commander");
const { login, logout, whoami } = require("./auth");
const { deploy, init } = require("./deploy");
const config = require("./config");

const VERSION = process.env.REDEPLOY_CLI_VERSION || "1.0.0";

const program = new Command();

program
    .name("redeploy")
    .description("ReDeploy CLI — Deploy to the edge from your terminal")
    .version(VERSION, "-v, --version");

// ── login ──────────────────────────────────────────────
program
    .command("login")
    .description("Authenticate with ReDeploy via browser")
    .option("--force", "Force re-authentication")
    .option("--url <url>", "Custom server URL")
    .action(async (opts) => {
        try {
            const token = await login({ force: opts.force, url: opts.url });
            if (token) {
                const chalk = (await import("chalk")).default;
                console.log(chalk.green("\n  ✓ Authentication successful!\n"));
            }
        } catch (err) {
            const chalk = (await import("chalk")).default;
            console.error(chalk.red(`\n  ✗ Login failed: ${err.message}\n`));
            process.exit(1);
        }
    });

// ── logout ─────────────────────────────────────────────
program
    .command("logout")
    .description("Remove stored authentication")
    .action(async () => {
        await logout();
    });

// ── whoami ─────────────────────────────────────────────
program
    .command("whoami")
    .description("Check authentication status")
    .action(async () => {
        await whoami();
    });

// ── deploy ─────────────────────────────────────────────
program
    .command("deploy")
    .description("Deploy current directory to ReDeploy")
    .option("-n, --name <name>", "Project name")
    .option("-s, --slug <slug>", "Vercel subdomain slug")
    .action(async (opts) => {
        try {
            await deploy({ name: opts.name, slug: opts.slug });
        } catch (err) {
            const chalk = (await import("chalk")).default;
            console.error(chalk.red(`\n  ✗ Deploy failed: ${err.message}\n`));
            process.exit(1);
        }
    });

// ── init ───────────────────────────────────────────────
program
    .command("init")
    .description("Initialize .redeploy.json in current directory")
    .option("-n, --name <name>", "Project name")
    .option("--force", "Overwrite existing config")
    .action(async (opts) => {
        await init({ name: opts.name, force: opts.force });
    });

// ── config ─────────────────────────────────────────────
program
    .command("config")
    .description("Manage CLI configuration")
    .option("--set-url <url>", "Set custom server URL")
    .option("--get-url", "Show current server URL")
    .option("--reset", "Reset all configuration")
    .action(async (opts) => {
        const chalk = (await import("chalk")).default;

        if (opts.setUrl) {
            config.setBaseUrl(opts.setUrl);
            console.log(chalk.green(`\n  ✓ Server URL set to: ${opts.setUrl}\n`));
        } else if (opts.getUrl) {
            console.log(chalk.dim(`\n  Server: ${config.getBaseUrl()}\n`));
        } else if (opts.reset) {
            config.clearAuth();
            console.log(chalk.green("\n  ✓ Configuration reset.\n"));
        } else {
            console.log(chalk.dim(`\n  Server:  ${config.getBaseUrl()}`));
            console.log(chalk.dim(`  Config:  ${config.CONFIG_DIR}\n`));
        }
    });

program.parse(process.argv);

// Show help if no command
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
