/**
 * DevScale CLI — Configuration Manager
 * Handles persistent CLI configuration storage.
 * 
 * @module redeploy/config
 * @private
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const CONFIG_DIR = path.join(os.homedir(), ".redeploy");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const SESSION_FILE = path.join(CONFIG_DIR, ".session");

// Simple obfuscation for stored tokens (not security, just discouragement)
const _k = () => crypto.createHash("md5").update(os.hostname() + os.userInfo().username).digest("hex");

function _enc(val) {
    const key = _k();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", crypto.createHash("sha256").update(key).digest(), iv);
    let encrypted = cipher.update(val, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
}

function _dec(val) {
    try {
        const key = _k();
        const [ivHex, enc] = val.split(":");
        const iv = Buffer.from(ivHex, "hex");
        const decipher = crypto.createDecipheriv("aes-256-cbc", crypto.createHash("sha256").update(key).digest(), iv);
        let decrypted = decipher.update(enc, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    } catch {
        return null;
    }
}

function ensureDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
}

function readConfig() {
    ensureDir();
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    } catch {
        return {};
    }
}

function writeConfig(data) {
    ensureDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function getToken() {
    const cfg = readConfig();
    if (!cfg._t) return null;
    return _dec(cfg._t);
}

function setToken(token) {
    const cfg = readConfig();
    cfg._t = _enc(token);
    cfg._ts = Date.now();
    writeConfig(cfg);
}

function getBaseUrl() {
    const cfg = readConfig();
    return cfg.baseUrl || "https://deploy.revy.my.id";
}

function setBaseUrl(url) {
    const cfg = readConfig();
    cfg.baseUrl = url;
    writeConfig(cfg);
}

function getProjectConfig(dir) {
    const p = path.join(dir || process.cwd(), ".redeploy.json");
    try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
        return null;
    }
}

function writeProjectConfig(dir, config) {
    const p = path.join(dir || process.cwd(), ".redeploy.json");
    fs.writeFileSync(p, JSON.stringify(config, null, 2));
}

function clearAuth() {
    const cfg = readConfig();
    delete cfg._t;
    delete cfg._ts;
    delete cfg._u;
    writeConfig(cfg);
    try { fs.unlinkSync(SESSION_FILE); } catch { /* */ }
}

function setUserInfo(info) {
    const cfg = readConfig();
    cfg._u = info;
    writeConfig(cfg);
}

function getUserInfo() {
    const cfg = readConfig();
    return cfg._u || null;
}

module.exports = {
    getToken,
    setToken,
    getBaseUrl,
    setBaseUrl,
    getProjectConfig,
    writeProjectConfig,
    clearAuth,
    setUserInfo,
    getUserInfo,
    CONFIG_DIR,
};
