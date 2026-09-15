# AFP — Instruction Files (Index)

> **Purpose:** These files are the *single source of truth* for how the **All For Pets
> Municipal Pet Registry** application is structured. Read them first before making
> any code change — they will save a full-codebase re-read every time.

Repository: <https://github.com/Tapan520/AFP>
Working directory: `C:\CursorProjects\AFP\`
Solution: `AFP.csproj` (Razor Pages, .NET 8)

---

## Reading Order

| # | File | Read this to learn… |
|---|---|---|
| 00 | [`00-overview.md`](./00-overview.md) | What the app does, tech stack, top-level layout |
| 01 | [`01-architecture.md`](./01-architecture.md) | How the frontend, .NET proxy, Node backend and Postgres fit together |
| 02 | [`02-backend-dotnet.md`](./02-backend-dotnet.md) | Every endpoint in `Program.cs` and which ones proxy vs. hit Postgres directly |
| 03 | [`03-backend-node.md`](./03-backend-node.md) | The Express (Railway) backend routes and their auth model |
| 04 | [`04-frontend-structure.md`](./04-frontend-structure.md) | `_AppLayout.cshtml`, `Index.cshtml` screens, script load order, screen router |
| 05 | [`05-frontend-modules.md`](./05-frontend-modules.md) | Purpose of every `wwwroot/js/afp-*.js` module |
| 06 | [`06-database-schema.md`](./06-database-schema.md) | Postgres tables, columns and how they relate |
| 07 | [`07-conventions-gotchas.md`](./07-conventions-gotchas.md) | Coding patterns, naming, known pitfalls (bug patterns to avoid) |
| 08 | [`08-development-workflow.md`](./08-development-workflow.md) | Build, run, migrate, deploy, Git workflow |

---

## Golden Rules

1. **Do not read the whole codebase again.** These docs already summarise it.
2. **Update the docs** whenever you add a screen, an endpoint, a table column, or a JS module.
3. **Follow the file-header banner style** (`// ?? SECTION ???…`) used across every JS/CS file.
4. When in doubt about a specific pattern, `07-conventions-gotchas.md` has the answer.
