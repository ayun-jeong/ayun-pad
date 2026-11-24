// Bound the whole operation, including waiting for an auth token before fetch starts.
// Aborting fetch alone cannot release a request stuck before the network call.
export async function syncRequest<T>(run: (signal: AbortSignal) => PromiseLike<T>, timeout = 25000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => run(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('서버 응답이 지연되고 있어요. 잠시 후 자동으로 다시 시도합니다.'));
        }, timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
