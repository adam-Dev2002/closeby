(() => {
  'use strict';
  const path = location.pathname.match(/^\/j\/([A-Za-z0-9-]+)\/?$/);
  const code = path?.[1].replace(/-/g, '').toUpperCase();
  const valid = code && (/^[A-HJ-NP-Z2-9]{12}$/.test(code) || /^[0-9A-F]{32}$/.test(code));
  if (!valid) {
    document.getElementById('title').textContent = location.pathname === '/' ? 'Your people, closer.' : 'Check your invitation.';
    document.getElementById('description').textContent = location.pathname === '/'
      ? 'Closeby brings your family and trusted people together in one private space.'
      : 'This invitation link is incomplete. Ask the person inviting you to send a new link from Closeby.';
    return;
  }
  const formatted = code.match(/.{1,4}/g).join('-');
  document.getElementById('invitation').hidden = false;
  document.getElementById('code').textContent = formatted;
  document.getElementById('open').href = /Android/i.test(navigator.userAgent)
    ? `intent://join/${code}#Intent;scheme=closeby;package=com.closeby.tracker;S.browser_fallback_url=${encodeURIComponent(`${location.origin}/j/${code}?install=1`)};end`
    : `closeby://join/${code}`;
  if (new URLSearchParams(location.search).get('install') === '1') document.getElementById('feedback').textContent = 'Install Closeby, then open this invitation again.';
  document.getElementById('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(formatted);
      document.getElementById('feedback').textContent = 'Code copied. In Closeby, open Spaces and paste it to join.';
    } catch {
      const selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(document.getElementById('code'));
      selection.removeAllRanges(); selection.addRange(range);
      document.getElementById('feedback').textContent = 'The code is selected. Touch and hold it to copy.';
    }
  });
})();
