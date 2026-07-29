/**
 * Wraps a promise or PromiseLike (such as Supabase PostgrestQueryBuilder) with a maximum timeout.
 * If the promise does not resolve within `ms` milliseconds,
 * it returns `fallbackValue` (or rejects if `fallbackValue` is undefined).
 */
export function withTimeout<T>(
  promise: PromiseLike<T> | Promise<T> | (() => PromiseLike<T> | Promise<T>),
  ms: number,
  fallbackValue?: T
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: any = null;
    let completed = false;

    if (ms > 0) {
      timer = setTimeout(() => {
        if (completed) return;
        completed = true;
        if (fallbackValue !== undefined) {
          resolve(fallbackValue);
        } else {
          reject(new Error(`Operation timed out after ${ms}ms`));
        }
      }, ms);
    }

    const execPromise = typeof promise === 'function' ? promise() : promise;

    Promise.resolve(execPromise)
      .then((res) => {
        if (completed) return;
        completed = true;
        if (timer) clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        if (completed) return;
        completed = true;
        if (timer) clearTimeout(timer);
        if (fallbackValue !== undefined) {
          resolve(fallbackValue);
        } else {
          reject(err);
        }
      });
  });
}
