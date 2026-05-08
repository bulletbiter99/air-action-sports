// M4 B12a — legacy AdminDashboardLegacy + flag-gated dispatcher removed.
// The persona-tailored shell (src/admin/AdminDashboardPersona.jsx, shipped
// in M3 B9 + completed across M4 B4a-B4f) is now the sole production path.
// The new_admin_dashboard flag has been at state='on' since M4 B9; the
// dispatcher branch was unreachable.
export { default } from './AdminDashboardPersona';
