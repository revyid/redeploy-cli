# ReDeploy CLI

Deploy to the edge from your terminal.

## Installation

```bash
# npm
npm install github:revyid/redeploy --save-dev

# pnpm
pnpm add github:revyid/redeploy -D

# yarn
yarn add github:revyid/redeploy --dev

# bun
bun add github:revyid/redeploy --dev
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
# npm                          # pnpm                      # yarn / bun
npm run redeploy:login          pnpm run redeploy:login      yarn redeploy:login
npm run deploy                  pnpm run deploy              yarn deploy

# Or use directly
npx redeploy deploy             pnpm exec redeploy deploy    bunx redeploy deploy
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
