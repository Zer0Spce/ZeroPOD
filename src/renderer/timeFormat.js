(() => {
  if (window.__zeroPOD12HourTimeInstalled) return;
  window.__zeroPOD12HourTimeInstalled = true;

  const nativeLocaleString = Date.prototype.toLocaleString;
  const nativeLocaleTimeString = Date.prototype.toLocaleTimeString;

  function force12Hour(options) {
    const next = options ? { ...options } : {};
    delete next.hourCycle;
    next.hour12 = true;
    return next;
  }

  Date.prototype.toLocaleString = function zeroPODLocaleString(locales, options) {
    return nativeLocaleString.call(this, locales, force12Hour(options));
  };

  Date.prototype.toLocaleTimeString = function zeroPODLocaleTimeString(locales, options) {
    return nativeLocaleTimeString.call(this, locales, force12Hour(options));
  };

  window.ZeroPODTime = Object.freeze({
    formatDateTime(value, options = {}) {
      if (!value) return 'Never';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return nativeLocaleString.call(date, undefined, force12Hour(options));
    },
    formatTime(value, options = {}) {
      if (!value) return 'Never';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return nativeLocaleTimeString.call(date, undefined, force12Hour(options));
    }
  });
})();
