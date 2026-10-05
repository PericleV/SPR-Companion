// The home page: a short guided tour (the steps of a project, each with what to do and the page to open) and the examples:
// each opened as the project, or added as a configuration of the open one.
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useProject } from '../state.tsx';
import { EXAMPLES } from '../model/examples.ts';
import { addConfigsFrom, defaultProject, parseProject } from '../model/project.ts';
import type { PageId } from '../pages.ts';
import { Icon } from '../ui/kit.tsx';

const STEP_KEY = 'spr-companion:tour-step';

// Small drawings of each step (theme colours).
const Pic = ({ children }: { children: ReactNode }) => (
  <svg className="tour-pic" viewBox="0 0 120 80" aria-hidden="true">
    {children}
  </svg>
);
const PICS: Record<string, ReactNode> = {
  materials: (
    <Pic>
      {['#c9a227', '#b8bcc4', '#7fb6d9', '#5c6bc0', '#2563eb'].map((c, i) => (
        <rect key={c} x={10 + i * 21} y={20} width={16} height={40} rx={3} fill={c} />
      ))}
    </Pic>
  ),
  structure: (
    <Pic>
      <rect x={20} y={8} width={80} height={14} fill="#9ecae1" />
      <rect x={20} y={22} width={80} height={5} fill="#c9a227" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={20} y={27 + i * 8} width={80} height={4} fill={i % 2 ? '#5c6bc0' : '#d8dee9'} />
      ))}
      <rect x={20} y={59} width={80} height={13} fill="#7fb6d9" opacity={0.6} />
      <path d="M8 2 L34 20" stroke="var(--accent)" strokeWidth={2.5} />
      <path d="M36 21.5 L27 19.5 L32 13.5 Z" fill="var(--accent)" />
    </Pic>
  ),
  params: (
    <Pic>
      {[18, 40, 62].map((y, i) => (
        <g key={y}>
          <line x1={14} x2={106} y1={y} y2={y} stroke="var(--border)" strokeWidth={4} strokeLinecap="round" />
          <line x1={14} x2={[70, 40, 92][i]} y1={y} y2={y} stroke="var(--accent)" strokeWidth={4} strokeLinecap="round" />
          <circle cx={[70, 40, 92][i]} cy={y} r={6} fill="var(--panel)" stroke="var(--accent)" strokeWidth={2.5} />
        </g>
      ))}
    </Pic>
  ),
  simulation: (
    <Pic>
      <path d="M8 70 V8 M8 70 H114" stroke="var(--muted)" strokeWidth={1.5} fill="none" />
      <path d="M10 16 C40 16 46 18 54 30 C60 44 62 64 66 64 C70 64 72 44 78 30 C84 20 96 18 112 18" stroke="var(--accent)" strokeWidth={2.5} fill="none" />
    </Pic>
  ),
  metrics: (
    <Pic>
      <rect x={44} y={8} width={44} height={62} fill="var(--accent)" opacity={0.12} />
      <path d="M10 16 C40 16 46 18 54 30 C60 44 62 64 66 64 C70 64 72 44 78 30 C84 20 96 18 112 18" stroke="var(--muted)" strokeWidth={2} fill="none" />
      <line x1={57} x2={75} y1={40} y2={40} stroke="#d9534f" strokeWidth={2.5} />
      <circle cx={66} cy={64} r={4} fill="#d9534f" />
    </Pic>
  ),
  optimization: (
    <Pic>
      {[30, 21, 12].map((r, i) => (
        <circle key={r} cx={60} cy={40} r={r} fill="none" stroke="var(--accent)" strokeWidth={2} opacity={0.35 + i * 0.3} />
      ))}
      <path d="M14 70 L30 58 L42 62 L52 48 L60 40" stroke="var(--muted)" strokeWidth={2} fill="none" strokeDasharray="3 3" />
      <circle cx={60} cy={40} r={4} fill="var(--accent)" />
    </Pic>
  ),
  tolerances: (
    <Pic>
      {[3, 4, 7, 11, 15, 18, 14, 10, 6, 4, 2].map((h, i) => (
        <rect key={i} x={10 + i * 9} y={70 - h * 3.4} width={8} height={h * 3.4} fill={i < 8 ? '#2e9d5b' : '#d9534f'} opacity={0.6} />
      ))}
      <line x1={82} x2={82} y1={6} y2={72} stroke="#d9534f" strokeWidth={2} strokeDasharray="4 3" />
      <line x1={55} x2={55} y1={6} y2={72} stroke="var(--text)" strokeWidth={2} />
    </Pic>
  ),
  sensorgram: (
    <Pic>
      <path d="M8 70 V8 M8 70 H114" stroke="var(--muted)" strokeWidth={1.5} fill="none" />
      <rect x={28} y={8} width={34} height={62} fill="var(--accent)" opacity={0.12} />
      {[0.45, 0.75, 1].map((a, i) => (
        <path key={i} d={`M10 64 H28 C36 ${64 - 46 * a} 50 ${64 - 50 * a} 62 ${64 - 52 * a} C80 ${64 - 46 * a} 96 ${64 - 40 * a} 112 ${64 - 36 * a}`} stroke="var(--accent)" strokeWidth={2} fill="none" opacity={0.4 + 0.3 * i} />
      ))}
    </Pic>
  ),
  configs: (
    <Pic>
      <path d="M8 70 V8 M8 70 H114" stroke="var(--muted)" strokeWidth={1.5} fill="none" />
      <path d="M10 18 C36 18 40 22 46 34 C50 48 52 62 56 62 C60 62 62 46 68 34 C74 22 90 20 112 20" stroke="#e07b39" strokeWidth={2.5} fill="none" />
      <path d="M10 22 C60 22 76 22 82 26 C84 34 86 66 88 66 C90 66 92 34 94 26 C98 22 106 22 112 22" stroke="var(--accent)" strokeWidth={2.5} fill="none" />
    </Pic>
  ),
};

