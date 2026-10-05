// The open project, shared by every page, kept in the browser between visits.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { makeLibrary, modelsOf, type Library } from './physics/library.ts';
import type { Models } from './physics/materials.ts';
import { defaultProject, parseProject, stringifyProject, type Project } from './model/project.ts';

const KEY = 'spr-companion:project';

type ProjectState = {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  replace: (p: Project) => void;
  lib: Library;
  models: Models;
};

const Ctx = createContext<ProjectState | null>(null);

function load(): Project {
  try {
    const text = localStorage.getItem(KEY);
    return (text && parseProject(text)) || defaultProject();
  } catch {
    return defaultProject();
  }
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project>(load);
  useEffect(() => {
    // saved shortly after the last change (typing in a field changes the project at every key)
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, stringifyProject(project));
      } catch {
        // storage unavailable or full: the project lasts for this session (files still work)
      }
    }, 300);
    return () => clearTimeout(t);
  }, [project]);
  const lib = useMemo(() => makeLibrary(project.materials), [project.materials]);
  const models = useMemo(() => modelsOf(lib), [lib]);
  // a project put in (an example, a file) is read like a stored one: defaults, λ and θ exposed, formula names
  const replace = (p: Project) => setProject(parseProject(stringifyProject(p)) ?? p);
  const value = useMemo<ProjectState>(() => ({ project, update: (fn) => setProject(fn), replace, lib, models }), [project, lib, models]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react/only-export-components
export function useProject(): ProjectState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useProject outside ProjectProvider');
  return s;
}
