#!/usr/bin/env node
// ============================================================================
// ui-studio mockup linter — Node CLI, zero deps.
//
// Mirrors the validation rules in engine.js (browser side) using regex parsing
// of view files and a sandboxed evaluation of config.js. Same rule codes; same
// severities. Deployed to https://ui-studio-cdn.pages.dev/mockup/lint.mjs by
// the same workflow that publishes engine.js.
//
//   node lint.mjs <slug-dir>     # run; emit JSON report to stdout
//   node lint.mjs --help         # usage
//
// Exit codes:
//   0  no errors (warnings allowed)
//   1  one or more errors
//   2  invocation problem (bad args, missing files, parse failure)
// ============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const VERSION = '0.15';

const issues = { ok: true, lintVersion: VERSION, errors: [], warnings: [] };

function push(severity, code, detail) {
  const bucket = severity === 'error' ? issues.errors : issues.warnings;
  bucket.push({ code, severity, detail });
  if (severity === 'error') issues.ok = false;
}

function fail(msg, exitCode = 2) {
  process.stderr.write(`[lint] ${msg}\n`);
  process.exit(exitCode);
}

// ----------------------------------------------------------------------------
// Argument parsing
// ----------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  process.stdout.write([
    'Usage: node lint.mjs <slug-dir>',
    '',
    'Validates a ui-studio mockup directory. Emits JSON to stdout.',
    'Exit 0 if clean (warnings allowed); exit 1 if errors; exit 2 on invocation failure.'
  ].join('\n') + '\n');
  process.exit(args.length === 0 ? 2 : 0);
}

const dir = args[0];
let stat;
try { stat = statSync(dir); } catch { fail(`Path not found: ${dir}`); }
if (!stat.isDirectory()) fail(`Not a directory: ${dir}`);

// ----------------------------------------------------------------------------
// File discovery + canonical-files-only check
// ----------------------------------------------------------------------------
const CANONICAL_NAMES = new Set(['index.html', 'config.js', 'theme.css', 'helpers.js']);
const allFiles = readdirSync(dir);
const viewFiles = allFiles.filter(f => f.endsWith('.view.js'));
const stray = allFiles.filter(f => {
  if (CANONICAL_NAMES.has(f)) return false;
  if (f.endsWith('.view.js')) return false;
  if (f.startsWith('.')) return false; // dotfiles
  return true;
});
if (stray.length) {
  push('warning', 'stray-files',
    `Non-canonical files in mockup directory: ${stray.join(', ')}. Only index.html, config.js, theme.css, helpers.js, *.view.js belong here.`);
}

const indexPath = join(dir, 'index.html');
const configPath = join(dir, 'config.js');
let indexHtml, configSrc;
try { indexHtml = readFileSync(indexPath, 'utf8'); } catch { fail(`Missing index.html in ${dir}`); }
try { configSrc = readFileSync(configPath, 'utf8'); } catch { fail(`Missing config.js in ${dir}`); }

// ----------------------------------------------------------------------------
// index.html checks (wiring-only rule)
// ----------------------------------------------------------------------------
if (/<style\b[^>]*>[\s\S]*?<\/style>/i.test(indexHtml)) {
  push('error', 'inline-style-in-index',
    `<style> block found in index.html — CSS belongs in theme.css, not the loader.`);
}
const fontLinks = indexHtml.match(/<link\b[^>]*href="https?:\/\/[^"]*fonts[^"]*"[^>]*>/gi) || [];
if (fontLinks.length) {
  push('error', 'font-link-in-index',
    `${fontLinks.length} font <link> tag(s) in index.html — use @import in theme.css instead.`);
}

// ----------------------------------------------------------------------------
// config.js eval in sandbox
// ----------------------------------------------------------------------------
const sandbox = { window: {}, document: {}, console };
sandbox.window.MOCKUP = undefined;
const ctx = createContext(sandbox);
try {
  runInContext(configSrc, ctx, { filename: configPath, timeout: 1000 });
} catch (e) {
  fail(`Failed to evaluate config.js: ${e.message}`);
}
const MOCKUP = sandbox.window.MOCKUP;
if (!MOCKUP || !MOCKUP.config) fail(`config.js did not assign window.MOCKUP.config`);
const config = MOCKUP.config;

