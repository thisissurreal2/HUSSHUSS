export async function withConnectionTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 45_000,
): Promise<T> {
  const controller = new AbortController()
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort()
      reject(new Error('Connection request timed out.'))
    }, timeoutMs)
  })

  try {
    return await Promise.race([operation(controller.signal), timeout])
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
    controller.abort()
  }
}
