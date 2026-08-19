/**
 * The catalogue parser, shared by the dev seed and the production import.
 * Unparseable cells are hard failures naming the cell.
 */

import { applyKindRules } from '../../server/utils/kindRules'

export interface ParsedModule {
  id: string
  department: string
  kind: 'MODULE' | 'CERTIFICATION' | 'BRIEF'
  name: string
  description: string | null
  notes: string | null
  materialsUrl: string | null
  expiryMode: 'NONE' | 'MONTHS' | 'ACADEMIC_YEAR'
  expiryMonths: number | null
  safetyCritical: boolean
  signoffRequired: boolean
  grantsSupervisor: boolean
  grantsTrainer: boolean
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED'
  sort: number
  prerequisites: string[]
  legacyCodes: string[]
}

export class CatalogueParseError extends Error {
  constructor(source: string, line: number, id: string, column: string, detail: string) {
    super(`${source} line ${line}${id ? ` (${id})` : ''}, column "${column}": ${detail}`)
    this.name = 'CatalogueParseError'
  }
}

/** Minimal RFC 4180 reader: quoted fields, escaped quotes, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // Strip a UTF-8 BOM — Excel and Google Sheets both like to add one.
  if (text.charCodeAt(0) === 0xFEFF) i = 1

  for (; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        }
        else {
          inQuotes = false
        }
      }
      else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    }
    else if (char === ',') {
      row.push(field)
      field = ''
    }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    }
    else {
      field += char
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/** Split an id list cell: "TECH-111, TECH-112" or "TECH-111 TECH-112". */
function splitIds(cell: string): string[] {
  return cell
    .split(/[,;\n]/)
    .map(part => part.trim())
    .filter(part => part.length > 0 && !/^(n\/?a|none|-)$/i.test(part))
}

const EXPIRY_NEVER = /^(never|no|none|n\/?a|-)$/i
const EXPIRY_ACADEMIC = /^academic[ -]?year$/i
const EXPIRY_MONTHS = /^(\d+)\s*months?$/i
const EXPIRY_YEARS = /^(\d+)\s*years?$/i
const EXPIRY_EXTERNAL = /^external([ -]cert(ificate)?([ -]date)?)?$/i
const EXPIRY_BRIEF = /^brief(\s*\(recurring\))?$/i

interface ExpiryResult {
  expiryMode: ParsedModule['expiryMode']
  expiryMonths: number | null
  isBrief: boolean
}

/**
 * "External cert date" maps to NONE: the module imposes no expiry because
 * each EXTERNAL record carries the certificate's own date.
 */
export function parseExpiry(raw: string): ExpiryResult | null {
  const value = raw.trim()
  if (value === '' || EXPIRY_NEVER.test(value)) {
    return { expiryMode: 'NONE', expiryMonths: null, isBrief: false }
  }
  if (EXPIRY_ACADEMIC.test(value)) {
    return { expiryMode: 'ACADEMIC_YEAR', expiryMonths: null, isBrief: false }
  }
  if (EXPIRY_BRIEF.test(value)) {
    return { expiryMode: 'NONE', expiryMonths: null, isBrief: true }
  }
  if (EXPIRY_EXTERNAL.test(value)) {
    return { expiryMode: 'NONE', expiryMonths: null, isBrief: false }
  }
  const months = value.match(EXPIRY_MONTHS)
  if (months) {
    const n = Number(months[1])
    return n > 0 ? { expiryMode: 'MONTHS', expiryMonths: n, isBrief: false } : null
  }
  const years = value.match(EXPIRY_YEARS)
  if (years) {
    const n = Number(years[1])
    return n > 0 ? { expiryMode: 'MONTHS', expiryMonths: n * 12, isBrief: false } : null
  }
  return null
}

// Certification prefixes are the subcommittee's shorthand and deliberately
// need not match a department code — the column names the department.
const MODULE_ID = /^[A-Z]{2,4}-([0-9]{3}|CERT)$/
const REQUIRED_COLUMNS = ['Department', 'ID', 'Name']

/**
 * Parse the catalogue CSV; `source` is used only in error messages.
 * Recognised columns: docs/migration.md §1
 */
