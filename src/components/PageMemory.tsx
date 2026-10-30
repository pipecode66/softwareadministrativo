import { Activity, createContext, useContext, useMemo, useRef, type ContextType, type ReactNode } from 'react';
import { UNSAFE_LocationContext, useLocation, useOutlet } from 'react-router-dom';

interface SavedPage {
  instance: number;
  outlet: ReactNode;
  location: ContextType<typeof UNSAFE_LocationContext>;
  resetOnExit: boolean;
}
interface Memory {
  pages: Map<string, SavedPage>;
  nextInstance: () => number;
  href: (pathname: string) => string;
  forget: (pathname: string) => void;
}
const MemoryContext = createContext<Memory | null>(null);

/** Session-only memory: unfinished forms and credentials are never written to disk. */
export function PageMemoryProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const pages = useRef(new Map<string, SavedPage>());
  const searches = useRef(new Map<string, string>());
  const activePath = useRef(location.pathname);
  const instance = useRef(0);
  activePath.current = location.pathname;
  searches.current.set(location.pathname, location.search);
  const memory = useMemo<Memory>(() => ({
    pages: pages.current,
    nextInstance: () => ++instance.current,
    href: pathname => pathname + (searches.current.get(pathname) || ''),
    forget: pathname => {
      const page = pages.current.get(pathname);
      if (page) {
        if (activePath.current === pathname) page.resetOnExit = true;
        else pages.current.delete(pathname);
      }
      searches.current.delete(pathname);
    },
  }), []);
  return <MemoryContext.Provider value={memory}>{children}</MemoryContext.Provider>;
}

export function usePageMemory() {
  return useContext(MemoryContext) ?? { href: (pathname: string) => pathname, forget: (_pathname: string) => {} };
}

/** Keep state/DOM, suspend background effects, and freeze each hidden route's location. */
export function RememberedOutlet() {
  const memory = useContext(MemoryContext)!;
  const location = useContext(UNSAFE_LocationContext);
  const outlet = useOutlet();
  const path = location.location.pathname;
  for (const [key, page] of memory.pages) if (key !== path && page.resetOnExit) memory.pages.delete(key);
  const previous = memory.pages.get(path);
  memory.pages.set(path, { instance:previous?.instance ?? memory.nextInstance(), outlet, location, resetOnExit: previous?.resetOnExit ?? false });
  return <>{[...memory.pages].map(([key, page]) => <Activity key={`${key}:${page.instance}`} mode={key === path ? 'visible' : 'hidden'}>
    <UNSAFE_LocationContext.Provider value={page.location}><div data-page-path={key}>{page.outlet}</div></UNSAFE_LocationContext.Provider>
  </Activity>)}</>;
}
