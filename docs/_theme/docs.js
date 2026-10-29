/*
 * Squiggly Square documentation runtime.
 *
 * Progressive enhancement only — every page reads fine without it. Adds:
 * live previews (the standalone Squisq player, loaded the first time an
 * example scrolls into view), search over a prebuilt index, copy buttons,
 * the mobile navigation drawer, and the "On this page" highlight.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var themeUrl = new URL('.', script ? script.src : window.location.href);
  var docsRootUrl = new URL('..', themeUrl);
  var THEME_KEY = 'squisq-docs:preview-theme';

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch {
      // Private windows: the choice just doesn't persist.
    }
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Navigation drawer ────────────────────────────────────────────

  function setupNavigation() {
    var button = document.querySelector('.sq-menu');
    var sidebar = document.getElementById('sq-sidebar');
    if (!button || !sidebar) return;

    // On narrow screens the header tabs live at the top of the drawer.
    var tabs = document.querySelector('.sq-tabs');
    if (tabs && tabs.children.length) {
      var mobileTabs = document.createElement('div');
      mobileTabs.className = 'sq-mobile-tabs';
      mobileTabs.innerHTML = tabs.innerHTML;
      sidebar.insertBefore(mobileTabs, sidebar.firstChild);
    }

    function setOpen(open) {
      if (open) document.body.setAttribute('data-nav-open', '');
      else document.body.removeAttribute('data-nav-open');
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      button.setAttribute('aria-label', open ? 'Hide navigation' : 'Show navigation');
    }

    button.addEventListener('click', function () {
      setOpen(!document.body.hasAttribute('data-nav-open'));
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setOpen(false);
    });
    document.addEventListener('click', function (event) {
      if (!document.body.hasAttribute('data-nav-open')) return;
      if (sidebar.contains(event.target) || button.contains(event.target)) return;
      setOpen(false);
    });

    // Bring the current page into view inside the sidebar without scrolling the page.
    var current = sidebar.querySelector('[aria-current="page"]');
    if (current) sidebar.scrollTop = current.offsetTop - sidebar.clientHeight / 2;
  }

  // ── Copy buttons ─────────────────────────────────────────────────

  function setupCopyButtons() {
    if (!navigator.clipboard) return;
    document.querySelectorAll('.sq-code').forEach(function (block) {
      var code = block.querySelector('code');
      if (!code) return;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'sq-copy';
      button.textContent = 'Copy';
      button.addEventListener('click', function () {
        navigator.clipboard.writeText(code.textContent || '').then(function () {
          button.textContent = 'Copied';
          button.setAttribute('data-copied', '');
          setTimeout(function () {
            button.textContent = 'Copy';
            button.removeAttribute('data-copied');
          }, 1600);
        });
      });
      block.appendChild(button);
    });
  }

  // ── "On this page" highlight ─────────────────────────────────────

  function setupTocSpy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.sq-toc a'));
    if (!links.length) return;
    var entries = links
      .map(function (link) {
        return {
          link: link,
          heading: document.getElementById(decodeURIComponent(link.hash.slice(1))),
        };
      })
      .filter(function (entry) {
        return entry.heading;
      });
    var pending = false;

    // The current section is the last heading scrolled past the header.
    function update() {
      pending = false;
      var offset = 120;
      var active = entries[0];
      for (var i = 0; i < entries.length; i += 1) {
        if (entries[i].heading.getBoundingClientRect().top <= offset) active = entries[i];
        else break;
      }
      entries.forEach(function (entry) {
        if (entry === active) entry.link.setAttribute('aria-current', 'true');
        else entry.link.removeAttribute('aria-current');
      });
    }

    window.addEventListener(
      'scroll',
      function () {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(update);
      },
      { passive: true },
    );
    update();
  }

  // ── Search ───────────────────────────────────────────────────────

  function setupSearch() {
    var box = document.querySelector('.sq-search');
    if (!box) return;
    var input = box.querySelector('input');
    var results = box.querySelector('.sq-search-results');
    var index = null;
    var loading = null;
    var selected = -1;

    function load() {
      if (!loading) {
        loading = fetch(new URL('search-index.json', themeUrl))
          .then(function (response) {
            return response.json();
          })
          .then(function (entries) {
            index = entries.map(function (entry) {
              return {
                entry: entry,
                title: entry.t.toLowerCase(),
                headings: entry.h.map(function (heading) {
                  return heading[0].toLowerCase();
                }),
                keywords: entry.k.toLowerCase(),
                text: entry.x.toLowerCase(),
              };
            });
          })
          .catch(function () {
            index = [];
          });
      }
      return loading;
    }

    function score(item, terms) {
      var total = 0;
      var heading = -1;
      for (var i = 0; i < terms.length; i += 1) {
        var term = terms[i];
        var points = 0;
        if (item.title === term) points += 40;
        else if (item.title.indexOf(term) === 0) points += 24;
        else if (item.title.indexOf(term) >= 0) points += 14;
        for (var h = 0; h < item.headings.length; h += 1) {
          if (item.headings[h].indexOf(term) >= 0) {
            points += item.headings[h] === term ? 12 : 7;
            if (heading < 0) heading = h;
            break;
          }
        }
        if (item.keywords.indexOf(term) >= 0) points += 6;
        var at = item.text.indexOf(term);
        if (at >= 0) points += 2 + Math.min(3, item.text.split(term).length - 2);
        if (points === 0) return null;
        total += points;
      }
      return { score: total, heading: heading };
    }

    function snippet(item, terms) {
      var text = item.entry.x;
      var lower = item.text;
      var at = -1;
      for (var i = 0; i < terms.length && at < 0; i += 1) at = lower.indexOf(terms[i]);
      if (at < 0) return '';
      var start = Math.max(0, at - 60);
      var piece = (start > 0 ? '…' : '') + text.slice(start, at + 110) + '…';
      var html = escapeHtml(piece);
      terms.forEach(function (term) {
        var pattern = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        html = html.replace(pattern, '<mark>$1</mark>');
      });
      return html;
    }

    function render() {
      var query = input.value.trim().toLowerCase();
      selected = -1;
      if (!query) {
        results.hidden = true;
        return;
      }
      var terms = query.split(/\s+/).filter(Boolean);
      var hits = [];
      (index || []).forEach(function (item) {
        var result = score(item, terms);
        if (result) hits.push({ item: item, score: result.score, heading: result.heading });
      });
      hits.sort(function (a, b) {
        return b.score - a.score;
      });
      hits = hits.slice(0, 12);
      if (!hits.length) {
        results.innerHTML =
          '<div class="sq-search-empty">No results for “' + escapeHtml(query) + '”</div>';
        results.hidden = false;
        return;
      }
      results.innerHTML = hits
        .map(function (hit) {
          var entry = hit.item.entry;
          var href = new URL(entry.u, docsRootUrl).href;
          var where = entry.s;
          if (hit.heading >= 0) {
            href += '#' + entry.h[hit.heading][1];
            where = entry.s + ' › ' + entry.h[hit.heading][0];
          }
          return (
            '<a role="option" href="' +
            escapeHtml(href) +
            '"><strong>' +
            escapeHtml(entry.t) +
            '</strong><small>' +
            escapeHtml(where) +
            '</small><p>' +
            snippet(hit.item, terms) +
            '</p></a>'
          );
        })
        .join('');
      results.hidden = false;
    }

    function move(delta) {
      var options = results.querySelectorAll('a');
      if (!options.length) return;
      selected = (selected + delta + options.length) % options.length;
      options.forEach(function (option, i) {
        option.setAttribute('aria-selected', i === selected ? 'true' : 'false');
      });
      options[selected].scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('focus', load);
    input.addEventListener('input', function () {
      load().then(render);
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'Enter') {
        var options = results.querySelectorAll('a');
        var target = options[selected >= 0 ? selected : 0];
        if (target) window.location.href = target.href;
      } else if (event.key === 'Escape') {
        input.value = '';
        results.hidden = true;
        input.blur();
      }
    });
    document.addEventListener('keydown', function (event) {
      var tag = (event.target && event.target.tagName) || '';
      if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag)) {
        event.preventDefault();
        input.focus();
      }
    });
    document.addEventListener('click', function (event) {
      if (!box.contains(event.target)) results.hidden = true;
    });
  }

  // ── Live previews ────────────────────────────────────────────────

  var playerPromise = null;

  function loadPlayer() {
    if (window.SquisqPlayer) return Promise.resolve(window.SquisqPlayer);
    if (!playerPromise) {
      playerPromise = new Promise(function (resolve, reject) {
        var tag = document.createElement('script');
        tag.src = new URL('squisq-player.js', themeUrl).href;
        tag.onload = function () {
          if (window.SquisqPlayer) resolve(window.SquisqPlayer);
          else reject(new Error('The Squisq player did not load.'));
        };
        tag.onerror = function () {
          reject(new Error('The Squisq player could not be fetched.'));
        };
        document.head.appendChild(tag);
      });
    }
    return playerPromise;
  }

  function setupPreviews() {
    var dataNode = document.getElementById('sq-previews');
    if (!dataNode) return;
    var data;
    try {
      data = JSON.parse(dataNode.textContent || '{}');
    } catch {
      return;
    }
    var previews = data.previews || [];
    var themes = data.themes || [];
    var themeIds = themes.map(function (theme) {
      return theme.id;
    });
    var chosenTheme = storageGet(THEME_KEY);
    if (themeIds.indexOf(chosenTheme) < 0) chosenTheme = '';
    var mounted = [];

    // The player's resource policy accepts absolute URLs, not page-relative ones.
    previews.forEach(function (preview) {
      Object.keys(preview.images || {}).forEach(function (key) {
        preview.images[key] = new URL(preview.images[key], window.location.href).href;
      });
    });

    function mountInto(stage, preview, isThumb) {
      return loadPlayer().then(function (player) {
        var doc = chosenTheme
          ? Object.assign({}, preview.doc, { themeId: chosenTheme })
          : preview.doc;
        var mode = preview.mode === 'page' ? 'static' : preview.mode;
        player.mount(stage, doc, {
          mode: mode,
          images: preview.images,
          viewport: preview.viewport,
          globalKeyboardShortcuts: false,
          animationsEnabled:
            !isThumb || !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        });
        stage.setAttribute('data-state', 'ready');
        mounted.push({ stage: stage, preview: preview, thumb: isThumb });
      });
    }

    function remountAll() {
      mounted.forEach(function (entry) {
        var doc = chosenTheme
          ? Object.assign({}, entry.preview.doc, { themeId: chosenTheme })
          : entry.preview.doc;
        var mode = entry.preview.mode === 'page' ? 'static' : entry.preview.mode;
        window.SquisqPlayer.mount(entry.stage, doc, {
          mode: mode,
          images: entry.preview.images,
          viewport: entry.preview.viewport,
          globalKeyboardShortcuts: false,
        });
      });
    }

    function themeSelect() {
      var label = document.createElement('label');
      label.textContent = 'Theme';
      var select = document.createElement('select');
      select.className = 'sq-theme-select';
      var original = document.createElement('option');
      original.value = '';
      original.textContent = 'As written';
      select.appendChild(original);
      themes.forEach(function (theme) {
        var option = document.createElement('option');
        option.value = theme.id;
        option.textContent = theme.name;
        select.appendChild(option);
      });
      select.value = chosenTheme;
      select.addEventListener('change', function () {
        chosenTheme = select.value;
        storageSet(THEME_KEY, chosenTheme);
        document.querySelectorAll('.sq-theme-select').forEach(function (other) {
          other.value = chosenTheme;
        });
        if (window.SquisqPlayer) remountAll();
      });
      label.appendChild(select);
      return label;
    }

    var targets = [];
    document.querySelectorAll('.sq-preview[data-preview]').forEach(function (figure) {
      var preview = previews[Number(figure.getAttribute('data-preview'))];
      var stage = figure.querySelector('.sq-preview-stage');
      var bar = figure.querySelector('.sq-preview-bar');
      if (!preview || !stage) return;
      if (bar && themes.length)
        bar.insertBefore(themeSelect(), bar.querySelector('.sq-preview-open'));
      targets.push({ element: stage, preview: preview, thumb: false });
    });
    document.querySelectorAll('[data-thumb]').forEach(function (thumb) {
      var preview = previews[Number(thumb.getAttribute('data-thumb'))];
      if (preview) targets.push({ element: thumb, preview: preview, thumb: true });
    });
    if (!targets.length) return;

    function start(target) {
      if (target.started) return;
      target.started = true;
      mountInto(target.element, target.preview, target.thumb).catch(function () {
        target.element.setAttribute('data-state', 'error');
      });
    }

    if (!('IntersectionObserver' in window)) {
      targets.forEach(start);
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var target = targets.find(function (candidate) {
            return candidate.element === entry.target;
          });
          if (target) start(target);
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '300px 0px' },
    );
    targets.forEach(function (target) {
      observer.observe(target.element);
    });
  }

  function init() {
    setupNavigation();
    setupCopyButtons();
    setupTocSpy();
    setupSearch();
    setupPreviews();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
