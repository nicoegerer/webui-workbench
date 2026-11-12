/** Use Open WebUI's configured command and accessible menu instead of its private tab state.
 * Injected with toString(): keep this factory self-contained.
 */
export function createNativeFilesOpener(options: {
  bindings: () => Record<string, string>
  translate: (key: string) => string
  shortcutsEnabled: () => boolean
}): (terminalId: string, isCurrent: () => boolean) => Promise<boolean> {
  return async (terminalId, isCurrent) => {
    const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25))
    // Let native reactivity commit the new terminal before asking it to open Files.
    await pause()
    if (!isCurrent()) return false
    const active = (): HTMLButtonElement[] => [
      ...document.querySelectorAll<HTMLButtonElement>('button[role="tab"][aria-selected="true"]')
    ]
    const before = new Set(active())
    let handled = false
    const chord = options.bindings().openFiles
    if (options.shortcutsEnabled() && chord) {
      const parts = chord.split('+')
      const key = parts.at(-1)!
      const mac = /Mac|iPhone|iPad/.test(navigator.userAgent)
      const event = new KeyboardEvent('keydown', {
        key: key === 'Space' ? ' ' : key,
        code: /^[A-Z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
        ctrlKey: parts.includes('Ctrl') || (!mac && parts.includes('Cmd')),
        metaKey: mac && parts.includes('Cmd'),
        altKey: parts.includes('Alt'),
        shiftKey: parts.includes('Shift'),
        bubbles: true,
        cancelable: true
      })
      document.dispatchEvent(event)
      handled = event.defaultPrevented
    }
    if (!handled) {
      // Disabled/unassigned shortcuts still have the native, translated menu action.
      const dialogs = document.querySelectorAll('[aria-modal="true"], [role="alertdialog"]')
      if ([...dialogs].some((dialog) => !dialog.querySelector('#controls-container'))) return false
      const trigger = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(
        (button) =>
          button.getAttribute('aria-label') === options.translate('New tab') &&
          button.getBoundingClientRect().width > 0
      )
      if (!trigger) return false
      const previousMenus = new Set(document.querySelectorAll('[role="menu"]'))
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
      await pause()
      if (!isCurrent()) return false
      const menus = [...document.querySelectorAll('[role="menu"]')]
      const menu =
        menus.find((node) => !previousMenus.has(node)) ?? (menus.length === 1 ? menus[0] : null)
      const files =
        menu &&
        [...menu.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
          [...button.querySelectorAll('span')].some(
            (label) => label.textContent?.trim() === options.translate('Files')
          )
        )
      if (!files) return false
      files.click()
      handled = true
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      await pause()
      if (!isCurrent()) return false
      // Observe the result: a command accepted while a chat is loading may be a no-op.
      const selected = active().filter((button) => {
        const panel = document.getElementById(button.getAttribute('aria-controls') ?? '')
        return (
          panel &&
          [...panel.querySelectorAll('[role="region"]')].some(
            (region) => region.getAttribute('aria-label') === options.translate('File browser')
          )
        )
      })
      if (!selected.length) continue
      // Native Files IDs can be UUIDs and can be reused when the workspace changes.
      // Record the result of our command; preview never infers a workspace from a UUID.
      const changed = selected.filter((button) => !before.has(button))
      const known = selected.filter(
        (button) => button.closest<HTMLElement>('[data-panel-tab]')?.dataset.workbenchFilesTerminal
      )
      const target =
        changed.length === 1
          ? changed[0]
          : selected.length === 1
            ? selected[0]
            : known.length === 1
              ? known[0]
              : null
      const wrapper = target?.closest<HTMLElement>('[data-panel-tab]')
      if (wrapper) wrapper.dataset.workbenchFilesTerminal = terminalId
      return handled
    }
    return false
  }
}