type Step = { id: string; title: string; page?: PageId; pageLabel?: string; text: ReactNode; points: ReactNode[] };
const STEPS: Step[] = [
  {
    id: 'materials',
    title: 'Materials',
    page: 'materials',
    pageLabel: 'Open Materials',
    text: 'The library already holds the metals, the dielectrics, the prisms and the 2D materials (refractiveindex.info data). Add your own only when you need them.',
    points: [
      'Your own material: a constant n + ik, a table of λ, n, k (CSV), a dispersion formula (Sellmeier, Cauchy …), Drude-Lorentz, an effective medium (a porous host), graphene (Kubo).',
      'The preview plots n and k over λ before you save it; its colour is the one used in the drawings.',
      'Materials (in the sidebar) is the same in every configuration of the project.',
    ],
  },
  {
    id: 'structure',
    title: 'Structure',
    page: 'structure',
    pageLabel: 'Open Structure',
    text: 'Build the stack as a table, from the incident medium (the prism) to the exit medium (the analyte).',
    points: [
      <><b>+ Film</b> adds a layer (its material, its thickness — or a number of monolayers for a 2D material); <b>+ DBR</b> a Bragg mirror: its period layers (λ₀/4 or any thickness), the number of periods and cavities at any position.</>,
      <><b>Light from the exit side</b> reverses the order the light meets the layers.</>,
      <>The <b>roughness</b> button under a layer's name (a film, a DBR layer — in every period —, a cavity) opens the roughness of its top and bottom interfaces: a random profile (RMS or peak-to-peak, correlation length, seed), an effective or a graded interface layer; each material keeps its thickness, the interface is cut into slices of an effective medium (Bruggeman, Maxwell-Garnett, Looyenga, linear n, or lamellar — Wiener: the harmonic mean of ε across the grooves, the arithmetic one along them).</>,
      'The Stack panel draws the structure; its arrow is only the drawing. Its layer list (and CSV) gives every real layer.',
    ],
  },
  {
    id: 'params',
    title: 'Parameters',
    page: 'structure',
    pageLabel: 'Open Structure',
    text: 'What can change: a thickness, a material, an index n or k, the number of periods, a cavity position…',
    points: [
      <><b>+ Add parameter</b>: where (a medium, a layer, a DBR and its layers), what, and its values.</>,
      'Swept over a range (by step or number of values) or a list; optimized within bounds; or both. A material: its candidate materials.',
      'The values that are parameters are tagged in the layers table (swept, optimized).',
    ],
  },
  {
    id: 'simulation',
    title: 'Simulation',
    page: 'simulation',
    pageLabel: 'Open Simulation',
    text: 'The interrogation and what is plotted.',
    points: [
      <><b>Angular</b> R(θ) at a wavelength, <b>Spectral</b> R(λ) at an angle, or a <b>Map λ × θ</b>; TM, TE or unpolarized.</>,
      <>One scan follows your changes; with swept parameters (<b>+ Parameter</b> under Sweep) press <b>Run simulation</b>.</>,
      <>Plots: R, T, A, phases and amplitudes on two Y axes, maps, the field inside the stack, the values of the metrics vs a swept parameter; <b>Computed quantities</b> are formulas of them.</>,
      <>A swept <b>roughness seed</b> gives realizations of a rough interface: a plot shows one, all of them, their mean or their median.</>,
    ],
  },
  {
    id: 'metrics',
    title: 'Metrics',
    page: 'simulation',
    pageLabel: 'Open Simulation',
    text: 'What is measured on every curve.',
    points: [
      'The dip or the band (position, FWHM, depth, Q), the sensitivity S = Δθ/Δn or Δλ/Δn (with the curve for n + Δn), the FOM, the field (penetration, |E|², the fraction absorbed), the propagation length; phase interrogation (slope, Δφ/Δn) and the Goos–Hänchen shift (TE or TM).',
      'Fits (Lorentz, Gauss, Fano, coupled oscillators; the dispersion of two branches), a match to a target curve, zones, formulas of other metrics.',
      <><b>Draw region</b> on a plot, then Confirm; in a sweep the region can follow the swept parameter. <b>Overlays</b> on each plot chooses what is drawn.</>,
    ],
  },
  {
    id: 'sensorgram',
    title: 'Sensorgram',
    page: 'sensorgram',
    pageLabel: 'Open Sensorgram',
    text: 'A binding experiment on your chip: what an SPR instrument would record as molecules bind.',
    points: [
      <><b>Analyte and surface</b>: an antibody, a protein, DNA, a small molecule or your own (MW, dn/dc, size); lying or standing; bound to ligand sites or adsorbed at random (the full monolayer it can make, the double layer of the buffer).</>,
      <><b>Binding kinetics</b> (1:1, mass transport, bivalent, two sites, two-state, a swelling polymer) along a protocol of injections; one curve per concentration of a <b>series</b>, and a planner for it: five concentrations around KD and an injection long enough for equilibrium.</>,
      <><b>Run</b>: the bound layer and the index of the flowing solution at every time, the resonance followed (or a parameter — R, T, A, a phase — at a point, by default at the resonance), through the instrument's blur and noise. The summary gives the calibration (° per ng/mm²) and the detection limit; <b>Add plot</b> shows the bound amount, the curves over the scan at chosen times (and their map), the steady state; the Compare page puts the sensorgrams of several chips side by side.</>,
    ],
  },
  {
    id: 'optimization',
    title: 'Optimization',
    page: 'optimization',
    pageLabel: 'Open Optimization',
    text: 'Search the parameters for the best design.',
    points: [
      <><b>Variables</b>: the parameters with Optimize on, within their bounds. <b>Goals</b>: any result of a metric as an objective (max, min, reach a value) or a constraint (C1, C2 …).</>,
      'Differential evolution, GA, particle swarm, simulated annealing, NSGA-II (a Pareto front, constraints first), Adam, Nelder-Mead, Levenberg-Marquardt.',
      <><b>Apply to the project</b> writes the best point (or a point of the front) into the structure. The second tab designs SPR sensors by layer sequences. A rough structure: every candidate can be the mean or median over N realizations.</>,
    ],
  },
  {
    id: 'tolerances',
    title: 'Tolerances',
    page: 'tolerances',
    pageLabel: 'Open Tolerances',
    text: 'How fabrication errors spread the response (Monte Carlo).',
    points: [
      <><b>Variations</b>: the thickness, n or k of a layer, of a DBR (every layer, one layer of its period, a cavity) or of a medium; Gaussian (σ) or uniform (±a), in nm or %; <b>independent</b> per layer or <b>systematic</b> (one deviation for all); an optional limit.</>,
      'Each sample is the structure with its deviations, computed over the interrogation: the nominal, mean and median response with a P5–P95, min–max or ±σ band; every metric with its statistics, histogram and its dependence on a variation.',
      <><b>Pass / fail</b>: criteria on any result (e.g. min R ≤ 0.2, S ≥ 100 °/RIU) and the <b>yield</b>, the fraction of the samples that meets them all.</>,
    ],
  },
  {
    id: 'configs',
    title: 'Configurations',
    page: 'compare',
    pageLabel: 'Open Compare',
    text: 'Several structures in one project, compared on the same plot.',
    points: [
      <>The menu at the top right: <b>Duplicate</b> the current configuration to vary it, or start a <b>New</b> one; each keeps its own structure, interrogation, parameters, metrics and plots.</>,
      <>The <b>Compare</b> page puts them side by side — stacks, layers, parameters, the optimizations applied — with compare plots: <b>Add curve</b> picks a configuration, its data and Y, the axis and the colour, and its metrics drawn over it.</>,
      <><b>Save</b> writes the whole project (every configuration) to a file; it is also kept in this browser. <b>Notes</b> (sidebar) travel with it.</>,
    ],
  },
];

