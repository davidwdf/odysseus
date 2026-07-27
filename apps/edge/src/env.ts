/** The Worker's bindings. Declared in `bindings.d.ts`; re-exported here so runtime modules can
 *  `import type { Env }` without reaching into the global namespace. */
export type Env = Cloudflare.Env
