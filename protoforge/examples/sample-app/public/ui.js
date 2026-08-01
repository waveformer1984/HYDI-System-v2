(function (global) {
  global.PF = {
    status: (el, message) => { if (el) el.textContent = message; }
  };
})(window);
