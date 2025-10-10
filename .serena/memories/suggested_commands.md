# Suggested Commands

## Package Management
- **Install dependencies**: `bun install`
- **Run scripts**: `bun run <script-name>`

## Testing
- **Run tests**: `bun test` or `bunx vitest run`
- **Run tests with coverage**: `bun run test:coverage` or `bunx vitest run --coverage`

## Linting & Formatting
- **Lint code**: `bun run lint` or `bunx biome check .`
- **Lint and auto-fix**: `bun run lint:fix` or `bunx biome check --write .`

## Development
- **Run the app locally**: `bun --hot index.ts` (with hot reload)
- **Run without hot reload**: `bun index.ts`

## Deployment (Cloudflare Workers)
- **Deploy to Cloudflare**: `bunx wrangler deploy`
- **Preview deployment**: `bunx wrangler dev`

## System Utilities (macOS/Darwin)
- **List files**: `ls` or `ls -la`
- **Change directory**: `cd <path>`
- **Find files**: `find . -name "<pattern>"`
- **Search in files**: `grep -r "<pattern>" .`
- **Git operations**: `git status`, `git add .`, `git commit -m "message"`, `git push`

## Debugging
- Bun automatically loads `.env` files, no need for dotenv package
- Use `console.log()` for debugging (though Biome's `noConsole` rule will flag this in production code)
