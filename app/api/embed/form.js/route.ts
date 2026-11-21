/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';

/*! NuCRM embed widget — Property of abetworks.in. (c) 2026 abetworks.in. All Rights Reserved. Proprietary & confidential. */

const WIDGET_JS = `
(function() {
  'use strict';

  var BASE = (function() {
    var s = document.currentScript;
    return s ? s.src.replace(/\\/api\\/embed\\/form\\.js.*$/, '') : '';
  })();

  var params = new URLSearchParams(document.currentScript?.src?.split('?')[1] || '');
  var FORM_ID = params.get('id');
  var CONTAINER_ID = params.get('target') || 'nucrm-form';

  if (!FORM_ID) {
    console.error('[NuCRM] Missing form ID. Usage: <script src="...form.js?id=YOUR_FORM_ID"></script>');
    return;
  }

  var container = document.getElementById(CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    document.currentScript.parentNode.insertBefore(container, document.currentScript);
  }

  var formDef = null;

  // #3408: a failed load must not be rendered as an empty form. Terser keeps
  // property names and string literals, so these shapes survive minification.
  function loadError(body, status) {
    if (body && typeof body === 'object') {
      if (typeof body.error === 'string') return body.error;
      if (body.error && typeof body.error.message === 'string') return body.error.message;
      if (typeof body.message === 'string') return body.message;
    }
    return 'Failed to load form (HTTP ' + status + ')';
  }

  // #3408: the submit endpoint still answers legacy { error: "..." } today,
  // but the canonical envelope is { ok:false, error:{ code, message } }. Read
  // both so a switch on the server cannot turn a refusal into "[object Object]".
  function submitError(body) {
    if (body && typeof body === 'object') {
      if (typeof body.error === 'string') return body.error;
      if (body.error && typeof body.error.message === 'string') return body.error.message;
      if (typeof body.message === 'string') return body.message;
    }
    return 'Submission failed';
  }

  function fetchForm() {
    return fetch(BASE + '/api/tenant/forms/public/' + FORM_ID)
      .then(function(r) {
        if (r.ok === false) {
          // The public form route answers 404 for missing/unpublished forms,
          // 403 for a suspended tenant and 500 on a server error — always with
          // a JSON {error: "..."} body. Surface it instead of handing that body
          // to renderForm, which used to produce an empty form with a Submit
          // button (the "no data" lie #3408 names).
          return r.json().then(
            function(body) { throw new Error(loadError(body, r.status)); },
            function() { throw new Error(loadError(null, r.status)); }
          );
        }
        // Happy path keeps its single r.json() hop — the render below runs in
        // the same promise turn as before this fix.
        return r.json();
      });
  }

  function trackView() {
    return fetch(BASE + '/api/tenant/forms/public/' + FORM_ID + '/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'view' })
    }).catch(function(err) {
      console.error('[NuCRM] Form analytics view tracking failed:', err);
    });
  }

  function trackSubmit() {
    return fetch(BASE + '/api/tenant/forms/public/' + FORM_ID + '/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'submit' })
    }).catch(function(err) {
      console.error('[NuCRM] Form analytics submit tracking failed:', err);
    });
  }

  function renderForm(def) {
    formDef = def;
    var fields = def.fields || [];
    var submitLabel = 'Submit';
    var successMsg = (def.settings && def.settings.success_message) || 'Thank you!';

    var html = '<form id="nucrm-embed-form" novalidate style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px;">';

    if (def.name) {
      html += '<h2 style="margin:0 0 4px;font-size:18px;font-weight:600;color:#1a1a2e;">' + escapeHtml(def.name) + '</h2>';
    }
    if (def.description) {
      html += '<p style="margin:0 0 16px;font-size:14px;color:#666;">' + escapeHtml(def.description) + '</p>';
    }

    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      // #2287: key the input by the field identity (key ?? id ?? name) so the
      // submitted payload lines up with the server-side required check in
      // lib/forms/field-shape (API-created forms store id, legacy key).
      // #3296: that identity is tenant-authored and lands in id=/for= below, so it goes through
      // escapeHtml at every site — a quote there ends the attribute, and the html is handed to
      // innerHTML and delivered to whatever site embedded this script.
      var name = f.key || f.id || f.name || f.label || ('field_' + i);
      var label = f.label || f.name || '';
      var type = f.type || 'text';
      var required = f.required ? ' required' : '';
      var placeholder = f.placeholder || '';

      html += '<div style="margin-bottom:14px;">';
      if (label) {
        html += '<label for="nucrm-' + escapeHtml(name) + '" style="display:block;margin-bottom:4px;font-size:13px;font-weight:500;color:#333;">' + escapeHtml(label) + (f.required ? ' <span style="color:#e53e3e;">*</span>' : '') + '</label>';
      }

      if (type === 'textarea') {
        html += '<textarea id="nucrm-' + escapeHtml(name) + '" name="' + escapeHtml(name) + '"' + required + ' placeholder="' + escapeHtml(placeholder) + '" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;min-height:80px;resize:vertical;"></textarea>';
      } else if (type === 'select' && f.options) {
        html += '<select id="nucrm-' + escapeHtml(name) + '" name="' + escapeHtml(name) + '"' + required + ' style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;background:#fff;">';
        html += '<option value="">' + escapeHtml(placeholder || 'Select...') + '</option>';
        for (var j = 0; j < f.options.length; j++) {
          var opt = typeof f.options[j] === 'string' ? f.options[j] : (f.options[j].value || f.options[j].label || '');
          var optLabel = typeof f.options[j] === 'string' ? f.options[j] : (f.options[j].label || f.options[j].value || '');
          html += '<option value="' + escapeHtml(opt) + '">' + escapeHtml(optLabel) + '</option>';
        }
        html += '</select>';
      } else if (type === 'checkbox') {
        html += '<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;">';
        html += '<input type="checkbox" id="nucrm-' + escapeHtml(name) + '" name="' + escapeHtml(name) + '"' + required + ' style="width:16px;height:16px;">';
        html += '<span>' + escapeHtml(label || placeholder) + '</span></label>';
      } else {
        html += '<input type="' + escapeHtml(type) + '" id="nucrm-' + escapeHtml(name) + '" name="' + escapeHtml(name) + '"' + required + ' placeholder="' + escapeHtml(placeholder) + '" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">';
      }
      html += '</div>';
    }

    html += '<div id="nucrm-form-error" style="display:none;color:#e53e3e;font-size:13px;margin-bottom:10px;padding:8px;background:#fef2f2;border-radius:6px;"></div>';
    html += '<button type="submit" id="nucrm-submit-btn" style="width:100%;padding:12px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;transition:background 0.15s;">' + escapeHtml(submitLabel) + '</button>';
    html += '</form>';

    html += '<div id="nucrm-form-success" style="display:none;text-align:center;padding:40px 20px;">';
    html += '<div style="width:48px;height:48px;border-radius:50%;background:#d1fae5;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;"><svg width="24" height="24" fill="none" stroke="#059669" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg></div>';
    html += '<p style="font-size:16px;font-weight:600;color:#059669;margin:0;">' + escapeHtml(successMsg) + '</p>';
    html += '</div>';

    container.innerHTML = html;

    var form = document.getElementById('nucrm-embed-form');
    var submitBtn = document.getElementById('nucrm-submit-btn');
    var errorDiv = document.getElementById('nucrm-form-error');

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      errorDiv.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';

      var data = {};
      var inputs = form.querySelectorAll('input, textarea, select');
      for (var k = 0; k < inputs.length; k++) {
        var el = inputs[k];
        if (el.type === 'checkbox') {
          data[el.name] = el.checked;
        } else if (el.name) {
          data[el.name] = el.value;
        }
      }

      fetch(BASE + '/api/forms/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_id: FORM_ID, data: data })
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.ok) {
          trackSubmit();
          form.style.display = 'none';
          document.getElementById('nucrm-form-success').style.display = 'block';
        } else {
          throw new Error(submitError(res));
        }
      })
      .catch(function(err) {
        errorDiv.textContent = err.message || 'Something went wrong. Please try again.';
        errorDiv.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = submitLabel;
      });
    });
  }

  // Attribute-safe: quote and ampersand are the two that let a value out of its own attribute,
  // and angle brackets keep it from opening a tag if it is ever emitted unquoted.
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  fetchForm()
    .then(function(def) {
      // Same failure in a 200: apiFetcher now throws on these shapes for the
      // dashboard panels (#3574); the embed widget fetches directly, so it
      // needs the same check here. Checked in this existing turn so a valid
      // form still renders in exactly one microtask, as before the fix.
      if (!def || typeof def !== 'object' || def.ok === false || def.success === false || def.error) {
        throw new Error(loadError(def, 200));
      }
      renderForm(def);
      trackView();
    })
    .catch(function(err) {
      // #3408: distinguish "could not ask" from an empty form. The message is
      // written with textContent, never innerHTML — it comes from an API body.
      container.innerHTML = '';
      var msg = document.createElement('p');
      msg.style.cssText = 'color:#e53e3e;font-family:system-ui,sans-serif;padding:20px;';
      msg.textContent = (err && err.message) || 'Failed to load form. Please try again later.';
      container.appendChild(msg);
      console.error('[NuCRM] Failed to load form:', err);
    });
})();
`;

/**
 * Serve the widget minified+mangled so the distributed artifact is not
 * human-readable (deters casual reuse of proprietary code on customer sites).
 * Result is cached module-level — terser runs once per process.
 */
type MinifyFn = (code: string, opts: unknown) => Promise<{ code: string }>;
let cachedMinified: string | null = null;

async function getWidgetJs(): Promise<string> {
  if (cachedMinified) return cachedMinified;
  try {
    const { minify } = (await import('terser')) as { minify: MinifyFn };
    const out = await minify(WIDGET_JS, {
      compress: true,
      mangle: true,
      format: { comments: false },
    });
    cachedMinified = BANNER_JS + '\n' + (out.code ?? WIDGET_JS);
  } catch {
    // Fallback: readable source with banner rather than a broken widget
    cachedMinified = BANNER_JS + '\n' + WIDGET_JS;
  }
  return cachedMinified;
}

const BANNER_JS =
  '/*! NuCRM embed widget | Property of abetworks.in | (c) 2026 abetworks.in | All Rights Reserved | Proprietary & confidential */';

export async function GET(_req: NextRequest) {
  const js = await getWidgetJs();
  return new NextResponse(js, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300, s-maxage=600',
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}
