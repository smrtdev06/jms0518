// Runs one user's start, clear and combined-download steps one at a time, so a double click on
// Generate, or Clear right after Generate, cannot interleave and leave cards or files behind.

const globalForLocks = globalThis as unknown as { userLocks?: Map<number, Promise<unknown>> };

function locks() {
  if (!globalForLocks.userLocks) globalForLocks.userLocks = new Map();
  return globalForLocks.userLocks;
}

export function withUserLock<T>(userPk: number, task: () => Promise<T>): Promise<T> {
  const previous = locks().get(userPk) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  locks().set(userPk, next);
  const release = () => {
    if (locks().get(userPk) === next) locks().delete(userPk);
  };
  next.then(release, release);
  return next;
}
