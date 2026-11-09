const DATABASE = "longpage-snap";
const SEGMENTS = "segments";
const EXPORTS = "exports";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

let connection;

function openDatabase() {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(SEGMENTS)) {
          request.result.createObjectStore(SEGMENTS);
        }
        if (!request.result.objectStoreNames.contains(EXPORTS)) {
          request.result.createObjectStore(EXPORTS);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      connection = null;
      throw error;
    });
  }
  return connection;
}

function segmentKey(jobId, index) {
  return [jobId, index];
}

async function transact(storeName, mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    let result;

    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function stageSegment(jobId, index, dataUrl) {
  if (!Number.isInteger(index) || index < 1 ||
      typeof dataUrl !== "string" || !/^data:image\/(?:jpeg|png|webp);base64,/.test(dataUrl)) {
    throw new TypeError("Invalid JPEG segment.");
  }
  await transact(SEGMENTS, "readwrite", (store) => store.put(dataUrl, segmentKey(jobId, index)));
}

export async function readSegment(jobId, index) {
  const value = await transact(SEGMENTS, "readonly", (store) => store.get(segmentKey(jobId, index)));
  if (typeof value !== "string") {
    throw new Error("JPEG segment unavailable. Restart capture.");
  }
  return value;
}

export async function clearSegments(jobId, count) {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError("Invalid segment count.");
  }
  await transact(SEGMENTS, "readwrite", (store) => {
    for (let index = 1; index <= count; index += 1) {
      store.delete(segmentKey(jobId, index));
    }
  });
}

export async function recordExport(jobId, tabId, count) {
  await transact(EXPORTS, "readwrite", (store) => store.put({
    tabId,
    count,
    createdAt: Date.now(),
  }, jobId));
}

async function findExport(jobId) {
  return transact(EXPORTS, "readonly", (store) => store.get(jobId));
}

export async function verifyExport(jobId, tabId, index) {
  if (typeof jobId !== "string" || !Number.isInteger(tabId)) {
    throw new Error("Invalid export session.");
  }
  const exportInfo = await findExport(jobId);
  if (!exportInfo || exportInfo.tabId !== tabId ||
      Date.now() - exportInfo.createdAt > MAX_AGE_MS) {
    throw new Error("Export expired or unavailable.");
  }
  if (index !== undefined && (!Number.isInteger(index) || index < 1 ||
      index > exportInfo.count)) {
    throw new RangeError("Invalid image part.");
  }
  return exportInfo;
}

export async function releaseExport(jobId, tabId) {
  const { count } = await verifyExport(jobId, tabId);
  await clearExport(jobId, count);
}

export async function clearExport(jobId, count) {
  await clearSegments(jobId, count);
  await transact(EXPORTS, "readwrite", (store) => store.delete(jobId));
}

export async function pruneExports(tabId) {
  const keys = await transact(EXPORTS, "readonly", (store) => store.getAllKeys());
  for (const id of keys) {
    const info = await findExport(id);
    if (!info) {
      continue;
    }
    const expired = Date.now() - info.createdAt > MAX_AGE_MS;
    if (expired || (Number.isInteger(tabId) && info.tabId === tabId)) {
      await clearExport(id, info.count);
    }
  }
}
