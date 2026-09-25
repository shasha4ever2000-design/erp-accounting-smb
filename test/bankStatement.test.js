import { describe, it, expect } from 'vitest'
import { detectFormat, parseStatement, parseOFX, parseCAMT, parseMT940, parseCSVStatement, matchToLedger, suggestDocument } from '../src/utils/bankStatement'

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>SAR
<BANKTRANLIST>
<DTSTART>20260901
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260903120000[+3:AST]
<TRNAMT>1150.00
<FITID>A1
<NAME>AL NOOR TRADING
<MEMO>INV-0012
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260905
<TRNAMT>-230,50
<FITID>A2
<NAME>STC BILL
</BANKTRANLIST>
<LEDGERBAL><BALAMT>10919.50<DTASOF>20260930</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

const OFX_XML = `<?xml version="1.0"?><?OFX OFXHEADER="200"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD</CURDEF><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260110</DTPOSTED><TRNAMT>-42.10</TRNAMT><FITID>X9</FITID><NAME>Office &amp; Co</NAME></STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>500.00</BALAMT></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
<BkToCstmrStmt><Stmt>
<Acct><Ccy>EUR</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1025.25</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Ntry><Amt Ccy="EUR">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-09-02</Dt></BookgDt><AcctSvcrRef>R1</AcctSvcrRef>
<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Muster GmbH</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Invoice INV-0040</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">74.75</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><DtTm>2026-09-04T10:00:00</DtTm></BookgDt>
<NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Telekom</Nm></Cdtr></RltdPties></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`

const MT940 = `{1:F01BANKSARIXXX0000000000}{2:I940BANKSARIXXXXN}{4:
:20:STMT0930
:25:SA0380000000608010167519
:28C:00001/001
:60F:C260901SAR1000,00
:61:2609030903C1150,00NTRFINV-0012//B1
:86:?20INV-0012 PAYMENT?32AL NOOR TRADING
:61:260905D230,50NMSCNONREF//B2
:86:STC MONTHLY BILL
:62F:C260930SAR1919,50
-}`

describe('bank statement formats', () => {
  it('detects each format from its content', () => {
    expect(detectFormat(OFX_SGML)).toBe('ofx')
    expect(detectFormat(OFX_XML)).toBe('ofx')
    expect(detectFormat(CAMT)).toBe('camt')
    expect(detectFormat(MT940)).toBe('mt940')
    expect(detectFormat('Date,Description,Amount\n2026-01-01,x,1')).toBe('csv')
  })

  it('reads SGML OFX with open tags, comma decimals and the ledger balance', () => {
    const r = parseOFX(OFX_SGML)
    expect(r.currency).toBe('SAR')
    expect(r.closingBalance).toBe(10919.5)
    expect(r.lines).toEqual([
      { date: '2026-09-03', desc: 'AL NOOR TRADING — INV-0012', amount: 1150, ref: 'A1' },
      { date: '2026-09-05', desc: 'STC BILL', amount: -230.5, ref: 'A2' },
    ])
  })

  it('reads XML OFX and decodes entities', () => {
    const r = parseOFX(OFX_XML)
    expect(r.lines).toEqual([{ date: '2026-01-10', desc: 'Office & Co', amount: -42.1, ref: 'X9' }])
    expect(r.closingBalance).toBe(500)
  })

  it('reads CAMT.053 with signs, parties, remittance text and the closing balance', () => {
    const r = parseCAMT(CAMT)
    expect(r.currency).toBe('EUR')
    expect(r.closingBalance).toBe(1025.25)
    expect(r.lines).toEqual([
      { date: '2026-09-02', desc: 'Muster GmbH — Invoice INV-0040', amount: 1000, ref: 'R1' },
      { date: '2026-09-04', desc: 'Telekom', amount: -74.75, ref: '' },
    ])
  })

  it('reads CAMT with namespace prefixes', () => {
    const prefixed = CAMT.replace(/<(\/?)(?!\?)/g, '<$1ns2:').replace(/<ns2:\/?\?/g, (m) => m.replace('ns2:', ''))
    expect(parseCAMT(prefixed).lines).toHaveLength(2)
  })

  it('reads MT940 with structured :86: and the closing balance', () => {
    const r = parseMT940(MT940)
    expect(r.currency).toBe('SAR')
    expect(r.closingBalance).toBe(1919.5)
    expect(r.lines[0]).toMatchObject({ date: '2026-09-03', amount: 1150, desc: 'AL NOOR TRADING — INV-0012 PAYMENT', ref: 'INV-0012' })
    expect(r.lines[1]).toMatchObject({ date: '2026-09-05', amount: -230.5, desc: 'STC MONTHLY BILL', ref: 'B2' })
  })

  it('reads CSV with debit/credit columns and European numbers', () => {
    const r = parseCSVStatement('Date,Details,Debit,Credit\n03/09/2026,Rent,"1.500,00",\n04/09/2026,Sale,,250.00')
    expect(r.lines).toEqual([
      { date: '2026-09-03', desc: 'Rent', amount: -1500, ref: '' },
      { date: '2026-09-04', desc: 'Sale', amount: 250, ref: '' },
    ])
  })

  it('refuses a file with no transactions', () => {
    expect(() => parseStatement('<OFX></OFX>', 'x.ofx')).toThrow('NO_LINES')
  })
})

