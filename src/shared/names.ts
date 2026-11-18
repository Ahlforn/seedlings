/** Names match whatever their case, and with or without a leading "the", "a" or "an": models drop both. */

export const plain = (name: string) => name.trim().toLowerCase().replace(/^(the|an|a)\s+/, '')
export const same = (a: string, b: string) => plain(a) === plain(b)
