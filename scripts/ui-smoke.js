// UI smoke tests, run in the browser on the dev server (paste into the console, or inject): they drive the pages like
// a user (clicks, typing) and check the project that results (localStorage) and what the page shows.
// window.__ui.run('structure' | 'simulation' | 'optimization' | 'all') → a report of passed / failed checks.
(() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const byText = (sel, text, root = document) => $$(sel, root).find((e) => e.textContent.trim().startsWith(text));
  const project = () => JSON.parse(localStorage.getItem('spr-companion:project'));
  const setValue = (el, v) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
  const click = (el) => el && el.click();
  async function until(fn, ms = 8000) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await wait(700);
    }
    return null;
  }
  async function loadExample(prefix) {
    window.confirm = () => true;
    const sel = $$('select').find((s) => s.title === 'Open an example project');
    const i = [...sel.options].findIndex((o) => o.text.startsWith(prefix));
    if (i < 1) throw new Error(`no example ${prefix}`);
    setValue(sel, String(i - 1));
    await wait(600);
  }
  async function go(page) {
    location.hash = `#/${page}`;
    await wait(500);
  }

  const results = [];
  const check = (name, ok, detail = '') => results.push({ ok: !!ok, name, detail: String(detail) });

  const groups = {
    async structure() {
      await loadExample('Kretschmann');
      await go('structure');
      const rows = $$('table.layers tbody tr');
      check('layers table: media rows and the film', rows.length === 3 && rows[0].textContent.includes('Incident') && rows[2].textContent.includes('Exit'), rows.length);
      // a thickness typed in the table
      const d = $('table.layers tbody tr:nth-child(2) input[aria-label="Thickness"]');
      setValue(d, '45');
      await wait(700);
      check('thickness edited in the table', project().structure.blocks[0].d === 45, project().structure.blocks[0].d);
      check('the Ag thickness parameter is tagged', $$('table.layers .tag-var').length >= 1, $$('table.layers .tag-var').map((t) => t.textContent).join(','));
      // Add parameter: the exit medium's material, two candidates, swept
      click(byText('button', '+ Add parameter'));
      await wait(700);
      check('the add parameter panel opens', !!$('.param-dialog'));
      click(byText('.param-dialog .pick', 'Exit medium'));
      await wait(700);
      click(byText('.param-dialog .pick', 'Material'));
      await wait(700);
      const cands = $$('.param-dialog .cand input');
      // (the current material is a candidate already: one more, not yet ticked)
      const target = $$('.param-dialog .cand').find((c) => !c.querySelector('input').checked && c.textContent.includes('BK7'));
      click(target?.querySelector('input'));
      await wait(700);
      click(byText('.param-dialog button', 'Add'));
      await wait(700);
      const p1 = project();
      const added = p1.params.find((x) => x.ref.kind === 'medium' && x.ref.which === 'exit' && x.ref.prop === 'mat');
      check('a material parameter added with its candidates', !!added && added.mats.length === 2 && p1.sweep.axes.includes(added.id), added ? `${added.mats.join(',')}; swept ${p1.sweep.axes.includes(added.id)}` : `none (${cands.length} candidates shown)`);
      // its switches in the table
      const row = $$('table.params tbody tr').find((r) => r.querySelector('input.name')?.value.startsWith('Exit medium'));
      const sws = row ? $$('input[role="switch"]', row) : [];
      click(sws[1]);
      await wait(700);
      click(sws[0]);
      await wait(700);
      const p2 = project();
      const a2 = p2.params.find((x) => x.id === added?.id);
      check('Sweep and Optimize switches of a parameter', !!a2 && a2.opt.on && !p2.sweep.axes.includes(a2.id), a2 ? `opt ${a2.opt.on}, swept ${p2.sweep.axes.includes(a2.id)}` : 'missing');
      // edit the values of the Ag thickness
      const agRow = $$('table.params tbody tr').find((r) => r.querySelector('input.name')?.value.includes('Ag'));
      click(agRow && $('button[aria-label="Edit the values"]', agRow));
      await wait(700);
      const from = $$('.param-dialog .field').find((f) => f.textContent.startsWith('From'))?.querySelector('input');
      setValue(from, '33');
      await wait(700);
      click(byText('.param-dialog button', 'Save'));
      await wait(700);
      const ag = project().params.find((x) => x.ref.kind === 'film' && x.ref.prop === 'd');
      check('edit a parameter: the sweep range saved', ag?.sweep.from === 33, ag?.sweep.from);
      // the value now, from the parameters table
      const now = agRow && $('td.num input', agRow);
      setValue(now, '52');
      await wait(700);
      check('the parameters table edits the structure', project().structure.blocks[0].d === 52, project().structure.blocks[0].d);
      // the light's arrow
      click($$('.stack-tools .segmented button')[1]);
      await wait(700);
      check('the light arrow (drawing only)', project().light === 'normal', project().light);
      // a DBR: periods, a cavity, closed / opened
      await loadExample('DBR microcavity');
      await go('structure');
      const n = $('input[aria-label="Periods N"]');
      setValue(n, '10');
      await wait(700);
      const b = project().structure.blocks[0];
      check('DBR: periods edited', b.periods === 10, b.periods);
      click(byText('button', '+ Cavity'));
      await wait(700);
      check('DBR: a cavity added', project().structure.blocks[0].cavities.length === 2, project().structure.blocks[0].cavities.length);
      click($('.link-row'));
      await wait(700);
      check('DBR: closed hides its rows', !$('input[aria-label="Periods N"]'));
      click($('.link-row'));
      await wait(700);
      check('the stack drawing', !!$('.stack-side svg') && $$('.stack-side svg rect').length > 3);
    },

    async simulation() {
      await loadExample('Kretschmann');
      await go('simulation');
      const card = () => $$('.sim .card')[0];
      // the interrogation: mode and polarization
      click(byText('.segmented button', 'Spectral', card()));
      await wait(700);
      check('interrogation: spectral mode', project().sim.mode === 'lambda', project().sim.mode);
      click(byText('.segmented button', 'Angular', card()));
      await wait(700);
      check('interrogation: back to angular', project().sim.mode === 'theta', project().sim.mode);
      click(byText('.segmented button', 'TE', card()));
      await wait(700);
      check('polarization TE', project().sim.pol === 's', project().sim.pol);
      click(byText('.segmented button', 'TM', card()));
      await wait(700);
      // the metrics' values
      const main = await until(() => {
        const t = $('.metric-item .metric-main')?.textContent ?? '';
        return /\d/.test(t) ? t : null;
      });
      check('the metrics are computed', !!main, main);
      // a plot: Y chips (add, left / right, remove), axis limits
      const plot = () => $('section.card[id^="plot-"]');
      const plotId = () => plot().id.slice(5);
      const spec = () => project().sweep.plots.find((p) => p.id === plotId());
      const ys0 = spec().left.length + (spec().right?.length ?? 0);
      click($('.chip.add', plot()));
      await wait(200);
      const item = $('.popover .menu-item', plot());
      const itemText = item?.textContent;
      click(item);
      await wait(700);
      const ys1 = spec().left.length + (spec().right?.length ?? 0);
      check('plot: a Y quantity added from the chip menu', ys1 === ys0 + 1, `${ys0} → ${ys1} (${itemText})`);
      const onLeft = () => $$('.chip:not(.add)', plot()).filter((c) => $('.chip-flag', c)?.textContent === 'left');
      const r0 = spec().right?.length ?? 0;
      click($('.chip-flag', onLeft().pop()));
      await wait(700);
      check('plot: a quantity moved to the right axis', (spec().right?.length ?? 0) === r0 + 1, JSON.stringify([spec().left, spec().right]));
      const shown = $$('.chip:not(.add)', plot()).length;
      click($('.chip-x', $$('.chip:not(.add)', plot()).pop()));
      await wait(700);
      check('plot: a quantity removed', $$('.chip:not(.add)', plot()).length === shown - 1 && spec().left.length + (spec().right?.length ?? 0) === ys1 - 1, JSON.stringify([spec().left, spec().right]));
      click($('button[aria-label="Axis limits"]', plot()));
      await wait(300);
      check('plot: the axis limits panel', !!$('.limits-panel', plot()));
      click($('button[aria-label="Axis limits"]', plot()));
      await wait(300);
      // a new metric: opened, its kind, its results
      const n0 = project().metrics.length;
      click(byText('button', 'Add metric'));
      await wait(700);
      const n1 = project().metrics.length;
      const item1 = () => $$('.metric-item').pop();
      check('a metric added and opened', n1 === n0 + 1 && !!$('.metric-body', item1()), `${n0} → ${n1}`);
      const label0 = project().metrics[n1 - 1].label;
      setValue($('select[aria-label="Kind"]', item1()), 'min');
      await wait(700);
      const mNew = project().metrics[n1 - 1];
      check('the kind changed, its name follows', mNew.kind === 'min' && mNew.label !== label0, `${mNew.kind}: ${label0} → ${mNew.label}`);
      const rows = await until(() => {
        const r = $$('table.results tbody tr', item1());
        return r.length >= 2 && /\d/.test(r[0].textContent) ? r : null;
      });
      check('the results table of the metric', !!rows, rows?.length);
      // the ROI drawn on the plot
      click(byText('button', 'Draw region', item1()));
      await wait(1000); // (the plot is scrolled into view, smoothly)
      check('drawing: the plot is marked', plot().classList.contains('drawing-target'));
      const area = $$('svg rect.nodrag', plot()).pop();
      const b = area.getBoundingClientRect();
      const fire = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, view: window }));
      const y = b.top + b.height / 2;
      fire(area, 'mousedown', b.left + b.width * 0.3, y);
      await wait(60);
      fire(area, 'mousemove', b.left + b.width * 0.6, y);
      await wait(60);
      fire(area, 'mouseup', b.left + b.width * 0.6, y);
      await wait(300);
      click(byText('button', 'Confirm', item1()));
      await wait(700);
      const roi = project().metrics[n1 - 1];
      check('the ROI drawn and confirmed', Number.isFinite(roi.lo) && Number.isFinite(roi.hi) && roi.lo < roi.hi && !plot().classList.contains('drawing-target'), `${roi.lo} – ${roi.hi}`);
      // the Field metric: its values (penetration, |E|², absorbed)
      setValue($('select[aria-label="Kind"]', item1()), 'penetration');
      await wait(700);
      const field = await until(() => {
        const t = $('table.results', item1())?.textContent ?? '';
        return t.includes('largest |E|²') && t.includes('absorbed') ? t : null;
      });
      check('the Field metric: |E|² and absorbed among its results', !!field);
      click($('button[aria-label="Remove the metric"]', item1()));
      await wait(700);
      check('the metric removed', project().metrics.length === n0, project().metrics.length);
      // a sweep: a parameter added, run, removed
      click($('.sub-head .popover-anchor > button', card()));
      await wait(200);
      const agItem = $$('.popover .menu-item', card()).find((b) => b.textContent.includes('Ag'));
      click(agItem);
      await wait(700);
      const opt = { value: project().sweep.axes[0] };
      check('sweep: a parameter added from the menu', !!agItem && project().sweep.axes.length === 1, project().sweep.axes.join(','));
      click(byText('button', 'Run', card()));
      const ran = await until(() => /points in/.test(card().textContent) && $('section.card[id^="plot-"]'), 20000);
      check('sweep: run, its plots shown', !!ran);
      click($('button[aria-label="Stop sweeping it"]', card()));
      await wait(700);
      check('sweep: the parameter removed', !project().sweep.axes.includes(opt.value));
      // a map λ × θ: a metric's region drawn as a polygon
      click(byText('.segmented button', 'Map', card()));
      await wait(700);
      check('interrogation: the map mode', project().sim.mode === 'map', project().sim.mode);
      // (the plot card comes back once the map is computed)
      const showMap = await until(() => plot() && byText('.segmented button', 'Map', plot()), 20000);
      click(showMap);
      const map = await until(() => plot() && $('svg rect.nodrag', plot()) && plot(), 15000);
      check('the map plot', !!map);
      click(byText('button', 'Add metric'));
      await wait(700);
      const drawBtn = await until(() => {
        const b = byText('button', 'Draw region', item1());
        return b && !b.disabled ? b : null;
      });
      click(drawBtn);
      // (the map's drawing surface: a crosshair once the map is shown)
      const m2 = await until(() => plot() && $$('svg rect.nodrag', plot()).find((r) => r.style.cursor === 'crosshair'), 15000);
      if (!m2) {
        const pl = plot();
        check('the map ready to draw on', false, `draw button ${drawBtn ? 'ok' : 'missing/disabled'}; plot ${pl ? pl.id : 'none'}; show ${pl ? $$('.segmented button', pl).map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')).join('/') : '-'}; surfaces ${pl ? $$('svg rect.nodrag', pl).length : 0}; hint ${!!$('.drawing-hint')}`);
        return;
      }
      const c = m2.getBoundingClientRect();
      for (const [fx, fy] of [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]) {
        fire(m2, 'click', c.left + c.width * fx, c.top + c.height * fy);
        await wait(120);
      }
      click(byText('button', 'Confirm', item1()));
      await wait(700);
      const pm = project().metrics.at(-1);
      check('a region drawn on the map (4 corners)', pm.follow?.poly?.length === 4, JSON.stringify(pm.follow));
      click($('button[aria-label="Remove the metric"]', item1()));
      await wait(700);
      click(byText('.segmented button', 'Angular', card()));
      await wait(700);
    },

    async optimization() {
      await loadExample('Kretschmann');
      await go('optimization');
      const vary = () => $('.vary-card');
      const goals = () => $('.goals-card');
      const rowOf = (name) => $$('table.vary tbody tr', vary()).find((r) => r.textContent.startsWith(name));
      check('variables: the parameters listed, λ and θ not', !!rowOf('Ag thickness') && !rowOf('λ') && !rowOf('θ'), $$('table.vary tbody tr', vary()).map((r) => r.textContent.slice(0, 20)).join(' | '));
      // optimize switch, bounds
      click($('input[role="switch"]', rowOf('Ag thickness')));
      await wait(700);
      check('variables: Optimize switched off', project().params.find((x) => x.name === 'Ag thickness')?.opt.on === false);
      click($('input[role="switch"]', rowOf('Ag thickness')));
      await wait(700);
      setValue($('input[aria-label="Ag thickness min"]', vary()), '35');
      await wait(700);
      const ag = project().params.find((x) => x.name === 'Ag thickness');
      check('vary: the bounds edited', ag?.opt.min === 35, ag?.opt.min);
      // goals from every result of the metrics
      const n0 = project().opt.objectives.length;
      click(byText('button', 'Objective', goals()));
      await wait(300);
      const groupsShown = $$('.popover .menu-group', goals()).length;
      const sItem = $$('.popover .menu-item', goals()).find((b) => b.textContent.startsWith('sensitivity S'));
      click(sItem);
      await wait(700);
      const o1 = project().opt.objectives;
      check('an objective added from the results menu', groupsShown >= 2 && o1.length === n0 + 1 && o1.at(-1).key === 'S' && o1.at(-1).goal === 'max', `${groupsShown} groups; ${o1.at(-1)?.key} ${o1.at(-1)?.goal}`);
      click(byText('button', 'Constraint', goals()));
      await wait(300);
      const wItem = await until(() => {
        const g = $$('.popover .menu-group', goals()).find((x) => x.textContent.startsWith('Resonance'));
        return g && $$('.menu-item', g).find((b) => b.textContent.startsWith('FWHM') && /\d/.test(b.textContent));
      });
      click(wItem);
      await wait(700);
      const c1 = project().opt.objectives.at(-1);
      check('a constraint added (≤ its value now)', c1.role === 'constraint' && c1.key === 'width' && c1.goal === 'le' && c1.target > 0, `${c1.role} ${c1.key} ${c1.goal} ${c1.target}`);
      check('the constraint is numbered C1', $$('.c-tag', goals()).map((t) => t.textContent).join(',') === 'C1');
      const cInput = $$('.goal-item', goals()).pop().querySelector('input[type="text"]');
      setValue(cInput, String(+(c1.target * 1.5).toPrecision(3)));
      await wait(700);
      check('the constraint limit edited', project().opt.objectives.at(-1).target === +(c1.target * 1.5).toPrecision(3), project().opt.objectives.at(-1).target);
      // the goal of an objective, its settings (role)
      const sRow = () => $$('.goal-item', goals()).find((r) => r.textContent.includes('sensitivity S'));
      click(byText('.segmented button', 'Min', sRow()));
      await wait(700);
      check('objective: Min', project().opt.objectives.find((x) => x.key === 'S').goal === 'min');
      click(byText('.segmented button', 'Max', sRow()));
      await wait(700);
      click($('button[aria-label="Weight, scale, role"]', sRow()));
      await wait(300);
      click(byText('.goal-more .segmented button', 'Constraint', sRow()));
      await wait(700);
      const asC = project().opt.objectives.find((x) => x.key === 'S');
      check('objective → constraint (max → ≥ its value now), its settings stay open', asC.role === 'constraint' && asC.goal === 'ge' && asC.target > 0 && !!$('.goal-more', sRow()), `${asC.role} ${asC.goal} ${asC.target}`);
      click(byText('.goal-more .segmented button', 'Objective', sRow()));
      await wait(700);
      check('constraint → objective', project().opt.objectives.find((x) => x.key === 'S').role === 'objective');
      // NSGA-II, a short run
      const algo = $$('.field', document).find((f) => f.textContent.startsWith('Algorithm'))?.querySelector('select');
      setValue(algo, 'nsga2');
      await wait(700);
      const num = (label) => $$('.field').find((f) => f.querySelector('.field-label')?.textContent === label)?.querySelector('input');
      setValue(num('Iterations'), '4');
      setValue(num('Population'), '8');
      await wait(700);
      check('algorithm settings', project().opt.algorithm === 'nsga2' && project().opt.iterations === 4 && project().opt.population === 8);
      click(byText('button', 'Start'));
      const done = await until(() => ['done', 'stopped', 'error'].includes($('.status')?.textContent) && $('.status').textContent, 90000);
      check('the run ends', done === 'done', done ?? 'timeout');
      const heads = $$('table.sortable th').map((t) => t.textContent.replace(/[⇅↑↓]/g, '').trim());
      check('Pareto table: a C1 column', heads.includes('C1'), heads.join(' | '));
      check('Pareto table: each quantity once', heads.filter((h) => h.includes('FWHM')).length === 1, heads.join(' | '));
      const marks = $$('table.sortable tbody .ok-mark, table.sortable tbody .bad-mark').length;
      check('Pareto table: ✓ / ✗ marks', marks > 0, marks);
      check('the legend of the constraints', ($('.cons-legend')?.textContent ?? '').includes('C1:'));
      click(byText('table.sortable th', 'C1'));
      await wait(200);
      check('sort by a column', !!$('table.sortable th.sorted'));
      // (back to the original order: descending, then none)
      click(byText('table.sortable th', 'C1'));
      await wait(150);
      click(byText('table.sortable th', 'C1'));
      await wait(150);
      check('CSV buttons (table, front, convergence)', !!byText('.sort-tools button', 'CSV') && $$('button').filter((b) => b.textContent === 'CSV').length >= 3);
      // the metrics over the response of the run (Overlays)
      const respCard = await until(() => $$('section.card').find((s) => s.querySelector('h2')?.textContent.startsWith('Response: start')), 10000);
      const rb = respCard && $('.overlay-btn', respCard);
      click(rb);
      await wait(300);
      const rRows = respCard ? $$('.overlay-row', respCard) : [];
      check('the run: overlays of the metrics on its response', rRows.length >= 2 && $$('svg circle, svg line', respCard).length > 0, `${rRows.length} metrics`);
      click(rRows[0] && $('input[role="switch"]', rRows[0]));
      await wait(700);
      check('the run: a metric hidden there', (project().opt.respHidden ?? []).length === 1, JSON.stringify(project().opt.respHidden));
      click(rRows[0] && $('input[role="switch"]', rRows[0]));
      await wait(500);
      click(rb);
      await wait(200);
      // solutions checked: their curves, their results
      const pareto = $('.pareto-card');
      click($$('table.sortable tbody tr', pareto)[0]);
      await wait(300);
      click($$('table.sortable tbody tr', pareto)[1]);
      await wait(300);
      const sols = await until(() => $$('table.solutions-table tbody tr').length === 3 && $$('table.solutions-table tbody tr'), 15000);
      check('two solutions checked: their rows (and the start) in the results', !!sols && /solution #/.test(sols[1].textContent), sols && sols.map((r) => r.textContent.slice(0, 16)).join(' | '));
      const respCard2 = $$('section.card').find((s) => s.querySelector('h2')?.textContent.startsWith('Response: start'));
      check('the response: the start and both solutions in the legend', $$('.legend > span', respCard2).length === 3 && respCard2.querySelector('h2').textContent.includes('checked solutions'), $('.legend', respCard2)?.textContent);
      // the results: a column added from the chips
      const cols0 = $$('table.solutions-table thead th').length;
      click($('.results-head .chip.add'));
      await wait(200);
      click($('.results-head .popover .menu-item'));
      await wait(400);
      check('the results: a column added', $$('table.solutions-table thead th').length === cols0 + 1, `${cols0} → ${$$('table.solutions-table thead th').length}`);
      // a colour of a solution
      const colIn = $('table.solutions-table input[type="color"]');
      setValue(colIn, '#ff00aa');
      await wait(300);
      check('a solution coloured', $('table.solutions-table .color-dot').style.background.replace(/\s/g, '').includes('255,0,170'), $('table.solutions-table .color-dot').style.background);
      // ranking: max of the first quantity, min of the second; weighted sum; a filter; the top checked
      click(byText('.rank-head button', 'Criterion'));
      await wait(200);
      click($$('.rank-head .popover .menu-item')[0]);
      await wait(300);
      click(byText('.rank-head button', 'Criterion'));
      await wait(200);
      click($$('.rank-head .popover .menu-item')[1]);
      await wait(300);
      click(byText('.rank-row .segmented button', 'Min', $$('.rank-row')[1]));
      await wait(300);
      const headsR = $$('table.sortable th', pareto).map((t) => t.textContent.replace(/[⇅↑↓]/g, '').trim());
      const rank1 = $$('table.sortable tbody tr', pareto)[0]?.children[2]?.textContent;
      check('ranked: Rank and Score columns, the best first', headsR.includes('Rank') && headsR.includes('Score') && rank1 === '1', `${headsR.slice(0, 4).join(' | ')} · first rank ${rank1}`);
      click(byText('.rank-head .segmented button', 'Weighted sum'));
      await wait(300);
      check('the weighted sum', byText('.rank-head .segmented button', 'Weighted sum').classList.contains('on'));
      click(byText('.rank-head button', 'Filter'));
      await wait(200);
      click($$('.rank-head .popover .menu-item')[0]);
      await wait(400);
      const keptN = $$('table.sortable tbody tr', pareto).length;
      check('a filter keeps part of the front', keptN > 0 && keptN <= project().opt.population, keptN);
      click(byText('.rank-row button', 'Check the top'));
      await wait(500);
      const checkedN = $$('table.sortable tbody input[type="checkbox"]:checked', pareto).length;
      check('the top solutions checked at once', checkedN === Math.min(3, keptN), checkedN);
      // views of the front: a second one, then away
      click(byText('.front-views .add-row button', 'Add a view'));
      await wait(500);
      check('a second view of the front', $$('.front-view').length === 2);
      // a click on a point of a view checks it
      const fv0 = $$('.front-view')[1];
      const before = $$('table.sortable tbody input[type="checkbox"]:checked', pareto).length;
      // (a point within the filters: the front's own series, not the filtered-out one)
      const dot = $$('svg g', fv0).find((g) => g.getAttribute('fill') === 'var(--muted)')?.querySelector('circle');
      const db = dot.getBoundingClientRect();
      const area = $$('svg rect.nodrag', fv0).pop();
      const at = { bubbles: true, clientX: db.left + db.width / 2, clientY: db.top + db.height / 2, view: window };
      area.dispatchEvent(new MouseEvent('mousedown', at));
      await wait(40);
      area.dispatchEvent(new MouseEvent('mouseup', at));
      await wait(400);
      const after = $$('table.sortable tbody input[type="checkbox"]:checked', pareto).length;
      check('a point clicked on a view: checked (or unchecked)', Math.abs(after - before) === 1, `${before} → ${after}`);
      click($$('.front-view')[1].querySelector('button[aria-label="Take this view away"]'));
      await wait(300);
      check('the view taken away', $$('.front-view').length === 1);
      click(byText('button', 'Apply to the project'));
      await wait(700);
      const d = project().structure.blocks.find((b) => b.id === 'ag' || b.kind === 'film')?.d;
      check('apply: the thickness within the bounds', d >= 35 && d <= 70, d);
      const log = project().optLog ?? [];
      check('apply: recorded (algorithm, Ag before → after, the goals)', log.length === 1 && log[0].algorithm.startsWith('NSGA') && log[0].vars[0].from === 50 && Math.abs(log[0].vars[0].to - d) < 1e-3 && log[0].goals.length >= 3, log[0] && `${log[0].algorithm}: ${log[0].vars.map((v) => `${v.name} ${v.from} → ${v.to}`).join(', ')}`);
      await go('compare');
      const cc = await until(() => $('.config-card'), 5000);
      check('compare: the optimization listed, its layer tagged', !!cc && cc.textContent.includes('NSGA') && $$('table.compact tr', cc).some((r) => r.textContent.includes('metal') && r.textContent.includes('optimized')), cc && cc.textContent.slice(0, 60));
      click(cc && $$('.opt-record-head button', cc)[0]);
      await wait(700);
      check('compare: a record deleted', (project().optLog ?? []).length === 0);
      await go('optimization');
      click(byText('button', 'Clear the result'));
      await wait(300);
    },
  };

  groups.extras = async function extras() {
    await loadExample('Kretschmann');
    await go('simulation');
    const card = () => $$('.sim .card')[0];
    // one scroll area: the window itself does not scroll
    check('one scroll area (the window does not scroll)', document.documentElement.scrollHeight <= innerHeight + 1, `${document.documentElement.scrollHeight} / ${innerHeight}`);
    // the plot's data: no "values of the metrics" without an axis to plot them along
    const ds = await until(() => $('select[aria-label="Data of the plot"]'));
    check('plot data: the response and the field (no metrics without a sweep; comparisons on the Compare page)', !!ds && [...ds.options].map((o) => o.value).join() === 'response,field', ds && [...ds.options].map((o) => o.text).join(' | '));
    // the overlays of a plot: one part, one metric off (and back)
    const p0 = $('section.card[id^="plot-"]');
    await until(() => / of /.test($('.overlay-btn', p0)?.textContent ?? ''), 10000); // (the metrics computed)
    click($('.overlay-btn', p0));
    await wait(300);
    const svgCount = () => $$('svg *', p0).length;
    const ov0 = svgCount();
    const rows0 = $$('.overlay-row', p0);
    click($$('.part', rows0[0]).find((b) => b.textContent === 'Width'));
    await wait(700);
    const ov1 = svgCount();
    click($('input[role="switch"]', rows0[1]));
    await wait(700);
    const sp = project().sweep.plots[0];
    check('overlays: a part and a metric hidden', (sp.hidden ?? []).join() === 'res:width,sens' && ov1 < ov0 && svgCount() < ov1 && $('.overlay-btn', p0).textContent.startsWith('3 of 4'), `${(sp.hidden ?? []).join()} · ${ov0} → ${ov1} → ${svgCount()}`);
    click($$('.part', $$('.overlay-row', p0)[0]).find((b) => b.textContent === 'Width'));
    await wait(700);
    click($('input[role="switch"]', $$('.overlay-row', p0)[1]));
    await wait(700);
    check('overlays: shown again', (project().sweep.plots[0].hidden ?? []).length === 0 && svgCount() === ov0, `${JSON.stringify(project().sweep.plots[0].hidden)} · ${svgCount()} / ${ov0}`);
    click($('.overlay-btn', p0));
    await wait(200);
    // a metric's colour
    const col = $('.metric-item input[type="color"]');
    setValue(col, '#123456');
    await wait(700);
    check('a metric colour chosen', project().metrics[0].color === '#123456', project().metrics[0].color);
    // computed quantities: a preset, then a name inserted from the buttons
    const det = $$('section.card').find((d) => d.querySelector('h2')?.textContent === 'Custom values');
    check('Custom values: a card like Metrics (no collapsing), its button in the header', !!det && !$('details', det) && !!$('.card-head .popover-anchor > button.primary', det), det && $('.card-head', det).textContent);
    await wait(200);
    const n0 = project().derived.length;
    click($('.card-head .popover-anchor > button', det));
    await wait(200);
    click($$('.popover .menu-item', det).find((b) => b.textContent.startsWith('Loss')));
    await until(() => project().derived.length === n0 + 1, 3000);
    const d1 = project().derived.at(-1);
    check('a computed quantity from the presets', project().derived.length === n0 + 1 && d1.expr === '1 - R - T', d1 && `${d1.name} = ${d1.expr}`);
    const fx = $$('input[aria-label="Formula"]', det).at(-1);
    fx.focus();
    fx.setSelectionRange(fx.value.length, fx.value.length);
    fx.dispatchEvent(new Event('select', { bubbles: true }));
    await wait(100);
    click($$('.token', det).find((b) => b.textContent === 'A'));
    await wait(700);
    check('a name inserted into the formula', project().derived.at(-1).expr === '1 - R - T - A' || /1 - R - T\s*A$/.test(project().derived.at(-1).expr), project().derived.at(-1).expr);
    click($$('button[aria-label="Remove"]', det).at(-1));
    await wait(700);
    // a field plot (the field inside the stack, at the resonance)
    click(byText('.add-row button', 'Add a plot'));
    await wait(700);
    const plots = () => $$('section.card[id^="plot-"]');
    const last = () => plots().at(-1);
    setValue($('select[aria-label="Data of the plot"]', last()), 'field');
    await wait(700);
    const fp = project().sweep.plots.at(-1);
    check('a plot of the field', fp.source === 'field', fp.source);
    const at = $$('.field', last()).find((f) => f.textContent.startsWith('At'))?.querySelector('select');
    setValue(at, 'res');
    const drawn = await until(() => last().querySelector('svg path') && last().querySelector('.field-info')?.textContent.includes('1/e'));
    check('the field plot drawn (|E|², the 1/e depth)', !!drawn, last().querySelector('.field-info')?.textContent);
    click($('button[aria-label="Remove this plot"]', last()));
    await wait(700);
    // Run simulation with automatic updates off
    const autoSw = $$('.switch', card()).find((s) => s.textContent.includes('Update automatically'))?.querySelector('input');
    click(autoSw);
    await wait(700);
    check('automatic updates off', project().sim.auto === false);
    setValue($$('.field', card()).find((f) => f.textContent.startsWith('Wavelength'))?.querySelector('input'), '640');
    const stale = await until(() => card().textContent.includes('The setup changed'));
    check('without automatic updates: a change waits for Run', !!stale);
    click(byText('button', 'Run simulation', card()));
    const fresh = await until(() => !card().textContent.includes('The setup changed'));
    check('Run simulation computes it', !!fresh);
    click(autoSw);
    await wait(700);
    // cards moved (the grip, with the keyboard)
    const order = () => $$('.sim > .board-col > .island').map((i) => (i.querySelector('h2')?.textContent ?? i.textContent).slice(0, 14));
    const before = order();
    const grip = $$('.sim .island .grip').find((g) => g.getAttribute('aria-label').includes('Metrics'));
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await wait(700);
    const after = order();
    const stored = JSON.parse(localStorage.getItem('spr-companion:board:simulation') ?? '{}');
    check('a card moved up (and remembered)', after.indexOf('Metrics') === before.indexOf('Metrics') - 1 && (stored.main ?? []).indexOf('metrics') >= 0, `${before.join(' / ')} → ${after.join(' / ')}`);
    $$('.sim .island .grip').find((g) => g.getAttribute('aria-label').includes('Metrics')).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await wait(700);
    check('and back', order().join() === before.join(), order().join(' / '));
    // the notes, in the sidebar
    click(byText('.sidebar button', 'Notes'));
    await wait(300);
    const ta = $('.sidebar textarea');
    check('the notes open in the sidebar', !!ta);
    const notes0 = project().notes;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, `${notes0}\nx`);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(700);
    check('the notes edited there', project().notes === `${notes0}\nx`);
    click(byText('.sidebar button', 'Notes'));
    await wait(200);
    click(byText('.sidebar button', 'Materials'));
    await wait(500);
    check('Materials from the sidebar', location.hash === '#/materials');
  };
  groups.configs = async function configs() {
    await loadExample('Compare');
    await go('compare');
    const cfgBtn = () => $('.config-btn');
    const openCfg = async () => {
      if (!$('.config-pick')) click(cfgBtn());
      await wait(300);
    };
    check('two configurations, the first current', /1\/2/.test(cfgBtn()?.textContent ?? '') && project().configs.length === 2, cfgBtn()?.textContent);
    // the compare plot: both curves drawn, with the metrics of each
    const card = await until(() => $('.compare-card') && $$('.compare-card .legend > span').length === 2 && $('.compare-card'), 20000);
    check('compare plot: a curve of each configuration', !!card, card && $('.legend', card).textContent);
    const curves = () => project().compare.plots[0].curves;
    click(byText('button', 'Add curve', card));
    await wait(700);
    check('compare: a curve added', curves().length === 3, curves().length);
    const row = () => $$('table.compare-curves tbody tr', card).at(-1);
    setValue($('select[aria-label="Configuration"]', row()), 'spr');
    await wait(700);
    setValue($('select[aria-label="Y"]', row()), 'T');
    await wait(700);
    click(byText('.segmented button', 'Right', row()));
    await wait(700);
    const c3 = curves()[2];
    check('compare: its configuration, Y and axis chosen', c3.config === 'spr' && c3.y === 'T' && c3.side === 'right', JSON.stringify({ config: c3.config, y: c3.y, side: c3.side }));
    const drawn = await until(() => $$('.legend > span', card).length === 3 && $('.legend', card).textContent.includes('SPR at 68° · T'), 15000);
    check('compare: the new curve drawn (right axis)', !!drawn, $('.legend', card).textContent);
    click($('button[aria-label="Remove the curve"]', row()));
    await wait(700);
    check('compare: the curve removed', curves().length === 2);
    // the curve's panel: its configuration and its metrics on it
    click($('.curve-metrics-btn', card));
    await wait(400);
    const panel = $('.curve-panel', card);
    check('compare: a curve opens on its configuration and metrics', !!panel && panel.textContent.includes('Tamm mode') && !!$('.overlay-btn', panel), panel && panel.textContent.slice(0, 80));
    // switching configuration: its own structure, interrogation, plots
    await go('simulation');
    await openCfg();
    click($$('.config-item').find((b) => b.textContent.startsWith('SPR at 68°')));
    await wait(1200);
    const p2 = project();
    check('switched to the SPR configuration', p2.configId === 'spr' && p2.sim.mode === 'lambda' && p2.sim.theta === 68 && p2.structure.exit.id === 'Water' && /2\/2/.test(cfgBtn().textContent) && $('.structure-line').textContent.startsWith('SPR at 68°'), `${p2.configId} θ ${p2.sim.theta} exit ${p2.structure.exit.id}`);
    check('its own plots and metrics', !$('.compare-card') && p2.metrics.some((m) => m.ref === 'res') && !p2.metrics.some((m) => m.ref === 'tamm'), p2.metrics.map((m) => m.ref).join(','));
    // a change there stays there
    setValue($$('.field', $$('.sim .card')[0]).find((f) => f.textContent.startsWith('Angle'))?.querySelector('input'), '69');
    await wait(700);
    await openCfg();
    click($$('.config-item').find((b) => b.textContent.startsWith('Tamm')));
    await wait(1200);
    const p3 = project();
    const sprStored = p3.configs.find((c) => c.id === 'spr');
    check('back to the Tamm configuration, the SPR change kept', p3.configId === 'tamm' && p3.sim.theta === 0 && sprStored.sim.theta === 69, `Tamm θ ${p3.sim.theta}, SPR θ ${sprStored.sim.theta}`);
    // duplicate, rename, remove
    await openCfg();
    click(byText('.config-actions button', 'Duplicate'));
    await wait(800);
    const nameIn = $('.config-rename input');
    setValue(nameIn, 'Tamm copy');
    await wait(700);
    check('a configuration duplicated and renamed', project().configs.length === 3 && project().configs.find((c) => c.id === project().configId).name === 'Tamm copy');
    click(byText('.config-actions button', 'Remove'));
    await wait(900);
    check('the duplicate removed', project().configs.length === 2 && project().configId === 'tamm', `${project().configs.length} · ${project().configId}`);
    if ($('.config-pick')) click(cfgBtn());
  };
  groups.home = async function home() {
    await loadExample('Bragg mirror');
    await go('home');
    const stepOn = () => $('.tour-step.on .tour-title')?.textContent;
    click($$('.tour-step')[0]);
    await wait(200);
    check('home: the tour starts at Materials', stepOn() === 'Materials', stepOn());
    click(byText('.tour-nav button', 'Next'));
    await wait(200);
    check('home: Next → Structure (remembered)', stepOn() === 'Structure' && localStorage.getItem('spr-companion:tour-step') === '1', stepOn());
    $('.tour-step.on').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await wait(200);
    check('home: the arrow keys move between the steps', stepOn() === 'Parameters', stepOn());
    click(byText('.tour-nav button', 'Back'));
    await wait(200);
    check('home: no "Your project" panel (a tour from the start)', !$('.project-state') && !$('.tour-step.done ~ .tour-step.done.on'));
    click(byText('.tour-nav button', 'Open Structure'));
    await wait(600);
    check('home: a step opens its page', location.hash === '#/structure', location.hash);
    await go('home');
    window.confirm = () => true;
    const card = $$('.example-card').find((c) => c.querySelector('h3').textContent.startsWith('DBR microcavity'));
    click(card && $('button', card));
    await wait(900);
    check('home: an example opened from its card', project().name.length > 0 && location.hash === '#/simulation' && project().structure.blocks.some((b) => b.kind === 'dbr' && b.cavities.length > 0), `${location.hash} · ${project().name}`);
    // an example added as a configuration of the open project (the project stays)
    await go('home');
    const name0 = project().name;
    const k = $$('.example-card').find((c) => c.querySelector('h3').textContent.startsWith('Kretschmann'));
    click(k && byText('button', 'Add as configuration', k));
    await wait(900);
    const p1 = project();
    check('home: an example added as a configuration', p1.name === name0 && p1.configs.length === 2 && p1.configs.find((c) => c.id === p1.configId).name === 'Kretschmann SPR sensor' && p1.structure.exit.id === 'Water' && !!$('.ok-msg'), `${p1.name} · ${p1.configs.map((c) => c.name).join(', ')}`);
    // and from the configurations menu
    click($('.config-btn'));
    await wait(300);
    click(byText('.config-actions button', 'From an example'));
    await wait(300);
    click($$('.config-examples .menu-item').find((b) => b.textContent.startsWith('Bragg mirror')));
    await wait(900);
    const p2 = project();
    check('the configurations menu: an example added as a configuration', p2.configs.length === 3 && p2.configs.find((c) => c.id === p2.configId).name === 'Bragg mirror' && p2.name === name0, p2.configs.map((c) => c.name).join(', '));
    if ($('.config-pick')) click($('.config-btn'));
    await wait(200);
  };
  groups.compare = async function compare() {
    await loadExample('Compare');
    await go('compare');
    const cards = await until(() => $$('.config-card').length === 2 && $$('.config-card svg').length >= 2 && $$('.config-card'), 15000);
    check('compare page: a card per configuration with its stack', !!cards, $$('.config-card').length);
    // (no metrics on this page: neither in the cards nor a table)
    check('compare page: no metrics (cards, table)', !$('table.metrics-by-config') && !$$('.config-card .pick-title').some((x) => x.textContent.startsWith('Metrics')), $$('.config-card .pick-title').map((x) => x.textContent).join(', '));
    // a new compare plot: a curve of each configuration
    const n0 = project().compare.plots.length;
    click(byText('.add-row button', 'Add a compare plot'));
    await wait(700);
    const np = project().compare.plots.at(-1);
    check('a compare plot added (a curve per configuration)', project().compare.plots.length === n0 + 1 && np.curves.length === 2 && np.curves.map((c) => c.config).join() === 'tamm,spr', np && np.curves.map((c) => c.config).join());
    click($$('.compare-card').at(-1).querySelector('button[aria-label="Remove this plot"]'));
    await wait(700);
    check('and taken away again', project().compare.plots.length === n0);
    // side by side: the field inside each stack, and a response
    const addView = async (prefix) => {
      click(byText('.views-card .card-head button', 'Add a view'));
      await wait(250);
      click($$('.views-card .popover .menu-item').find((b) => b.textContent.startsWith(prefix)));
      await wait(700);
    };
    await addView('Tamm plasmon (0°) · the field');
    await addView('SPR at 68° · the field');
    await addView('SPR at 68° · the response');
    const fields = await until(() => {
      const vs = $$('.compare-views > .card');
      return vs.length === 3 && vs.slice(0, 2).every((v) => (v.querySelector('.field-info')?.textContent ?? '').includes('1/e') && v.querySelector('svg path')) && vs;
    }, 20000);
    check('side by side: the field in each stack (Tamm, SPR) and a response', !!fields && project().compare.views.map((v) => `${v.config}:${v.source}`).join() === 'tamm:field,spr:field,spr:response', project().compare.views.map((v) => `${v.config}:${v.source}`).join());
    const atSpr = $$('.field', $$('.compare-views > .card')[1]).find((f) => f.textContent.startsWith('At'))?.querySelector('select');
    check("a field view: at its own configuration's metrics", atSpr?.value === 'res' && [...atSpr.options].some((o) => o.text.includes('Resonance')) && ![...atSpr.options].some((o) => o.text.includes('Tamm mode')), atSpr && [...atSpr.options].map((o) => o.text).join(' | '));
    // a view switched to another configuration
    setValue($('select.view-config', $$('.compare-views > .card')[2]), 'tamm');
    await wait(700);
    check('a view switched to another configuration', project().compare.views[2].config === 'tamm', project().compare.views[2].config);
    // Edit: that configuration on the Structure page
    const spr = $$('.config-card').find((c) => c.querySelector('h3').textContent.startsWith('SPR'));
    click(byText('button', 'Edit', spr));
    await wait(900);
    check('Edit: the configuration opened on the Structure page', location.hash === '#/structure' && project().configId === 'spr', `${location.hash} ${project().configId}`);
  };

  // metrics that depend on a swept parameter: a view of them against it
  groups.compareSweep = async function compareSweep() {
    await loadExample('Kretschmann');
    await go('simulation');
    const card = () => $$('.sim .card')[0];
    click($('.sub-head .popover-anchor > button', card()));
    await wait(200);
    click($$('.popover .menu-item', card()).find((b) => b.textContent.includes('Ag')));
    await wait(700);
    await go('compare');
    click(byText('.views-card .card-head button', 'Add a view'));
    await wait(250);
    const item = $$('.views-card .popover .menu-item').find((b) => b.textContent.includes('against the swept parameter'));
    click(item);
    await wait(900);
    const v = project().compare.views.at(-1);
    const drawn = await until(() => {
      const c = $$('.compare-views > .card').at(-1);
      return c && c.querySelector('svg path') && $$('select', c).some((s) => [...s.selectedOptions].some((o) => o.text.includes('Ag'))) && c;
    }, 20000);
    check('side by side: the metrics against the swept thickness', !!item && v.source.startsWith('metrics:') && !!drawn, v && v.source);
  };

  // the phase and the Goos–Hänchen shift: the benchmark example, the metric kinds, the quantities of the plots
  groups.phaseGh = async function phaseGh() {
    await loadExample('Goos');
    await go('simulation');
    const p0 = project();
    check('GH example: its GH and phase metrics', p0.metrics.some((m) => m.kind === 'gh') && p0.metrics.some((m) => m.kind === 'phase') && p0.sim.pol === 'p', p0.metrics.map((m) => m.kind).join(', '));
    const gh = await until(() => $$('.metric-item .metric-main').map((e) => e.textContent).find((t) => t.includes('λ') && /\d/.test(t)), 40000);
    check('GH example: the GH shift computed', !!gh, gh);
    const n0 = project().metrics.length;
    click(byText('button', 'Add metric'));
    await wait(700);
    const item = () => $$('.metric-item').pop();
    setValue($('select[aria-label="Kind"]', item()), 'phase');
    await wait(700);
    const ph = await until(() => {
      const t = $('table.results', item())?.textContent ?? '';
      return t.includes('°/RIU') && /\d/.test(t) ? t : null;
    }, 40000);
    check('a phase metric: its slope, jump and Δφ/Δn', project().metrics.length === n0 + 1 && project().metrics[n0].kind === 'phase' && !!ph && !$('select[aria-label="Curve"]', item()), ph?.slice(0, 120));
    setValue($('select[aria-label="Kind"]', item()), 'gh');
    await wait(700);
    const g2 = await until(() => {
      const t = $('table.results', item())?.textContent ?? '';
      return t.includes('λ/RIU') && /\d/.test(t) ? t : null;
    }, 40000);
    check('a GH metric: the shift, D and the GH sensitivity', project().metrics[n0].kind === 'gh' && project().metrics[n0].field === 'gh' && !!g2, g2?.slice(0, 120));
    const plot = $('section.card[id^="plot-"]');
    click($('.chip.add', plot));
    await wait(250);
    // (those already on the plot: its chips; the others: the menu)
    const items = [...$$('.popover .menu-item', plot), ...$$('.chip:not(.add)', plot)].map((b) => b.textContent);
    click($('.chip.add', plot));
    await wait(200);
    check('plots: the GH shift and the phase slope are quantities', items.some((t) => t.includes('GH shift') || t.startsWith('gh')) && items.some((t) => t.includes('dφr/dx')), items.filter((t) => /GH|dφ/.test(t)).join(' · '));
  };

  // the tolerances: variations, a run, the statistics, the response, the distribution, pass / fail
  groups.tolerances = async function tolerances() {
    await loadExample('Kretschmann');
    await go('tolerances');
    const nav = $$('.sidebar li button').map((b) => b.textContent);
    check('the Tolerances tab, before Compare', nav.indexOf('Tolerances') === nav.indexOf('Compare') - 1 && !!$('.tol-vars-card'), nav.join(' · '));
    click(byText('.page button', 'Variation'));
    await wait(700);
    const tol = () => project().tol;
    check('a variation added (the first layer, thickness)', tol()?.variations.length === 1 && tol().variations[0].place === 'ag' && tol().variations[0].what === 'd', JSON.stringify(tol()?.variations[0]));
    const box = () => $$('.tol-var')[0];
    const selIn = (label, root) => $$('.field', root).find((f) => f.textContent.trim().startsWith(label))?.querySelector('select');
    setValue($('input[aria-label="Amount"]', box()), '2');
    setValue(selIn('Distribution', box()), 'uniform');
    setValue(selIn('Correlation', box()), 'systematic');
    setValue($('input[aria-label="Limit"]', box()), '1.5');
    await wait(700);
    const v0 = tol().variations[0];
    check('the variation edited (±2 nm uniform, systematic, |Δ| ≤ 1.5)', v0.amount === 2 && v0.dist === 'uniform' && v0.mode === 'systematic' && v0.limit === 1.5, JSON.stringify(v0));
    click(byText('.page button', 'Variation'));
    await wait(700);
    setValue(selIn('Where', $$('.tol-var')[1]), 'exit|all');
    await wait(700);
    const v1 = tol().variations[1];
    check('a variation of the exit medium: its index', v1.place === 'exit' && v1.what === 'n' && ![...selIn('Quantity', $$('.tol-var')[1]).options].some((o) => o.value === 'd'), JSON.stringify(v1));
    const samples = $$('.tol-run .field').find((f) => f.textContent.startsWith('Samples')).querySelector('input');
    setValue(samples, '40');
    await wait(700);
    click(byText('.page button', 'Run'));
    const done = await until(() => /40 \/ 40 samples/.test($('.tol-progress')?.textContent ?? '') && !byText('.page button', 'Stop'), 60000);
    check('the samples computed', !!done && tol().samples === 40, $('.tol-progress')?.textContent);
    const stat = $$('table.tol-stats tbody tr')[0];
    const cells = stat ? $$('td', stat).map((td) => td.textContent) : [];
    check('the statistics of the metrics (nominal, mean, σ, median, P5, P95)', cells.length >= 9 && cells.slice(1, 9).every((t) => /\d/.test(t)), cells.slice(0, 9).join(' | '));
    const resp = $$('.tol-layout .card').find((c) => c.querySelector('h2')?.textContent === 'Response');
    check('the response: nominal, mean, median, band, samples', $$('svg path', resp).length > 10 && !!$('.tol-legend', resp), `${$$('svg path', resp).length} paths`);
    click(byText('.segmented button', 'Min–max', resp));
    // (the save is debounced: wait for it, the timers of a hidden page are slowed down)
    await until(() => tol().band === 'minmax', 5000);
    check('the band: min–max', tol().band === 'minmax', tol().band);
    click(byText('.page button', 'Criterion'));
    await wait(250);
    click($$('.popover .menu-item').find((b) => b.textContent.includes('FWHM')));
    await until(() => tol().criteria.length === 1, 5000);
    const c0 = tol().criteria[0];
    const yieldText = $('.yield-big')?.textContent ?? '';
    check('a pass / fail criterion and the yield', tol().criteria.length === 1 && c0.op === 'le' && /\d+(\.\d+)?%/.test(yieldText) && $$('.yield-bars rect').length === 4, `${JSON.stringify(c0)} · ${yieldText}`);
    const crit = $('input[aria-label="C1: value"]');
    const nominal = Number(($('.tol-stats tbody tr td:nth-child(2)')?.textContent ?? 'NaN'));
    setValue(crit, String(nominal));
    await wait(700);
    const y2 = Number(($('.yield-big b')?.textContent ?? '').replace('%', ''));
    check('the yield follows the limit (FWHM ≤ the nominal: some fail)', y2 > 0 && y2 < 100, `${y2}%`);
    check('the distribution: histogram and the scatter against a variation', $$('svg.histogram rect').length > 3 && $$('.tol-dist .front-view')[1]?.querySelectorAll('svg circle').length > 10, `${$$('svg.histogram rect').length} bars`);
    setValue(samples, '41');
    await wait(700);
    check('a change marks the results out of date', !!$('.tol-vars-card .msg.warn'));
    setValue(samples, '400');
    await wait(700);
    click(byText('.page button', 'Run'));
    await wait(800);
    click(byText('.page button', 'Stop'));
    await wait(700);
    check('a run stopped', /stopped/.test($('.tol-progress')?.textContent ?? ''), $('.tol-progress')?.textContent);
  };

  window.__ui = {
    async run(which = 'all') {
      results.length = 0;
      const names = which === 'all' ? Object.keys(groups) : [which];
      for (const g of names) {
        try {
          await groups[g]();
        } catch (e) {
          check(`${g}: threw`, false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
        }
      }
      const failed = results.filter((r) => !r.ok);
      return { passed: results.length - failed.length, failed: failed.length, results: results.map((r) => `${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`) };
    },
  };
})();
