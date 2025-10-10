# Project Overview

## Purpose
This is a **reverse-proxy** project built for Cloudflare Workers. It's a TypeScript-based web server application using the Hono framework.

## Tech Stack
- **Runtime**: Bun (preferred over Node.js)
- **Web Framework**: Hono 4.9.10
- **Language**: TypeScript 5+
- **Testing**: Vitest 3.2.4 with @vitest/coverage-v8
- **Linter/Formatter**: Biome 2.2.5
- **Deployment Platform**: Cloudflare Workers (via Wrangler 4.42.1)

## Project Structure
```
reverse-proxy/
├── index.ts              # Main application entry point (Hono app)
├── tests/
│   └── app.test.ts      # Test files
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── biome.json           # Biome linter/formatter config
├── vitest.config.ts     # Vitest test configuration
├── wrangler.toml        # Cloudflare Workers configuration
├── CLAUDE.md            # Development guidelines for Bun usage
└── README.md            # Project readme (minimal)
```

## Key Characteristics
- Uses Bun as the primary runtime and package manager
- Cloudflare Workers compatible (wrangler.toml configured)
- Strict TypeScript settings enabled
- Very strict Biome linting rules enforced
- Vitest for testing with coverage support
