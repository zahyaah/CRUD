import { NavLink, Outlet } from "react-router-dom";

const links = [
  { to: "/", label: "Inventory", end: true },
  { to: "/new", label: "Add product", end: false },
  { to: "/lab", label: "Concurrency lab", end: false },
];

export function App() {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="masthead">
        <div className="masthead__brand">
          <span className="masthead__mark" aria-hidden="true" />
          <span className="masthead__name">Warehouse</span>
        </div>

        <nav aria-label="Primary">
          <ul className="nav">
            {links.map(({ to, label, end }) => (
              <li key={to}>
                <NavLink to={to} end={end} className="nav__link">
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main id="main" className="main">
        <Outlet />
      </main>
    </div>
  );
}
