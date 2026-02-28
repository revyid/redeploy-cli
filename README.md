# ReDeploy CLI

Deploy to the edge from your terminal.

## Installation

```bash
# Global (recommended)
npm install -g redeploy-cli

# Or as a dev dependency
npm install redeploy-cli --save-dev
# pnpm add redeploy-cli -D
# yarn add redeploy-cli --dev
# bun add redeploy-cli --dev
```

On install, the CLI **auto-detects your package manager** and:

1. Adds scripts to your `package.json`:
```json
{
  "scripts": {
    "deploy": "redeploy deploy",
    "redeploy": "redeploy",
    "redeploy:login": "redeploy login",
    "redeploy:init": "redeploy init",
    "redeploy:whoami": "redeploy whoami",
    "redeploy:logout": "redeploy logout"
  }
}
```

2. Generates `.redeploy.json` config:
```json
{
  "name": "my-project",
  "slug": "my-project",
  "framework": "auto",
  "packageManager": "pnpm",
  "buildCommand": null,
  "env": {}
}
```

## Quick Start

```bash
# Authenticate
redeploy login

# Deploy your project
redeploy deploy

# Or via package scripts
npm run deploy
```

## Commands

| Command | Description |
|---------|-------------|
| `redeploy login` | Authenticate via browser |
| `redeploy deploy` | Deploy current directory |
| `redeploy init` | Create `.redeploy.json` config |
| `redeploy whoami` | Check auth status |
| `redeploy logout` | Remove stored credentials |
| `redeploy config` | Manage CLI configuration |

## License

MIT
