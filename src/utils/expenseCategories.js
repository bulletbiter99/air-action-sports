// Canonical expense categories — client mirror of the list in
// worker/routes/admin/finances.js. Keep the key set in sync between the two
// (the route validates against its copy; this drives the UI dropdowns).

export const EXPENSE_CATEGORIES = [
    { key: 'field_rent', label: 'Field / Rent' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'consumables', label: 'Consumables' },
    { key: 'equipment', label: 'Equipment' },
    { key: 'marketing', label: 'Marketing' },
    { key: 'insurance', label: 'Insurance' },
    { key: 'software', label: 'Software' },
    { key: 'utilities', label: 'Utilities' },
    { key: 'taxes', label: 'Taxes' },
    { key: 'other', label: 'Other' },
];

const LABELS = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, c.label]));

export function categoryLabel(key) {
    return LABELS[key] || key || '—';
}
