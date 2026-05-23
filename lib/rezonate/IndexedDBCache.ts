const DB_NAME = 'rezonate-cache'
const STORE_NAME = 'blobs'
const DB_VERSION = 1

export class IndexedDBCache {
  private db: IDBDatabase | null = null

  async open(): Promise<void> {
    if (this.db) return

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result
        resolve()
      }

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error)
      }
    })
  }

  async save(key: string, blob: Blob): Promise<void> {
    await this.open()
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.put(blob, key)

      request.onsuccess = () => resolve()
      request.onerror = (event) => reject((event.target as IDBRequest).error)
    })
  }

  async load(key: string): Promise<Blob | null> {
    await this.open()
    return new Promise<Blob | null>((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(key)

      request.onsuccess = (event) => {
        const result = (event.target as IDBRequest).result
        resolve(result instanceof Blob ? result : null)
      }
      request.onerror = (event) => reject((event.target as IDBRequest).error)
    })
  }

  async delete(key: string): Promise<void> {
    await this.open()
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.delete(key)

      request.onsuccess = () => resolve()
      request.onerror = (event) => reject((event.target as IDBRequest).error)
    })
  }

  async clear(): Promise<void> {
    await this.open()
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.clear()

      request.onsuccess = () => resolve()
      request.onerror = (event) => reject((event.target as IDBRequest).error)
    })
  }

  async listKeys(): Promise<string[]> {
    await this.open()
    return new Promise<string[]>((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.getAllKeys()

      request.onsuccess = (event) => {
        const keys = (event.target as IDBRequest<IDBValidKey[]>).result
        resolve(keys.filter((k): k is string => typeof k === 'string'))
      }
      request.onerror = (event) => reject((event.target as IDBRequest).error)
    })
  }
}

export default IndexedDBCache
