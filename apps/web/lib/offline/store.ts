/**
 * Local persistence for the brew logger (EF §2.2, brew_logger_ux §5).
 *
 * The logger must be interactive before any network response and must survive
 * backgrounding, a phone call and an app restart — so everything it needs
 * (prefill, draft, logged sessions, the sync queue) lives in IndexedDB.
 *
 * The surface is a deliberately small key/value port rather than an IndexedDB
 * API, for three reasons:
 *  - tests inject an in-memory store instead of shimming the whole IDB spec;
 *  - SSR / private-mode Safari / a browser that refuses to open a database
 *    degrade to memory instead of crashing the most important screen;
 *  - the same port can be backed by SQLite on native iOS later without the
 *    logger noticing (EF §2.2 exists so iOS is an additive client).
 */

export interface OfflineStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** All entries whose key starts with `prefix`, in insertion order. */
  entries<T>(prefix?: string): Promise<Array<[string, T]>>;
  clear(): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * Memory adapter — tests, SSR, and the fallback when IndexedDB is gone
 * ------------------------------------------------------------------ */

export function createMemoryStore(seed?: Iterable<[string, unknown]>): OfflineStore {
  const map = new Map<string, string>();
  for (const [key, value] of seed ?? []) map.set(key, JSON.stringify(value));

  // Values are cloned through JSON so a caller mutating what it read cannot
  // silently corrupt "persisted" state — the IDB adapter behaves that way too.
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const raw = map.get(key);
      return raw === undefined ? undefined : (JSON.parse(raw) as T);
    },
    async set<T>(key: string, value: T): Promise<void> {
      map.set(key, JSON.stringify(value));
    },
    async delete(key: string): Promise<void> {
      map.delete(key);
    },
    async entries<T>(prefix?: string): Promise<Array<[string, T]>> {
      const out: Array<[string, T]> = [];
      for (const [key, raw] of map) {
        if (prefix === undefined || key.startsWith(prefix)) {
          out.push([key, JSON.parse(raw) as T]);
        }
      }
      return out;
    },
    async clear(): Promise<void> {
      map.clear();
    },
  };
}

/* ------------------------------------------------------------------ *
 * IndexedDB adapter
 * ------------------------------------------------------------------ */

export const IDB_NAME = 'brewcult';
export const IDB_STORE = 'kv';
export const IDB_VERSION = 1;

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(name: string, version: number, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

export function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * IndexedDB-backed store. If the database cannot be opened (private mode,
 * quota, an older schema we cannot upgrade) every operation transparently falls
 * back to an in-memory store: a user who cannot persist still gets to log the
 * brew they are holding a kettle over.
 */
export function createIndexedDbStore(
  options: { name?: string; storeName?: string; version?: number } = {},
): OfflineStore {
  const name = options.name ?? IDB_NAME;
  const storeName = options.storeName ?? IDB_STORE;
  const version = options.version ?? IDB_VERSION;

  const fallback = createMemoryStore();
  let dbPromise: Promise<IDBDatabase | null> | null = null;

  function database(): Promise<IDBDatabase | null> {
    dbPromise ??= (hasIndexedDb()
      ? openDatabase(name, version, storeName).catch(() => null)
      : Promise.resolve(null)
    ).then((db) => db);
    return dbPromise;
  }

  async function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>,
    onUnavailable: () => Promise<T>,
  ): Promise<T> {
    const db = await database();
    if (!db) return onUnavailable();
    try {
      const tx = db.transaction(storeName, mode);
      return await run(tx.objectStore(storeName));
    } catch {
      // A transaction can still fail late (disk full, db deleted underneath us).
      // Losing the write is bad; losing the log is worse.
      return onUnavailable();
    }
  }

  return {
    get<T>(key: string) {
      return withStore<T | undefined>(
        'readonly',
        async (store) => (await promisify(store.get(key))) as T | undefined,
        () => fallback.get<T>(key),
      );
    },
    set<T>(key: string, value: T) {
      return withStore<void>(
        'readwrite',
        async (store) => {
          await promisify(store.put(value as unknown as never, key));
        },
        () => fallback.set(key, value),
      );
    },
    delete(key: string) {
      return withStore<void>(
        'readwrite',
        async (store) => {
          await promisify(store.delete(key));
        },
        () => fallback.delete(key),
      );
    },
    entries<T>(prefix?: string) {
      return withStore<Array<[string, T]>>(
        'readonly',
        async (store) => {
          const keys = (await promisify(store.getAllKeys())) as IDBValidKey[];
          const values = (await promisify(store.getAll())) as T[];
          const out: Array<[string, T]> = [];
          keys.forEach((key, index) => {
            const asString = String(key);
            if (prefix === undefined || asString.startsWith(prefix)) {
              out.push([asString, values[index] as T]);
            }
          });
          return out;
        },
        () => fallback.entries<T>(prefix),
      );
    },
    clear() {
      return withStore<void>(
        'readwrite',
        async (store) => {
          await promisify(store.clear());
        },
        () => fallback.clear(),
      );
    },
  };
}

/** IndexedDB in the browser, memory everywhere else. */
export function createOfflineStore(): OfflineStore {
  return hasIndexedDb() ? createIndexedDbStore() : createMemoryStore();
}
