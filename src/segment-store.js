const DATABASE = "longpage-snap";
const STORE = "segments";

let connection;

function openDatabase() {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
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

function key(jobId, index) {
  return [jobId, index];
}

async function transact(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
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
      typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/jpeg;base64,")) {
    throw new TypeError("Invalid JPEG segment.");
  }
  await transact("readwrite", (store) => store.put(dataUrl, key(jobId, index)));
}

export async function readSegment(jobId, index) {
  const value = await transact("readonly", (store) => store.get(key(jobId, index)));
  if (typeof value !== "string") {
    throw new Error("JPEG segment unavailable. Restart capture.");
  }
  return value;
}

export async function clearSegments(jobId, count) {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError("Invalid segment count.");
  }
  await transact("readwrite", (store) => {
    for (let index = 1; index <= count; index += 1) {
      store.delete(key(jobId, index));
    }
  });
}
