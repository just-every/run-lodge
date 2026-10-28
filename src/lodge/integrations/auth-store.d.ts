declare module '*operator-auth/accounts/store.mjs' {
  export class AuthStore {
    constructor(db: D1Database)
    session(hash: string, now: number): Promise<import('../core/store').Session | null>
  }
}
