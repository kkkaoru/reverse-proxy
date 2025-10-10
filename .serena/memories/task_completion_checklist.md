# Task Completion Checklist

When completing a coding task, follow these steps to ensure code quality:

## 1. Run Linter
```bash
bun run lint
```
- Check for any linting errors
- If errors exist, fix them or run auto-fix:
```bash
bun run lint:fix
```

## 2. Run Tests
```bash
bun test
```
- Ensure all existing tests pass
- Add new tests for new functionality
- Aim for good test coverage

## 3. Optional: Check Test Coverage
```bash
bun run test:coverage
```
- Review coverage report in `coverage/` directory
- Ensure critical paths are tested

## 4. Verify TypeScript Compilation
- The project uses `noEmit: true` in tsconfig.json
- TypeScript errors should be caught by your editor/IDE
- Biome also performs type checking

## 5. Manual Testing (if applicable)
```bash
bun --hot index.ts
```
- Test the application locally
- Verify changes work as expected

## 6. Preview on Cloudflare (if applicable)
```bash
bunx wrangler dev
```
- Test in Cloudflare Workers environment
- Verify compatibility with Workers runtime

## 7. Git Commit
```bash
git add .
git commit -m "descriptive commit message"
```

## 8. Deploy (if ready)
```bash
bunx wrangler deploy
```

## Common Issues to Check
- [ ] No console.log statements in production code
- [ ] All imports have file extensions (.ts, .tsx)
- [ ] No default exports used
- [ ] No `any` types
- [ ] Functions have ≤3 parameters
- [ ] Functions have ≤50 lines
- [ ] No unused imports or variables
- [ ] Proper error handling
- [ ] Type safety maintained
