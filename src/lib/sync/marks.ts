import type { Transaction } from 'dexie'

/**
 * Writes made inside these transactions came from the shared database (or are local built-in seeds),
 * so they must not be sent back. Change tracking checks this set.
 */
export const quietTransactions = new WeakSet<Transaction>()

export const markQuiet = (tx: Transaction) => {
  quietTransactions.add(tx)
}
