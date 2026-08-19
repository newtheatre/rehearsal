/**
 * The catalogue parser, and mostly what it does with bad input: a silently
 * skipped row is a module nobody notices is missing.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCatalogue, parseCsv, parseExpiry, CatalogueParseError } from '../scripts/lib/catalogue'

const header = 'Department,ID,Name,Description,Prerequisites,Old Module(s),Proposed Expiry,Materials Link,Safety Critical,Grants,Status,Notes'
const csv = (...rows: string[]) => [header, ...rows].join('\n')

describe('parseCsv', () => {
  it('handles quoted fields, embedded commas and escaped quotes', () => {
    const rows = parseCsv('a,b\n"one, two","he said ""hi"""')
    expect(rows[1]).toEqual(['one, two', 'he said "hi"'])
  })

  it('strips a BOM and handles CRLF', () => {
    const rows = parseCsv('﻿a,b\r\n1,2\r\n')
    expect(rows[0]).toEqual(['a', 'b'])
    expect(rows[1]).toEqual(['1', '2'])
  })
})

describe('parseExpiry', () => {
  it('maps the spreadsheet vocabulary', () => {
    expect(parseExpiry('Never')).toMatchObject({ expiryMode: 'NONE' })
    expect(parseExpiry('')).toMatchObject({ expiryMode: 'NONE' })
    expect(parseExpiry('Academic year')).toMatchObject({ expiryMode: 'ACADEMIC_YEAR' })
    expect(parseExpiry('36 months')).toMatchObject({ expiryMode: 'MONTHS', expiryMonths: 36 })
    expect(parseExpiry('3 years')).toMatchObject({ expiryMode: 'MONTHS', expiryMonths: 36 })
    expect(parseExpiry('Brief (recurring)')).toMatchObject({ isBrief: true })
  })

  it('maps an external certificate to no module-level expiry', () => {
    // Each EXTERNAL record carries the certificate's own date instead.
    expect(parseExpiry('External cert date')).toMatchObject({ expiryMode: 'NONE' })
  })

  it('returns null for anything it does not understand', () => {
    expect(parseExpiry('sometimes')).toBeNull()
    expect(parseExpiry('0 months')).toBeNull()
  })
})

describe('parseCatalogue, hard failures', () => {
  it('names the row and column for an unrecognised expiry', () => {
    const input = csv('TECH,TECH-111,Rigging,,,,sometimes,,,,,')
    expect(() => parseCatalogue(input, 'catalogue.csv')).toThrow(CatalogueParseError)
    expect(() => parseCatalogue(input, 'catalogue.csv'))
      .toThrow(/line 2 \(TECH-111\), column "Proposed Expiry": unrecognised value "sometimes"/)
  })

  it('rejects a malformed id', () => {
    expect(() => parseCatalogue(csv('TECH,TECH111,Rigging,,,,Never,,,,,')))
      .toThrow(/column "ID"/)
  })

  it('rejects a missing name', () => {
    expect(() => parseCatalogue(csv('TECH,TECH-111,,,,,Never,,,,,')))
      .toThrow(/column "Name": is empty/)
  })

  it('rejects a department that contradicts the id', () => {
    expect(() => parseCatalogue(csv('NNT,TECH-111,Rigging,,,,Never,,,,,')))
      .toThrow(/column "Department"/)
  })

  it('rejects a duplicate id', () => {
    expect(() => parseCatalogue(csv(
      'TECH,TECH-111,Rigging,,,,Never,,,,,',
      'TECH,TECH-111,Rigging again,,,,Never,,,,,',
    ))).toThrow(/duplicate id/)
  })

  it('rejects a non-https materials link', () => {
    expect(() => parseCatalogue(csv('TECH,TECH-111,Rigging,,,,Never,http://drive.example,,,,')))
      .toThrow(/column "Materials Link"/)
  })

  it('rejects an unknown prerequisite rather than storing a dangling reference', () => {
    expect(() => parseCatalogue(csv('TECH,TECH-211,Design,,TECH-999,,Never,,,,,')))
      .toThrow(/unknown prerequisite "TECH-999"/)
  })

  it('rejects a self-prerequisite', () => {
    expect(() => parseCatalogue(csv('TECH,TECH-211,Design,,TECH-211,,Never,,,,,')))
      .toThrow(/itself as a prerequisite/)
  })

  it('rejects a brief that claims to confer standing', () => {
    expect(() => parseCatalogue(csv('NNT,NNT-002,Get-In Brief,,,,Brief (recurring),,,trainer,,')))
      .toThrow(/only certifications confer standing/)
  })

  it('rejects an ordinary module that claims to confer standing', () => {
    // grants_trainer here would make every attendee of a routine session a
    // trainer, with no sign-off (ADR-0004).
    expect(() => parseCatalogue(csv('LEAD,LEAD-301,Deliver a Workshop,,,,Never,,,trainer,,')))
      .toThrow(/only certifications confer standing/)
  })

  it('rejects a missing required column outright', () => {
    expect(() => parseCatalogue('ID,Name\nTECH-111,Rigging')).toThrow(/missing required column "Department"/)
  })
})

describe('parseCatalogue, derivation', () => {
  it('derives kind from the id and the expiry column', () => {
    const modules = parseCatalogue(csv(
      'TECH,TECH-111,Rigging,,,,Never,,,,,',
      'NNT,NNT-002,Get-In Brief,,,,Brief (recurring),,,,,',
      'TECH,LD-CERT,Lighting Designer,,TECH-111,,Never,,,supervisor,,',
    ))

    expect(modules.map(m => m.kind)).toEqual(['MODULE', 'BRIEF', 'CERTIFICATION'])
    expect(modules[2]!.signoffRequired).toBe(true)
    expect(modules[2]!.grantsSupervisor).toBe(true)
    expect(modules[0]!.signoffRequired).toBe(false)
  })

  it('lets a certification sit in a department its id does not name', () => {
    const [cert] = parseCatalogue(csv('TECH,LD-CERT,Lighting Designer,,,,Never,,,supervisor,,'))
    expect(cert!.department).toBe('TECH')
  })

  it('defaults status to DRAFT so nothing is published by accident', () => {
    const [module] = parseCatalogue(csv('TECH,TECH-111,Rigging,,,,Never,,,,,'))
    expect(module!.status).toBe('DRAFT')
  })

  it('splits prerequisite and legacy lists', () => {
    const modules = parseCatalogue(csv(
      'TECH,TECH-111,Rigging,,,,Never,,,,,',
      'TECH,TECH-112,Desk,,,,Never,,,,,',
      'TECH,TECH-211,Design,,"TECH-111, TECH-112","1.06; 1.07",Never,,,,,',
    ))
    expect(modules[2]!.prerequisites).toEqual(['TECH-111', 'TECH-112'])
    expect(modules[2]!.legacyCodes).toEqual(['1.06', '1.07'])
  })

  it('treats "none" and "n/a" in a list cell as empty', () => {
    const [module] = parseCatalogue(csv('TECH,TECH-111,Rigging,,None,N/A,Never,,,,,'))
    expect(module!.prerequisites).toEqual([])
    expect(module!.legacyCodes).toEqual([])
  })
})

describe('the committed catalogue', () => {
  it('parses, and is entirely DRAFT pending subcommittee ratification', () => {
    const path = join(import.meta.dirname, '../data/catalogue.csv')
    const modules = parseCatalogue(readFileSync(path, 'utf8'), path)

    expect(modules).toHaveLength(57)
    // The source document is a draft for review; nothing is member-visible
    // until the subcommittee ratifies it module by module.
    expect(modules.every(m => m.status === 'DRAFT')).toBe(true)
  })

  it('marks only the modules the draft marks safety-critical', () => {
    const path = join(import.meta.dirname, '../data/catalogue.csv')
    const modules = parseCatalogue(readFileSync(path, 'utf8'), path)

    // This flag turns a prerequisite warning into a hard block, so it must
    // mirror the ⚠ markers in the document and nothing else.
    expect(modules.filter(m => m.safetyCritical).map(m => m.id).sort()).toEqual([
      'MGMT-201', 'SFTY-012', 'SFTY-021', 'SFTY-022', 'STGE-201', 'TECH-201',
    ])
  })

  it('has exactly one certification that confers trainer standing', () => {
    const path = join(import.meta.dirname, '../data/catalogue.csv')
    const modules = parseCatalogue(readFileSync(path, 'utf8'), path)

    const trainers = modules.filter(m => m.grantsTrainer)
    expect(trainers.map(m => m.id)).toEqual(['LEAD-CERT'])
    expect(trainers[0]!.kind).toBe('CERTIFICATION')

    // The other seven confer supervisor standing in their own department.
    expect(modules.filter(m => m.grantsSupervisor).map(m => m.id).sort()).toEqual([
      'AV-CERT', 'COST-CERT', 'LD-CERT', 'PROD-CERT', 'SET-CERT', 'SM-CERT', 'SND-CERT',
    ])
  })

  it('leaves the subcommittee open questions unanswered', () => {
    const path = join(import.meta.dirname, '../data/catalogue.csv')
    const modules = parseCatalogue(readFileSync(path, 'utf8'), path)

    // The draft flags this as a call for the subcommittee because it lengthens
    // the path to lighting, so it must not be quietly made here.
    const lighting = modules.find(m => m.id === 'TECH-111')!
    expect(lighting.prerequisites).not.toContain('SFTY-012')
  })
})