export function parseCatalogue(text: string, source = 'catalogue.csv'): ParsedModule[] {
  const rows = parseCsv(text).filter(row => row.some(cell => cell.trim() !== ''))
  if (rows.length === 0) throw new Error(`${source}: file is empty`)

  const header = rows[0]!.map(h => h.trim())
  const index = new Map(header.map((h, i) => [h.toLowerCase(), i]))

  for (const required of REQUIRED_COLUMNS) {
    if (!index.has(required.toLowerCase())) {
      throw new Error(`${source}: missing required column "${required}" (found: ${header.join(', ')})`)
    }
  }

  const cell = (row: string[], column: string): string => {
    const i = index.get(column.toLowerCase())
    return i === undefined ? '' : (row[i] ?? '').trim()
  }

  const modules: ParsedModule[] = []
  const seen = new Set<string>()

  rows.slice(1).forEach((row, offset) => {
    // +2: one for the header, one for 1-based line numbers, so the number
    // matches what the spreadsheet and a text editor both show.
    const line = offset + 2
    const id = cell(row, 'ID').toUpperCase()
    if (id === '') return // blank spacer row

    if (!MODULE_ID.test(id)) {
      throw new CatalogueParseError(source, line, id, 'ID', `"${id}" is not a DEPT-LCT id or DEPT-CERT id`)
    }
    if (seen.has(id)) {
      throw new CatalogueParseError(source, line, id, 'ID', 'duplicate id')
    }
    seen.add(id)

    const isCertification = id.endsWith('-CERT')

    const department = cell(row, 'Department').toUpperCase()
    if (department === '') {
      throw new CatalogueParseError(source, line, id, 'Department', 'is empty')
    }
    // An ordinary module's id carries its department, so a mismatch is a typo.
    // Certifications take theirs from the column as given.
    if (!isCertification && !id.startsWith(`${department}-`)) {
      throw new CatalogueParseError(source, line, id, 'Department', `"${department}" does not match the id prefix`)
    }

    const name = cell(row, 'Name')
    if (name === '') {
      throw new CatalogueParseError(source, line, id, 'Name', 'is empty')
    }

    const expiryRaw = cell(row, 'Proposed Expiry')
    const expiry = parseExpiry(expiryRaw)
    if (!expiry) {
      throw new CatalogueParseError(
        source, line, id, 'Proposed Expiry',
        `unrecognised value "${expiryRaw}" (expected Never, Academic year, N months, External cert date, or Brief (recurring))`,
      )
    }

    const statusRaw = cell(row, 'Status') || 'DRAFT'
    const status = statusRaw.toUpperCase()
    if (status !== 'DRAFT' && status !== 'ACTIVE' && status !== 'RETIRED') {
      throw new CatalogueParseError(source, line, id, 'Status', `unrecognised value "${statusRaw}"`)
    }

    const materialsUrl = cell(row, 'Materials Link')
    if (materialsUrl !== '' && !/^https:\/\//i.test(materialsUrl)) {
      throw new CatalogueParseError(source, line, id, 'Materials Link', `"${materialsUrl}" is not an https:// URL`)
    }

    const grantsRaw = cell(row, 'Grants').toLowerCase()
    const grantsSupervisor = grantsRaw.includes('supervisor')
    const grantsTrainer = grantsRaw.includes('trainer')
    if (grantsRaw !== '' && !grantsSupervisor && !grantsTrainer) {
      throw new CatalogueParseError(source, line, id, 'Grants', `unrecognised value "${grantsRaw}" (expected supervisor and/or trainer)`)
    }

    const safetyRaw = cell(row, 'Safety Critical').toLowerCase()
    if (safetyRaw !== '' && !/^(yes|no|true|false|y|n|1|0)$/.test(safetyRaw)) {
      throw new CatalogueParseError(source, line, id, 'Safety Critical', `unrecognised value "${safetyRaw}" (expected yes or no)`)
    }
    const safetyCritical = /^(yes|true|y|1)$/.test(safetyRaw)

    // Kind is derived from the id and the expiry column — the subcommittee's
    // own convention (ADR-0003), so there is nothing extra for them to fill in.
    const kind = isCertification ? 'CERTIFICATION' : expiry.isBrief ? 'BRIEF' : 'MODULE'

    // Only a certification confers standing: grants_trainer on an ordinary
    // module would make every attendee a trainer (ADR-0004).
    if (kind !== 'CERTIFICATION' && (grantsSupervisor || grantsTrainer)) {
      throw new CatalogueParseError(source, line, id, 'Grants', 'only certifications confer standing')
    }

    modules.push(applyKindRules({
      id,
      department,
      kind,
      name,
      description: cell(row, 'Description') || null,
      notes: cell(row, 'Notes') || null,
      materialsUrl: materialsUrl || null,
      expiryMode: expiry.expiryMode,
      expiryMonths: expiry.expiryMonths,
      safetyCritical,
      grantsSupervisor,
      grantsTrainer,
      status: status as ParsedModule['status'],
      sort: modules.length,
      prerequisites: splitIds(cell(row, 'Prerequisites')).map(p => p.toUpperCase()),
      legacyCodes: splitIds(cell(row, 'Old Module(s)')),
    }))
  })

  // Prerequisites must resolve within the catalogue — a dangling reference
  // would fail at insert time with a far less helpful message.
  const ids = new Set(modules.map(m => m.id))
  for (const module of modules) {
    for (const prerequisite of module.prerequisites) {
      if (!ids.has(prerequisite)) {
        throw new Error(`${source}: ${module.id} lists unknown prerequisite "${prerequisite}"`)
      }
      if (prerequisite === module.id) {
        throw new Error(`${source}: ${module.id} lists itself as a prerequisite`)
      }
    }
  }

  return modules
}
