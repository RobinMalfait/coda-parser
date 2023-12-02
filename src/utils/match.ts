export let __ = Symbol('match.__')

export function match<T extends string | number = string, R = unknown>(
  value: T,
  lookup: Record<T, R | ((...args: any[]) => R)>,
  ...args: any[]
): R {
  if (value in lookup) {
    let returnValue = lookup[value]
    return typeof returnValue === 'function' ? returnValue(...args) : returnValue
  }

  if (__ in lookup) {
    // @ts-expect-error
    let returnValue = lookup[__]
    return typeof returnValue === 'function' ? returnValue(value, ...args) : returnValue
  }

  let error = new Error(
    `Tried to handle "${value}" but there is no handler defined. Only defined handlers are: ${Object.keys(
      lookup
    )
      .map((key) => `"${key}"`)
      .join(', ')}.`
  )
  if (Error.captureStackTrace) Error.captureStackTrace(error, match)
  throw error
}
