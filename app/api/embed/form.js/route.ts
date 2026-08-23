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

  function fetchForm() {
    return fetch(BASE + '/api/tenant/forms/public/' + FORM_ID)
      .then(function(r) { return r.json(); });
  }

  function trackView() {
    return fetch(BASE + '/api/tenant/forms/public/' + FORM_ID + '/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'view' })
    }).catch(function() {});
  }

  function trackSubmit() {
    return fetch(BASE + '/api/tenant/forms/public/' + FORM_ID + '/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'submit' })
    }).catch(function() {});
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
      var name = f.name || f.label || ('field_' + i);
      var label = f.label || f.name || '';
      var type = f.type || 'text';
      var required = f.required ? ' required' : '';
      var placeholder = f.placeholder || '';

      html += '<div style="margin-bottom:14px;">';
      if (label) {
        html += '<label for="nucrm-' + name + '" style="display:block;margin-bottom:4px;font-size:13px;font-weight:500;color:#333;">' + escapeHtml(label) + (f.required ? ' <span style="color:#e53e3e;">*</span>' : '') + '</label>';
      }

      if (type === 'textarea') {
        html += '<textarea id="nucrm-' + name + '" name="' + escapeHtml(name) + '"' + required + ' placeholder="' + escapeHtml(placeholder) + '" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;min-height:80px;resize:vertical;"></textarea>';
      } else if (type === 'select' && f.options) {
        html += '<select id="nucrm-' + name + '" name="' + escapeHtml(name) + '"' + required + ' style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;background:#fff;">';
        html += '<option value="">' + escapeHtml(placeholder || 'Select...') + '</option>';
        for (var j = 0; j < f.options.length; j++) {
          var opt = typeof f.options[j] === 'string' ? f.options[j] : (f.options[j].value || f.options[j].label || '');
          var optLabel = typeof f.options[j] === 'string' ? f.options[j] : (f.options[j].label || f.options[j].value || '');
          html += '<option value="' + escapeHtml(opt) + '">' + escapeHtml(optLabel) + '</option>';
        }
        html += '</select>';
      } else if (type === 'checkbox') {
        html += '<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;">';
        html += '<input type="checkbox" id="nucrm-' + name + '" name="' + escapeHtml(name) + '"' + required + ' style="width:16px;height:16px;">';
        html += '<span>' + escapeHtml(label || placeholder) + '</span></label>';
      } else {
        html += '<input type="' + escapeHtml(type) + '" id="nucrm-' + name + '" name="' + escapeHtml(name) + '"' + required + ' placeholder="' + escapeHtml(placeholder) + '" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">';
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
          throw new Error(res.error || 'Submission failed');
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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  fetchForm()
    .then(function(def) {
      renderForm(def);
      trackView();
    })
    .catch(function(err) {
      container.innerHTML = '<p style="color:#e53e3e;font-family:system-ui,sans-serif;padding:20px;">Failed to load form. Please try again later.</p>';
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
