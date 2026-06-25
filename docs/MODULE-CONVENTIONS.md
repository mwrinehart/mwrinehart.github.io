# Module conventions

How to add (or port) a module. The **Behavior** module (`lib/modules/behavior/`,
`app/(app)/behavior/`) is the reference implementation — copy its shape.

## The contract

A module:

1. **Owns its tables.** Define them in `lib/modules/<id>/schema.ts` (Drizzle) and
   ship raw DDL in `lib/modules/<id>/migrate.ts` exporting
   `migrate<Name>(client: PoolClient)`. Every table has an `org_id` column.
2. **Registers two integration points** with the platform:
   - re-export its schema from `lib/platform/db/schema.ts`
     (`export * from "@/lib/modules/<id>/schema"`) so Drizzle Kit sees it;
   - add its migrator to `MODULE_MIGRATORS` in `lib/platform/db/index.ts`.
3. **Appears in the registry.** Add a `ModuleDef` to `MODULES` in
   `lib/platform/modules.ts` (id, label, blurb, icon, href, sourceApp, status).
   This drives the sidebar, dashboard, and entitlements automatically.
4. **Lives under its route group** `app/(app)/<id>/`. Every page resolves the
   tenant with `requireTenant(minRole?)` before touching data.
5. **Reuses the spine.** Use `lib/platform/{notify,feeds,ai,secrets}` rather than
   re-implementing notifications, RSS scanning, AI calls, or secret storage.

## Rules

- **Tenant isolation is explicit.** Domain functions take `orgId: string` as an
  argument; resolve it in the page via `requireTenant()` and pass it down. Never
  read the session inside a deep data function.
- **No platform → module imports** except the two integration points above. The
  platform must not depend on a module's domain logic.
- **No cross-module imports.** If two modules need the same thing, it belongs in
  `lib/platform/`. (This is how Compliance and Behavior end up sharing the feed
  engine instead of forking it.)
- **Timestamps** are epoch-ms `bigint` (`{ mode: "number" }`).
- **Server vs. client.** Keep `lib/modules/<id>/*` server-only (they import `db`).
  Mark interactive components `"use client"` and pass them plain data + server
  actions as props.

## Checklist for a new module `foo`

```
lib/modules/foo/schema.ts      # Drizzle tables (org-scoped)
lib/modules/foo/migrate.ts     # export migrateFoo(client)
lib/modules/foo/*.ts           # domain logic, each fn takes orgId
app/(app)/foo/page.tsx         # requireTenant() then render

# wire-up:
lib/platform/db/schema.ts      # + export * from "@/lib/modules/foo/schema"
lib/platform/db/index.ts       # + migrateFoo in MODULE_MIGRATORS
lib/platform/modules.ts        # + ModuleDef in MODULES
```

That's the whole contract. The spine handles auth, orgs, RBAC, secrets,
notifications, feeds, and AI — a module only writes its domain.