describe('matching statement lines', () => {
  const movements = [
    { id: 'je1', date: '2026-09-01', amount: 1150, ref: 'RCT-0001' },
    { id: 'je2', date: '2026-09-04', amount: 1150, ref: 'RCT-0002' },
    { id: 'je3', date: '2026-08-01', amount: -230.5, ref: 'PAY-0001' },
  ]

  it('prefers the closest date among equal amounts, uses each entry once', () => {
    const { matched, unmatched } = matchToLedger(
      [{ date: '2026-09-03', desc: 'x', amount: 1150 }, { date: '2026-09-03', desc: 'y', amount: 1150 }],
      movements)
    expect(matched.map((m) => m.jeId)).toEqual(['je2', 'je1'])
    expect(unmatched).toHaveLength(0)
  })

  it('prefers a movement whose reference is in the narrative', () => {
    const { matched } = matchToLedger([{ date: '2026-09-04', desc: 'receipt rct 0001', amount: 1150 }], movements)
    expect(matched[0].jeId).toBe('je1')
  })

  it('ignores cleared entries and dates outside the window', () => {
    const { matched, unmatched } = matchToLedger(
      [{ date: '2026-09-05', desc: '', amount: -230.5 }, { date: '2026-09-04', desc: '', amount: 1150 }],
      movements, { isCleared: (id) => id === 'je2' })
    expect(unmatched).toHaveLength(1)
    expect(matched[0].jeId).toBe('je1')
  })

  const books = {
    invoices: [
      { id: 'i1', number: 'INV-0012', customerId: 'c1', total: 1150, amountPaid: 0, status: 'sent', date: '2026-08-01' },
      { id: 'i2', number: 'INV-0013', customerId: 'c2', total: 500, amountPaid: 0, status: 'sent', date: '2026-08-02' },
      { id: 'i3', number: 'INV-0014', customerId: 'c3', total: 500, amountPaid: 0, status: 'sent', date: '2026-08-03' },
      { id: 'i4', number: 'INV-0015', customerId: 'c1', total: 800, amountPaid: 0, status: 'void' },
    ],
    purchases: [{ id: 'p1', number: 'BILL-7', supplierId: 's1', total: 230.5, amountPaid: 0, status: 'received', date: '2026-08-01' }],
    customers: [{ id: 'c1', name: 'Al Noor Trading' }, { id: 'c2', name: 'Beta' }, { id: 'c3', name: 'Gamma Co' }],
    suppliers: [{ id: 's1', name: 'STC' }],
    due: (d) => d.total - d.amountPaid,
  }

  it('suggests the invoice named in the narrative', () => {
    const s = suggestDocument({ amount: 1150, desc: 'transfer inv0012' }, books)
    expect(s).toMatchObject({ kind: 'invoice', reason: 'number', amount: 1150 })
    expect(s.doc.id).toBe('i1')
  })

  it('suggests by customer name, and caps a part payment at what is due', () => {
    const s = suggestDocument({ amount: 400, desc: 'AL NOOR TRADING LLC' }, books)
    expect(s.doc.id).toBe('i1')
    expect(s.amount).toBe(400)
  })

  it('matches on amount alone only when exactly one bill fits', () => {
    expect(suggestDocument({ amount: -230.5, desc: 'card' }, books)?.doc.id).toBe('p1')
    expect(suggestDocument({ amount: 500, desc: 'transfer' }, books)).toBeNull()
  })

  it('never suggests void documents or more than is due', () => {
    expect(suggestDocument({ amount: 800, desc: 'INV-0015' }, books)).toBeNull()
    expect(suggestDocument({ amount: 5000, desc: 'INV-0012' }, books)).toBeNull()
  })
})
