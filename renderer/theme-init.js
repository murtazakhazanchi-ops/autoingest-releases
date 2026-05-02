(function () {
  var p = localStorage.getItem('theme') || 'auto';
  var t = p === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : p;
  document.documentElement.setAttribute('data-theme', t);
}());
