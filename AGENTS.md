# Repository Guidelines

## Project Structure & Module Organization

This is a NestJS 12 application written in strict TypeScript. Application code lives in `src/`: `main.ts` boots Nest, `app.module.ts` composes modules, and controllers/services stay beside their unit tests (`*.spec.ts`). End-to-end tests live in `test/`; `test/jest-e2e.json` contains their Jest configuration. Keep future feature code grouped by domain, for example `src/sauda/` for the Sauda client and parser, and `src/telegram/` for bot integration.

## Build, Test, and Development Commands

- `pnpm install` installs locked dependencies.
- `pnpm start:dev` starts Nest in watch mode for local development.
- `pnpm build` compiles the application to `dist/`.
- `pnpm lint` runs Oxlint over `src/` and `test/`.
- `pnpm format` formats TypeScript files with Prettier.
- `pnpm test` runs unit tests with Jest.
- `pnpm test:e2e` runs HTTP end-to-end tests.

Run `pnpm build`, `pnpm lint`, and the relevant test suite before opening a pull request.

## Coding Style & Naming Conventions

Use TypeScript with `strict` compiler settings. Follow Prettier output; do not hand-format around it. Use two-space indentation, single quotes, semicolons, and trailing commas where Prettier applies them. Name classes and Nest modules in PascalCase (`SaudaModule`, `LotParserService`); files use lowercase kebab-style names (`lot-parser.service.ts`). Use descriptive method names and explicit domain types for parsed lots and monetary values.

## Testing Guidelines

Use Jest and `@nestjs/testing`. Name unit tests `*.spec.ts` next to the code under test; name end-to-end tests `test/*.e2e-spec.ts`. Unit-test parsers and business rules with static HTML fixtures rather than live Sauda requests. Mock Telegram and HTTP boundaries. Cover success, invalid input, not-found, and upstream-error scenarios.

## Commit & Pull Request Guidelines

Current history uses short imperative subjects, e.g. `add new plugins`. Continue with concise lower-case imperative messages such as `add lot search parser`. Keep commits focused. Pull requests should explain the user-visible behavior, list validation commands run, link relevant issues, and include example bot output or screenshots when the Telegram interaction changes.

## Security & Configuration

Keep tokens and credentials in local environment files; never commit them. Document required variables in `.env.example`, including `TELEGRAM_BOT_TOKEN` and optional Sauda HTTP settings. Treat Sauda HTML as untrusted input and enforce request timeouts and clear failure handling.


# Project instructions

- Use TypeScript and NestJS.
- Use grammY for Telegram.
- Use native fetch for HTTP requests.
- Use Cheerio for parsing HTML.
- Use decimal.js for financial calculations.
- Do not use JavaScript number for monetary calculations.
- Use SQLite for persistence.
- Do not add Redis, BullMQ, microservices, or Playwright unless requested.
- Keep Sauda page parsing isolated from business logic.
- Write tests for HTML parsers using saved fixtures.
- Never commit .env files or API keys.