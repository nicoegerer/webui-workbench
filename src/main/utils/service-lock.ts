// @ts-nocheck

/** Synchronous check-and-set before any await prevents concurrent service starts.
* Release on stop or failure, not after a successful start. */

import log from 'electron-log'

export class ServiceLock {
  private locked = false
  private name: string

  constructor(name: string) {
    this.name = name
  }

  /** Atomic within the event loop; false means another start already owns the lock. */
  acquire(): boolean {
    if (this.locked) {
      log.info(`[${this.name}] Lock held — rejecting duplicate start`)
      return false
    }
    this.locked = true
    return true
  }

  release(): void {
    this.locked = false
  }

  isLocked(): boolean {
    return this.locked
  }
}

export const isProcessAlive = (pid: number | null): boolean => {
  if (!pid) return false
  try {
    process.kill(pid, 0) // signal 0 = existence check, no actual signal sent
    return true
  } catch {
    return false
  }
}
