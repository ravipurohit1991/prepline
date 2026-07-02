import { NavLink, Outlet } from 'react-router-dom';

export function AppShell() {
  return (
    <>
      <header className="shell-header">
        <NavLink to="/" className="brand">
          <img src="/prepline.svg" alt="" className="brand-mark" />
          <span className="brand-name">Prepline</span>
        </NavLink>
        <nav className="shell-nav" aria-label="Main">
          <NavLink to="/" end>
            Library
          </NavLink>
          <NavLink to="/meals">Meals</NavLink>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
