import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { AboutPage } from "./components/AboutPage.tsx";
import { DiscoverPage } from "./components/DiscoverPage.tsx";
import { SubmitPage } from "./components/SubmitPage.tsx";
import { adminAvailable } from "./lib/api.ts";
import { supabaseEnabled } from "./lib/supabase.ts";
import { onLinkClick, useLocation } from "./lib/router.ts";
import { useSaved } from "./lib/storage.ts";
import { InfoIcon, ListIcon, PlusIcon, StarIcon } from "./components/Icons.tsx";

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
  // Static deployments (Vercel) have no server, so submissions and admin aren't available there.
  const [staticSite, setStaticSite] = useState(false);
  const showToast = useCallback((m: string) => setToast(m), []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (supabaseEnabled) return; // production: no Node server, nothing to ask
    fetch("/api/meta")
      .then((r) => r.json())
      .then((d: { mock?: boolean; staticSite?: boolean }) => {
        setMock(Boolean(d.mock));
        setStaticSite(Boolean(d.staticSite));
      })
      .catch(() => {});
  }, []);

  const isBrowse = path === "/" || path.startsWith("/e/");
  const savedView = isBrowse && new URLSearchParams(search).get("saved") === "1";

  let page: React.ReactNode;
  if (isBrowse) page = <DiscoverPage path={path} search={search} onToast={showToast} />;
  else if ((path === "/submit" && staticSite && !supabaseEnabled) || (path === "/admin" && (staticSite || !adminAvailable)))
    page = (
      <main id="main" className="narrow">
        <h1>{path === "/admin" ? "Admin" : "Suggest a hackathon"}</h1>
        <p className="sub">
          {path === "/admin"
            ? "Reviewing happens in the Supabase dashboard (Table Editor → submissions, events, eligibility) on this deployment."
            : "Online suggestions aren't available on this version of the site yet."}
        </p>
        <a className="btn" href="/" onClick={(e) => onLinkClick(e, "/")}>Browse hackathons</a>
      </main>
    );
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
          {(supabaseEnabled || !staticSite) && <NavLink to="/submit" current={path === "/submit"} className="hide-sm">Suggest an event</NavLink>}
          <NavLink to="/about" current={path === "/about"} className="hide-sm">How it works</NavLink>
        </nav>
      </header>
      {page}
      <footer className="footer">
        <span>Hackathon Digest lists only events verified to accept high school students.</span>
        <span className="spacer" />
        <a href="/about" onClick={(e) => onLinkClick(e, "/about")}>How listings are verified</a>
        {(supabaseEnabled || !staticSite) && <a href="/submit" onClick={(e) => onLinkClick(e, "/submit")}>Suggest an event</a>}
      </footer>
      {/* Phones get app-style tabs; the header nav is hidden there (see .tabbar in styles.css). */}
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" current={isBrowse && !savedView}><ListIcon size={20} /><span>Browse</span></NavLink>
        <NavLink to="/?saved=1" current={savedView}>
          <StarIcon size={20} filled={savedView} />
          <span>Saved</span>
          {saved.size > 0 && <span className="tab-badge num" aria-label={`${saved.size} saved`}>{saved.size}</span>}
        </NavLink>
        {(supabaseEnabled || !staticSite) && <NavLink to="/submit" current={path === "/submit"}><PlusIcon size={20} /><span>Suggest</span></NavLink>}
        <NavLink to="/about" current={path === "/about"}><InfoIcon size={20} /><span>About</span></NavLink>
      </nav>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
