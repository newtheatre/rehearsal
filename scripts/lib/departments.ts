/**
 * The nine departments — the DEPT half of the `DEPT-LCT` id scheme, so they
 * live in code while the modules live in the CSV.
 */
export const DEPARTMENTS = [
  { code: 'NNT', name: 'Whole Theatre', sort: 1 },
  { code: 'SFTY', name: 'Safety', sort: 2 },
  { code: 'TECH', name: 'Technical', sort: 3 },
  { code: 'STGE', name: 'Stage, Set & Workshop', sort: 4 },
  { code: 'MGMT', name: 'Stage Management', sort: 5 },
  { code: 'COST', name: 'Costume', sort: 6 },
  { code: 'PROD', name: 'Producing', sort: 7 },
  { code: 'ADMN', name: 'Administration & FOH', sort: 8 },
  { code: 'LEAD', name: 'Leadership & Training', sort: 9 },
] as const
