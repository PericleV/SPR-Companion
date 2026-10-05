import { useProject } from '../state.tsx';
import type { SensTarget } from '../model/metrics.ts';

// What a sensitivity metric can perturb: the media, every block, every cavity.
export function useSensTargets(): { label: string; t: SensTarget }[] {
  const { project, lib } = useProject();
  return [
    { label: 'the exit medium', t: { kind: 'exit' } },
    { label: 'the incident medium', t: { kind: 'incident' } },
    ...project.structure.blocks.flatMap((b, i) => [
      { label: `block ${i + 1} (${b.label || (b.kind === 'dbr' ? 'DBR' : (lib.get(b.mat.id)?.name ?? b.mat.id))})${b.kind === 'dbr' ? ', all its layers' : ''}`, t: { kind: 'block', block: b.id } as SensTarget },
      ...(b.kind === 'dbr' ? b.cavities.map((_, j) => ({ label: `block ${i + 1}, cavity ${j + 1}`, t: { kind: 'cavity', block: b.id, index: j } as SensTarget })) : []),
    ]),
  ];
}
