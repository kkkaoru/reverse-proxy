# Bun Usage Guidelines

This project uses **Bun** as the primary runtime and package manager (not Node.js, npm, or yarn).

## Key Bun Commands

### Running Code
- Run TypeScript files directly: `bun <file.ts>`
- Run with hot reload: `bun --hot <file.ts>`
- Execute package scripts: `bun run <script-name>`

### Package Management
- Install dependencies: `bun install`
- Add a package: `bun add <package-name>`
- Add dev dependency: `bun add -d <package-name>`
- Remove a package: `bun remove <package-name>`

### Testing
- The project uses Vitest, run via: `bun test` or `bunx vitest run`
- Note: CLAUDE.md suggests `bun test` for native Bun testing, but this project uses Vitest

## Bun-Specific Features Used

### Environment Variables
- Bun automatically loads `.env` files
- No need for `dotenv` package

### Native APIs to Prefer
- `Bun.serve()` for HTTP servers (though this project uses Hono)
- `bun:sqlite` for SQLite
- `Bun.redis` for Redis
- `Bun.sql` for Postgres
- `Bun.file` instead of `node:fs` readFile/writeFile
- `Bun.$` for shell commands (instead of `execa`)

## Project-Specific Considerations

### Current Setup
- **Web Framework**: Hono (not Bun.serve directly)
- **Testing**: Vitest (not bun:test)
- **Deployment**: Cloudflare Workers (via Wrangler)

### Why Hono + Vitest?
- Hono provides Cloudflare Workers compatibility
- Vitest is used for testing instead of Bun's native test runner
- This allows the code to run on both Bun locally and Cloudflare Workers in production

## Running the Application

### Local Development
```bash
bun --hot index.ts
```

### Cloudflare Workers Preview
```bash
bunx wrangler dev
```

## Bundle/Build
- For Cloudflare Workers, Wrangler handles bundling
- Bun can also bundle: `bun build <file.ts>` (not currently used in this project)

## Important Notes
- Always use `bun` or `bunx` commands, not `npm`, `npx`, `node`, or `yarn`
- Bun is significantly faster than Node.js for most operations
- Bun has native TypeScript support (no need for ts-node)