// ----------------------------------------------------------------------------
// Config-shape rules (mirrors engine.js validateConfig)
// ----------------------------------------------------------------------------
const validViewIds = new Set((config.views || []).map(v => v.id));
const options = config.options || [];

// Engine normalizeConfig() runs in browser; here we approximate type inference
// to give accurate diagnostics on hand-written shorthand configs.
function inferType(opt) {
  if (opt.type) return opt.type;
  if (opt.property) return 'token';
  if (opt.component) return 'component';
  if (opt.target) {
    if (opt.target.property || opt.target.properties) return 'token';
    if (opt.target.component) return 'component';
  }
  return 'standard';
}
options.forEach((opt, i) => {
  if (opt.id == null) opt.id = i + 1; // mirror engine auto-assign
  opt.type = inferType(opt);
});

options.forEach(opt => {
  const count = opt.variants ? Object.keys(opt.variants).length : 0;
  // Some skill output uses "scale" shorthand which engine expands to 4-6 variants;
  // skip the count check when scale is present.
  if (count < 4 && !opt.scale) {
    push('warning', 'too-few-variants',
      `Option ${opt.id} "${opt.name}" has ${count} variant(s) — minimum 4 recommended.`);
  }
  if (opt.type === 'token') {
    if (!opt.values && !opt.scale) {
      push('error', 'token-missing-values',
        `Token option ${opt.id} "${opt.name}" missing "values" field.`);
    }
    const tgt = opt.target || {};
    if (!opt.property && !tgt.property && !tgt.properties) {
      push('error', 'token-missing-target',
        `Token option ${opt.id} "${opt.name}" missing target.property or target.properties.`);
    }
  }
  if (opt.type === 'component') {
    const tgt = opt.target || {};
    if (!opt.component && !tgt.component) {
      push('error', 'component-missing-target',
        `Component option ${opt.id} "${opt.name}" missing target.component.`);
    }
  }
  if (opt.tags && opt.tags.length > 1) {
    const extras = opt.tags.slice(1).join(', ');
    push('warning', 'multi-tag-ignored',
      `Option ${opt.id} "${opt.name}" lists ${opt.tags.length} tags but only "${opt.tags[0]}" is honored. Ignored: ${extras}. Duplicate the option per view if you need it in multiple panels.`);
  }
  if (opt.tags && opt.tags[0] && validViewIds.size && !validViewIds.has(opt.tags[0])) {
    push('error', 'unknown-view-tag',
      `Option ${opt.id} "${opt.name}" tagged "${opt.tags[0]}" but no view has that id. Valid view ids: ${[...validViewIds].join(', ')}.`);
  }
});

// ----------------------------------------------------------------------------
// View-file checks
// ----------------------------------------------------------------------------
// Combine all view-file source as one searchable blob, plus per-view content.
const viewSrcByName = new Map();
const allViewSrc = [];
viewFiles.forEach(f => {
  const src = readFileSync(join(dir, f), 'utf8');
  viewSrcByName.set(f, src);
  allViewSrc.push(src);
});
const combinedViewSrc = allViewSrc.join('\n');

// Inline <style> inside view template literals — SKILL.md forbids it.
viewFiles.forEach(f => {
  const src = viewSrcByName.get(f);
  if (/<style\b[^>]*>[\s\S]*?<\/style>/i.test(src)) {
    push('error', 'inline-style-in-view',
      `<style> block found inside ${f} — move CSS to theme.css.`);
  }
});

// Build an inventory of element ids and data-mt-component/variant pairs from
// the combined view source. Comments are stripped to avoid false positives.
function stripHtmlComments(s) { return s.replace(/<!--[\s\S]*?-->/g, ''); }
const cleanViewSrc = stripHtmlComments(combinedViewSrc);