export function Home({ go }: { go: (id: PageId) => void }) {
  const { project, replace, update } = useProject();
  const [step, setStep] = useState(() => {
    try {
      return Math.min(STEPS.length - 1, Math.max(0, Number(localStorage.getItem(STEP_KEY)) || 0));
    } catch {
      return 0;
    }
  });
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const show = (i: number, focus = false) => {
    const k = (i + STEPS.length) % STEPS.length;
    setStep(k);
    try {
      localStorage.setItem(STEP_KEY, String(k));
    } catch {
      /* (not remembered) */
    }
    if (focus) tabs.current[k]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') show(step + 1, true);
    else if (e.key === 'ArrowLeft') show(step - 1, true);
    else return;
    e.preventDefault();
  };
  const confirmLoss = () => confirm('Replace the current project? (Save it first if you want to keep it.)');
  const openFile = async (f: File | undefined) => {
    if (!f) return;
    const p = parseProject(await f.text());
    if (!p) alert(`“${f.name}” is not an SPR Companion project.`);
    else if (confirmLoss()) replace(p);
  };

  const s = STEPS[step];
  // an example as a configuration of the open project (the rest of it stays)
  const [added, setAdded] = useState('');
  const addAsConfig = (x: (typeof EXAMPLES)[number]) => {
    update((p) => addConfigsFrom(p, x.make(), x.name));
    setAdded(x.name);
  };

  return (
    <div className="home">
      <header className="home-hero">
        <img src="./logo.svg" alt="" className="home-logo" />
        <div>
          <h1>SPR Companion</h1>
          <p className="lead">Surface plasmon resonance sensors, Tamm plasmons and Bragg mirrors: simulated, swept, measured and optimized in your browser — and binding experiments turned into the sensorgrams an SPR instrument would record. Nothing is uploaded anywhere.</p>
          <div className="home-actions">
            <button type="button" className="primary" onClick={() => document.getElementById('examples')?.scrollIntoView({ behavior: 'smooth' })}>
              <Icon name="play" size={14} />
              Start from an example
            </button>
            <button type="button" onClick={() => confirmLoss() && (replace({ ...defaultProject(), name: 'New project', structure: { incident: { id: 'BK7' }, blocks: [], exit: { id: 'Air' } } }), go('structure'))}>
              <Icon name="plus" size={14} />
              New project
            </button>
            <button type="button" onClick={() => file.current?.click()}>Open a file…</button>
            <input
              ref={file}
              type="file"
              accept=".json"
              hidden
              onChange={(e) => {
                openFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </header>

      <div className="home-grid">
        <section className="card tour" aria-label="A short tour">
          <div className="card-head">
            <h2>A short tour</h2>
            <span className="sub">step {step + 1} of {STEPS.length}</span>
          </div>
          <div className="tour-steps" role="tablist" aria-label="Steps" onKeyDown={onKey}>
            {STEPS.map((x, i) => (
              <button
                key={x.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                aria-selected={i === step}
                tabIndex={i === step ? 0 : -1}
                className={`tour-step${i === step ? ' on' : ''}${i < step ? ' done' : ''}`}
                onClick={() => show(i)}
              >
                <span className="tour-num">{i + 1}</span>
                <span className="tour-title">{x.title}</span>
              </button>
            ))}
          </div>
          <div className="tour-body" role="tabpanel" aria-label={s.title}>
            {PICS[s.id]}
            <div className="tour-text">
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <ul>
                {s.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="tour-nav">
            <button type="button" onClick={() => show(step - 1)} disabled={step === 0}>Back</button>
            {s.page && (
              <button type="button" onClick={() => go(s.page!)}>
                {s.pageLabel}
                <Icon name="chevronRight" size={14} />
              </button>
            )}
            <span className="spacer" />
            {step < STEPS.length - 1 ? (
              <button type="button" className="primary" onClick={() => show(step + 1)}>
                Next: {STEPS[step + 1].title}
                <Icon name="chevronRight" size={14} />
              </button>
            ) : (
              <button type="button" className="primary" onClick={() => show(0)}>Back to the start</button>
            )}
          </div>
        </section>
      </div>

      <section className="examples" id="examples">
        <div className="card-head">
          <h2>Examples</h2>
          <span className="sub">load as a new project or as an additional configuration; the benchmarks reproduce published results (sources and values in Notes)</span>
        </div>
        {added && (
          <div className="msg ok-msg">
            “{added}” added as a configuration of “{project.name}” ({project.configs.length} configurations).
            <button type="button" className="link" onClick={() => go('structure')}>Open it</button>
            <button type="button" className="link" onClick={() => go('compare')}>Compare</button>
          </div>
        )}
        <div className="example-grid">
          {EXAMPLES.map((x) => (
            <article key={x.name} className="example-card">
              <h3>{x.name.replace(/, benchmark\)$/, ')')}</h3>
              {/benchmark/i.test(x.name) && <span className="tag-var">benchmark</span>}
              <p className="muted small">{x.note}</p>
              <div className="example-actions">
                <button type="button" title="Open it as the project (the open project is replaced)" onClick={() => confirmLoss() && (replace(x.make()), go('simulation'))}>
                  Open
                  <Icon name="chevronRight" size={14} />
                </button>
                <button type="button" title="Add it as a configuration of the open project (nothing is replaced)" onClick={() => addAsConfig(x)}>
                  <Icon name="plus" size={14} />
                  Add as configuration
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
