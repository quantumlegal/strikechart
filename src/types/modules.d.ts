declare module 'play-sound' {
  interface Player {
    play(what: string, callback?: (err: Error | null) => void): void;
  }

  interface PlaySoundOptions {
    player?: string;
  }

  function playSound(options?: PlaySoundOptions): Player;

  export = playSound;
}

declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export interface Database {
    run(sql: string, params?: any[]): Database;
    // Method name is e-x-e-c without hyphens
    ["exec"](sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface QueryExecResult {
    columns: string[];
    values: any[][];
  }

  export interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    getAsObject(params?: object): object;
    free(): boolean;
  }

  export interface SqlJsConfig {
    locateFile?: (path: string) => string;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
