import { useEffect, useState } from 'react';
import { useProject } from './state.tsx';
import { applyTheme, loadTheme, type Theme } from './theme.ts';
import { describe, expand } from './model/structure.ts';
import { Home } from './pages/Home.tsx';
import { Simulation } from './pages/Simulation.tsx';
import { Placeholder } from './pages/Placeholder.tsx';
import { Materials } from './pages/Materials.tsx';
import { Structure } from './pages/Structure.tsx';
import { Optimization } from './pages/Optimization.tsx';
import { Compare } from './pages/Compare.tsx';
import { Tolerances } from './pages/Tolerances.tsx';
import { Sensorgram } from './pages/Sensorgram.tsx';
import { ProjectMenu } from './ui/ProjectMenu.tsx';
import { ConfigMenu } from './ui/ConfigMenu.tsx';
import { PAGES, pageOf, type PageId } from './pages.ts';
import { Icon } from './ui/kit.tsx';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export default function App() {
  const [page, setPage] = useState<PageId>(() => pageOf(location.hash));
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [menu, setMenu] = useState(false);
  const [notes, setNotes] = useState(false);
  const { project, update, lib, models } = useProject();

  useEffect(() => {
    const onHash = () => setPage(pageOf(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => applyTheme(theme), [theme]);

  const go = (id: PageId) => {
    window.location.assign(`#/${id}`);
    setMenu(false);
  };
  const ex = expand(project.structure, lib, models);
  const current = PAGES.find((p) => p.id === page)!;

  return (
    <div className={`app${menu ? ' menu-open' : ''}${notes ? ' notes-open' : ''}`}>
      <nav className="sidebar">
        <div className="brand">
          <img src="./logo.svg" alt="" />
          <span>SPR Companion</span>
        </div>
        <ul>
          {PAGES.filter((p) => !p.topbar).map((p) => (
            <li key={p.id}>
              <button className={p.id === page ? 'active' : ''} onClick={() => go(p.id)}>{p.title}</button>
            </li>
          ))}
        </ul>
        <ul className="nav-tools">
          <li>
            <button className={page === 'materials' ? 'active' : ''} title="The material library and your own materials" onClick={() => go('materials')}>Materials</button>
          </li>
          <li>
            <button className={notes ? 'open' : ''} aria-expanded={notes} title="The project's notes (an example's source and benchmark, your own)" onClick={() => setNotes(!notes)}>
              Notes
              <Icon name={notes ? 'chevronUp' : 'chevronDown'} size={14} />
            </button>
          </li>
        </ul>
        {notes && (
          <section className="notes-panel">
            <textarea aria-label="Notes" value={project.notes} placeholder="Write anything about this project…" onChange={(e) => update((p) => ({ ...p, notes: e.target.value }))} />
            <span className="muted small">saved with the project</span>
          </section>
        )}
        <div className="sidebar-foot">
          <label>
            Theme{' '}
            <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>
          <p>Pericle Varasteanu · Nanobiotechnology Lab · IMT Bucharest</p>
        </div>
      </nav>
      <div className="scrim" onClick={() => setMenu(false)} />
      <main>
        <header className="topbar">
          <button className="menu-btn" aria-label="Menu" onClick={() => setMenu(!menu)}>☰</button>
          <ProjectMenu />
          <ConfigMenu />
        </header>
        {page !== 'home' && page !== 'materials' && page !== 'compare' && (
          <div className={`structure-line${ex.errors.length ? ' bad' : ''}`} title="The current structure (Structure page)" onClick={() => go('structure')}>
            {project.configs.length > 1 && <b className="config-line">{project.configs.find((c) => c.id === project.configId)?.name} · </b>}
            {ex.errors.length ? ex.errors[0] : describe(ex, lib)}
          </div>
        )}
        <div className="page">
          {page === 'home' ? (
            <Home go={go} />
          ) : page === 'materials' ? (
            <Materials />
          ) : page === 'structure' ? (
            <Structure key={project.configId} />
          ) : page === 'simulation' ? (
            <Simulation key={project.configId} />
          ) : page === 'sensorgram' ? (
            <Sensorgram key={project.configId} />
          ) : page === 'optimization' ? (
            <Optimization key={project.configId} />
          ) : page === 'tolerances' ? (
            <Tolerances key={project.configId} />
          ) : page === 'compare' ? (
            <Compare go={go} />
          ) : (
            <Placeholder title={current.title} blurb={current.blurb} />
          )}
        </div>
      </main>
    </div>
  );
}