const idMatches = [...cleanViewSrc.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const idCounts = new Map();
idMatches.forEach(id => idCounts.set(id, (idCounts.get(id) || 0) + 1));
const presentIds = new Set(idMatches);

const componentInstances = []; // { name, variant }
const COMPONENT_RE = /\bdata-mt-component="([^"]+)"\s+data-mt-variant="([^"]+)"/g;
for (const m of cleanViewSrc.matchAll(COMPONENT_RE)) {
  componentInstances.push({ name: m[1], variant: m[2] });
}
// Reverse-order also possible (variant before component)
const COMPONENT_RE_REV = /\bdata-mt-variant="([^"]+)"\s+data-mt-component="([^"]+)"/g;
for (const m of cleanViewSrc.matchAll(COMPONENT_RE_REV)) {
  componentInstances.push({ name: m[2], variant: m[1] });
}

// Standard variant-ID coverage.
options.forEach(opt => {
  if (opt.type !== 'standard') return;
  const el = opt.target && opt.target.el;
  if (!el || !opt.variants) return;
  if (!presentIds.has(el)) {
    push('error', 'missing-target-el',
      `Standard option ${opt.id} "${opt.name}" target.el "${el}" not found in any view file.`);
    return;
  }
  Object.keys(opt.variants).forEach(key => {
    const fullId = `${el}-${key}`;
    if (!presentIds.has(fullId)) {
      push('error', 'missing-variant-el',
        `Standard option ${opt.id} "${opt.name}" missing variant element id="${fullId}".`);
    }
  });
});

// Component variant coverage.
const byComponent = new Map();
componentInstances.forEach(i => {
  if (!byComponent.has(i.name)) byComponent.set(i.name, new Set());
  byComponent.get(i.name).add(i.variant);
});
options.forEach(opt => {
  if (opt.type !== 'component') return;
  const name = (opt.target && opt.target.component) || opt.component;
  if (!name || !opt.variants) return;
  const seen = byComponent.get(name) || new Set();
  Object.keys(opt.variants).forEach(key => {
    if (!seen.has(key)) {
      push('error', 'missing-component-variant',
        `Component option ${opt.id} "${opt.name}" has no [data-mt-component="${name}"][data-mt-variant="${key}"] instance.`);
    }
  });
});

// Unknown component instances (variant key not in config).
componentInstances.forEach(i => {
  const opt = options.find(o => {
    if (o.type !== 'component') return false;
    const n = (o.target && o.target.component) || o.component;
    return n === i.name;
  });
  if (!opt || !opt.variants) return;
  if (!Object.keys(opt.variants).includes(i.variant)) {
    push('warning', 'unknown-variant-key',
      `Found [data-mt-component="${i.name}"][data-mt-variant="${i.variant}"] but config defines no variant "${i.variant}" on option "${opt.name}".`);
  }
});

// Duplicate-id detection across view files.
const dupes = [...idCounts.entries()].filter(([, n]) => n > 1);
if (dupes.length) {
  const summary = dupes.slice(0, 10).map(([id, n]) => `"${id}" × ${n}`).join(', ');
  const more = dupes.length > 10 ? ` …and ${dupes.length - 10} more` : '';
  push('error', 'duplicate-id',
    `${dupes.length} duplicate element id(s) across view files: ${summary}${more}. Browsers resolve url(#id) and getElementById() to the first match only.`);
}

// Component-misuse heuristic: any variant block that contains structural
// elements (h1/h2/h3/table/form, or 4+ inputs) suggests a "full-UI per
// variant" antipattern when 2+ component options exist.
function isolateBlock(src, attrPair) {
  // Find the opening tag, then walk forward balancing div nesting.
  const idx = src.indexOf(attrPair);
  if (idx < 0) return null;
  // Back up to the start of its containing tag's "<".
  let openStart = idx;
  while (openStart > 0 && src[openStart] !== '<') openStart--;
  // Find the end of the opening tag.
  const openEnd = src.indexOf('>', idx);
  if (openEnd < 0) return null;
  // Walk forward, tracking <div> depth, until we close back to 0.
  let depth = 1;
  let i = openEnd + 1;
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
  tagRe.lastIndex = i;
  let m;
  while ((m = tagRe.exec(src))) {
    const tag = m[0];
    const name = m[1].toLowerCase();
    if (name !== 'div') continue;
    if (tag.startsWith('</')) {
      depth--;
      if (depth === 0) {
        return src.slice(openEnd + 1, m.index);
      }
    } else if (!tag.endsWith('/>')) {
      depth++;
    }
  }
  return null;
}

// Class words that almost always mark a page/layout-level wrapper. Element-level
// words like card/row/stack/grid/box/section are intentionally excluded. Mirrors
// _PAGE_WRAPPER_RE in engine.js — keep both lists in sync when adding signals.
const PAGE_WRAPPER_RE = /class="[^"]*\b(?:page|layout|cols|wrapper|shell|frame|viewport|canvas)[a-z0-9_-]*\b[^"]*"/i;

// Cheap-first short-circuit predicate. Mirrors _looksLikeFullUiEl in engine.js.
function looksLikeFullUiHtml(html) {
  if (PAGE_WRAPPER_RE.test(html)) return true;
  if (/<(?:aside|section|main|header|footer|nav)\b/i.test(html)) return true;
  const headers = (html.match(/<h[1-3]\b/gi) || []).length;
  if (headers >= 1) {
    if (/<(?:table|form)\b/i.test(html)) return true;
    if ((html.match(/<(?:input|select|textarea)\b/gi) || []).length >= 4) return true;
  }
  const divs = (html.match(/<div\b/gi) || []).length;
  if (divs >= 6 && html.replace(/\s+/g, '').length >= 300) return true;
  return false;
}

const componentOpts = options.filter(o => o.type === 'component');
if (componentOpts.length >= 2) {
  const componentNameSet = new Set(componentOpts.map(o => (o.target && o.target.component) || o.component).filter(Boolean));
  // Consolidate per component name — one issue listing affected variants,
  // not one issue per variant. Misuse is a per-option design problem.
  const fullUiByComponent = new Map();   // name → Set<variantKey>
  const nestedByComponent = new Map();   // name → { affected: Set<variantKey>, nested: Set<otherName> }

  componentInstances.forEach(inst => {
    const block = isolateBlock(cleanViewSrc, `data-mt-component="${inst.name}" data-mt-variant="${inst.variant}"`)
      || isolateBlock(cleanViewSrc, `data-mt-variant="${inst.variant}" data-mt-component="${inst.name}"`);
    if (!block) return;

    // Cheap nested check first; structural signals only run if not nested.
    const nestedNames = new Set(
      [...block.matchAll(/data-mt-component="([^"]+)"/g)].map(m => m[1])
    );
    const nested = [...nestedNames].filter(n => n !== inst.name && componentNameSet.has(n));
    if (nested.length > 0) {
      if (!nestedByComponent.has(inst.name)) {
        nestedByComponent.set(inst.name, { affected: new Set(), nested: new Set() });
      }
      const entry = nestedByComponent.get(inst.name);
      entry.affected.add(inst.variant);
      nested.forEach(n => entry.nested.add(n));
      return;
    }

    if (looksLikeFullUiHtml(block)) {
      if (!fullUiByComponent.has(inst.name)) fullUiByComponent.set(inst.name, new Set());
      fullUiByComponent.get(inst.name).add(inst.variant);
    }
  });

  for (const [name, { affected, nested }] of nestedByComponent) {
    push('error', 'component-misuse-nested',
      `Component "${name}" nests other component options (${[...nested].join(', ')}) inside ${affected.size} of its variants (${[...affected].join(', ')}) — variants will not compose. Use one component option for the structure and standard options for the inner pieces.`);
  }
  for (const [name, variants] of fullUiByComponent) {
    push('error', 'component-misuse-full-ui',
      `Component "${name}" appears to render a full UI in ${variants.size} variant(s) (${[...variants].join(', ')}). Multiple full-UI component options stack vertically and don't compose — each option's choice renders as an independent block. Variants should contain only the differing element; share chrome via baseHtml, or model the dimension as a token/standard option that swaps a class on a shared wrapper.`);
  }
}

// ----------------------------------------------------------------------------
// Output
// ----------------------------------------------------------------------------
process.stdout.write(JSON.stringify(issues, null, 2) + '\n');
process.exit(issues.errors.length > 0 ? 1 : 0);
