import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { AboutPage } from "./components/AboutPage.tsx";
import { DiscoverPage } from "./components/DiscoverPage.tsx";
import { SubmitPage } from "./components/SubmitPage.tsx";
import { onLinkClick, useLocation } from "./lib/router.ts";
import { useSaved } from "./lib/storage.ts";

// Reviewers only: kept out of the public bundle.
const AdminPage = lazy(() => import("./components/AdminPage.tsx").then((m) => ({ default: m.AdminPage })));

function NavLink({ to, current, children, className }: { to: string; current: boolean; children: React.ReactNode; className?: string }) {
  return (
    <a href={to} className={className} aria-current={current ? "page" : undefined} onClick={(e) => onLinkClick(e, to)}>
      {children}
    </a>
  );
}

export function App() {
  const { path, search } = useLocation();
  const { saved } = useSaved();
  const [toast, setToast] = useState<string | null>(null);
  const [mock, setMock] = useState(false);
  const showToast = useCallback((m: string) => setToast(m), []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    fetch("/api/meta")
      .then((r) => r.json())
      .then((d: { mock?: boolean }) => setMock(Boolean(d.mock)))
      .catch(() => {});
  }, []);

  const isBrowse = path === "/" || path.startsWith("/e/");
  const savedView = isBrowse && new URLSearchParams(search).get("saved") === "1";

  let page: React.ReactNode;
  if (isBrowse) page = <DiscoverPage path={path} search={search} onToast={showToast} />;
  else if (path === "/submit") page = <SubmitPage />;
  else if (path === "/about") page = <AboutPage />;
  else if (path === "/admin") page = <Suspense fallback={<main id="main" className="narrow">Loading…</main>}><AdminPage /></Suspense>;
  else
    page = (
      <main id="main" className="narrow">
        <h1>Page not found</h1>
        <p className="sub">That page doesn't exist.</p>
        <a className="btn" href="/" onClick={(e) => onLinkClick(e, "/")}>Browse hackathons</a>
      </main>
    );

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      {mock && <div className="mock-banner" role="status">Mock data — fake events for development</div>}
      <header className="header">
        <a className="wordmark" href="/" onClick={(e) => onLinkClick(e, "/")}>
          <span className="wordmark-mark" aria-hidden="true">H</span>
          Hackathon Digest
        </a>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" current={isBrowse && !savedView}>Browse</NavLink>
          <NavLink to="/?saved=1" current={savedView}>Saved<span className="count num">{saved.size || ""}</span></NavLink>
          <NavLink to="/submit" current={path === "/submit"} className="hide-sm">Suggest an event</NavLink>
          <NavLink to="/about" current={path === "/about"} className="hide-sm">How it works</NavLink>
        </nav>
      </header>
      {page}
      <footer className="footer">
        <span>Hackathon Digest lists only events verified to accept high school students.</span>
        <span className="spacer" />
        <a href="/about" onClick={(e) => onLinkClick(e, "/about")}>How listings are verified</a>
        <a href="/submit" onClick={(e) => onLinkClick(e, "/submit")}>Suggest an event</a>
      </footer>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
