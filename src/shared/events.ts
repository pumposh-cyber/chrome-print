/**
 * Bridge between the MAIN world (where window.print lives) and the ISOLATED
 * world (where the chrome.* APIs live). Kept in its own module so the
 * MAIN-world bundle pulls in no chrome.* code.
 */

/** Fired by the page world when something called window.print(). */
export const PAGE_EVENT_PRINT_REQUESTED = 'print-to-drive:print-requested';

/** Fired at the page world to run the original, un-overridden window.print(). */
export const PAGE_EVENT_NATIVE_PRINT = 'print-to-drive:native-print';

/**
 * Set on <html> by the isolated world and read by the page world. An attribute
 * is used rather than event detail because structured-cloned detail is not
 * reliably readable across worlds.
 */
export const INTERCEPT_ATTRIBUTE = 'data-print-to-drive';
