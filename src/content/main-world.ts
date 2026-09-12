import {
  INTERCEPT_ATTRIBUTE,
  PAGE_EVENT_NATIVE_PRINT,
  PAGE_EVENT_PRINT_REQUESTED,
} from '../shared/events';

/**
 * Runs in the page's own JavaScript world at document_start, before site code
 * can call print(). It captures the real window.print() and replaces it with a
 * stub that hands the request to the extension instead.
 */
(() => {
  const nativePrint = window.print.bind(window);

  // The extension asks for the original dialog through this event, both when
  // the user opts out for a site and as the fallback after a failed upload.
  window.addEventListener(PAGE_EVENT_NATIVE_PRINT, () => {
    nativePrint();
  });

  const interceptingEnabled = () =>
    document.documentElement.getAttribute(INTERCEPT_ATTRIBUTE) !== 'off';

  const override = function print(): void {
    if (!interceptingEnabled()) {
      nativePrint();
      return;
    }
    window.dispatchEvent(new CustomEvent(PAGE_EVENT_PRINT_REQUESTED));
  };

  // Sites sometimes feature-detect by stringifying built-ins; keep it
  // native-looking. The name has to be pinned too, because minification
  // rewrites the declared function name.
  Object.defineProperty(override, 'toString', {
    value: () => 'function print() { [native code] }',
    configurable: true,
  });
  Object.defineProperty(override, 'name', { value: 'print', configurable: true });

  Object.defineProperty(window, 'print', {
    value: override,
    writable: true,
    configurable: true,
  });
})();
