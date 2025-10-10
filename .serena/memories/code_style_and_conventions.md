# Code Style and Conventions

## Formatting (Biome Configuration)
- **Indentation**: Spaces, 2 spaces per level
- **Line width**: 100 characters maximum
- **Quote style**: Single quotes for JavaScript/TypeScript
- **Semicolons**: Always required

## TypeScript Configuration
- **Target**: ESNext
- **Module**: Preserve
- **Strict mode**: Enabled
- **Additional strict flags**:
  - `noFallthroughCasesInSwitch`: true
  - `noUncheckedIndexedAccess`: true
  - `noImplicitOverride`: true
- **Import extensions**: Required (`.ts`, `.tsx`, etc.)
- **JSX**: react-jsx

## Naming Conventions
- Use meaningful constant names (e.g., `HTTP_STATUS_OK = 200`)
- No shouty constants (SCREAMING_SNAKE_CASE discouraged unless truly constant)
- Prefer descriptive variable/function names

## Code Organization
- **No default exports**: Use named exports only (enforced by Biome)
- **No enums**: Use const objects or union types instead
- **No namespaces**: Use ES modules
- **No CommonJS**: Use ES modules (`import`/`export`)
- **Import extensions required**: Always include `.ts`, `.tsx` etc. in imports

## Best Practices (Enforced by Biome)
- **Arrow functions preferred**: Use arrow functions over regular functions where appropriate
- **No `forEach`**: Use `for...of`, `map`, `filter`, etc. instead
- **No `console`**: Console statements are errors (use logging library or remove for production)
- **No `any`**: Explicit `any` types are not allowed
- **No unused imports/variables**: All imports and variables must be used
- **Async/await**: Use `await` in async functions (enforced)
- **Max function complexity**: 8 (cognitive complexity limit)
- **Max lines per function**: 50 lines
- **Max parameters**: 3 parameters per function

## Testing Conventions
- Test files in `tests/` directory
- Test file naming: `*.test.ts`
- Use Vitest's `describe`, `it`, `expect` pattern
- Define constants for magic values (e.g., `HTTP_STATUS_OK`)

## Type Safety
- Explicit type annotations preferred (`useExplicitType` enforced)
- Use type definitions (`type`) over interfaces
- Exhaustive switch cases required
- No unnecessary conditions
- Guard `for...in` loops

## Security
- No blank `target` attributes
- No dangerous HTML manipulation
- No global `eval`
- No secrets in code (enforced by Biome)

## Exceptions to Rules
- Biome ignore comments can be used for specific cases:
  - `// biome-ignore lint/style/noDefaultExport: <reason>` (e.g., for Vitest config)
  - `// biome-ignore lint/nursery/noUnresolvedImports: <reason>` (e.g., for Vitest subpath imports)
