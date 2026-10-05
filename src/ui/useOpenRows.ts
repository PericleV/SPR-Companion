import { useState } from 'react';

// Which rows of a list are open (kept by the page across re-renders of the list).
export function useOpenRows() {
  const [open, setOpenState] = useState<Record<string, boolean>>({});
  return { open, setOpen: (id: string, v: boolean) => setOpenState((o) => ({ ...o, [id]: v })) };
}
