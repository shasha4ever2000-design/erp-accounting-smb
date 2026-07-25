import { useState, useMemo } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { useAuth } from '../auth'
import { fmtMoney, fmtDate, tone } from '../utils/formatters'
import { PageHeader, Card, Btn, Modal, Badge, EmptyState, Table, Tr, Td, StatCard } from '../components/UI'
import { canApprove, describeRequest, APPROVAL_KINDS } from '../utils/approvals'
import { ShieldCheck, Check, X, Clock, Undo2, FileText, BookOpen } from 'lucide-react'

const KIND_ICON = { purchase: FileText, journal: BookOpen, payment: FileText }

const STATUS = {
  pending:  { cls: tone.warning, label: 'Awaiting approval' },
  approved: { cls: tone.success, label: 'Approved' },
  rejected: { cls: tone.danger,  label: 'Rejected' },
}

export default function Approvals() {
  const t = useT()
  const { approvalRequests, settings, approveRequest, rejectRequest, withdrawRequest } = useStore()
  const sym = settings.company.currencySymbol
  const approvals = settings.approvals || {}
  const me = useAuth((s) => s.currentUser())
  const users = useAuth((s) => s.users)

  const [tab, setTab] = useState('pending')
  const [detail, setDetail] = useState(null)

  const rows = useMemo(
    () => (approvalRequests || [])
      .filter((r) => (tab === 'all' ? true : r.status === tab))
      .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt))),
    [approvalRequests, tab]
  )

  const pending = (approvalRequests || []).filter((r) => r.status === 'pending')
  const pendingValue = pending.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const mineToDecide = pending.filter((r) => canApprove(r, me, approvals, users).ok)

  const decide = (req, action) => {
    const check = canApprove(req, me, approvals, users)
    if (!check.ok) return alert(t(check.reason))
    if (action === 'approve') {
      if (!confirm(t('Approve this request? It will post to the ledger immediately.'))) return
      try {
        approveRequest(req.id)
      } catch (e) {
        return alert(t('Could not approve') + ': ' + String(e.message || e).replace(/^APPROVAL_\w+:/, ''))
      }
    } else {
      const reason = prompt(t('Reason for rejection (optional):')) ?? ''
      try { rejectRequest(req.id, reason) } catch (e) { return alert(String(e.message || e)) }
    }
    setDetail(null)
  }

  const TabBtn = ({ id, label, count }) => (
    <button onClick={() => setTab(id)}
      className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        tab === id ? 'bg-brand-600 text-white shadow-card' : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-surface-750'
      }`}>
      {label}{count > 0 && <span className={`ms-1.5 text-xs ${tab === id ? 'opacity-80' : 'text-gray-400 dark:text-slate-500'}`}>{count}</span>}
    </button>
  )

  return (
    <div>
      <PageHeader title="Approvals" subtitle="Documents held for a second pair of eyes before they reach the ledger" />

      {!approvals.enabled && (
        <Card className="p-4 mb-6 flex items-start gap-3 bg-warning-50/60 dark:bg-warning-500/[0.08] ring-1 ring-inset ring-warning-500/20">
          <Clock size={18} className="text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-warning-800 dark:text-warning-200">
            {t('Approval thresholds are switched off. Turn them on in Settings → Approvals to hold large bills and journal entries for review.')}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Awaiting approval" value={String(pending.length)} icon={<Clock size={18} />} color="amber" />
        <StatCard label="Value held" value={fmtMoney(pendingValue, sym)} icon={<ShieldCheck size={18} />} color="blue" />
        <StatCard label="Waiting on you" value={String(mineToDecide.length)} icon={<Check size={18} />} color={mineToDecide.length ? 'green' : 'blue'} />
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-surface-750 flex flex-wrap gap-1.5">
          <TabBtn id="pending"  label={t('Pending')}  count={pending.length} />
          <TabBtn id="approved" label={t('Approved')} count={0} />
          <TabBtn id="rejected" label={t('Rejected')} count={0} />
          <TabBtn id="all"      label={t('All')}      count={0} />
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<ShieldCheck size={28} className="text-slate-400 dark:text-slate-500" />} title="Nothing here"
            desc="Documents above the configured threshold appear here until an owner or admin decides on them." />
        ) : (
          <Table headers={['Submitted', 'Type', 'Detail', 'Submitted by', { label: 'Amount', right: true }, 'Status', '']}>
            {rows.map((r) => {
              const Icon = KIND_ICON[r.kind] || FileText
              const st = STATUS[r.status] || STATUS.pending
              const allowed = canApprove(r, me, approvals, users)
              const isMine = r.submittedBy && r.submittedBy === me?.id
              return (
                <Tr key={r.id}>
                  <Td>{fmtDate(r.submittedAt)}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5 text-gray-700 dark:text-slate-200">
                      <Icon size={14} className="text-gray-400 dark:text-slate-500" />
                      {t(APPROVAL_KINDS[r.kind]?.label || r.kind)}
                    </span>
                  </Td>
                  <Td>
                    <button onClick={() => setDetail(r)} className="text-brand-600 dark:text-brand-400 hover:underline text-start">
                      {describeRequest(r)}
                    </button>
                    {r.resultRef && <span className="ms-2 text-xs text-gray-400 dark:text-slate-500">→ {r.resultRef}</span>}
                  </Td>
                  <Td>{r.submittedByName}</Td>
                  <Td right className="tabular-nums">{fmtMoney(r.amount, sym)}</Td>
                  <Td><Badge className={st.cls}>{t(st.label)}</Badge></Td>
                  <Td>
                    {r.status === 'pending' && (
                      <div className="flex items-center gap-1.5 justify-end">
                        {allowed.ok ? (
                          <>
                            <Btn size="sm" onClick={() => decide(r, 'approve')}><Check size={14} /> {t('Approve')}</Btn>
                            <Btn size="sm" variant="secondary" onClick={() => decide(r, 'reject')}><X size={14} /> {t('Reject')}</Btn>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-slate-500">{t(allowed.reason)}</span>
                        )}
                        {isMine && (
                          <button onClick={() => { if (confirm(t('Withdraw this request?'))) withdrawRequest(r.id) }}
                            title={t('Withdraw')} className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors">
                            <Undo2 size={14} />
                          </button>
                        )}
                      </div>
                    )}
                    {r.status !== 'pending' && (
                      <span className="text-xs text-gray-400 dark:text-slate-500">
                        {r.decidedByName} · {fmtDate(r.decidedAt)}
                      </span>
                    )}
                  </Td>
                </Tr>
              )
            })}
          </Table>
        )}
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={t('Request detail')}>
        {detail && <RequestDetail req={detail} sym={sym} t={t} />}
      </Modal>
    </div>
  )
}

/** Read-only rendering of the parked payload, so an approver sees what they are signing off. */
function RequestDetail({ req, sym, t }) {
  const p = req.payload || {}
  const Row = ({ k, v }) => (
    <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-gray-100 dark:border-surface-750 last:border-0">
      <span className="text-gray-500 dark:text-slate-400">{k}</span>
      <span className="text-gray-800 dark:text-slate-100 text-end">{v}</span>
    </div>
  )
  return (
    <div className="space-y-4">
      <div>
        <Row k={t('Submitted by')} v={`${req.submittedByName} · ${fmtDate(req.submittedAt)}`} />
        <Row k={t('Amount')} v={fmtMoney(req.amount, sym)} />
        {p.date && <Row k={t('Date')} v={fmtDate(p.date)} />}
        {p.description && <Row k={t('Description')} v={p.description} />}
        {p.supplierName && <Row k={t('Supplier')} v={p.supplierName} />}
        {p.reference && <Row k={t('Reference')} v={p.reference} />}
        {req.decidedAt && <Row k={t('Decided')} v={`${req.decidedByName} · ${fmtDate(req.decidedAt)}`} />}
        {req.decisionReason && <Row k={t('Reason')} v={req.decisionReason} />}
      </div>

      {Array.isArray(p.items) && p.items.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-1.5">{t('Lines')}</h4>
          {p.items.map((l, i) => (
            <div key={i} className="flex justify-between gap-4 py-1 text-sm">
              <span className="text-gray-700 dark:text-slate-200">{l.description || l.name} <span className="text-gray-400 dark:text-slate-500">× {l.quantity}</span></span>
              <span className="tabular-nums text-gray-800 dark:text-slate-100">{fmtMoney(l.subtotal, sym)}</span>
            </div>
          ))}
        </div>
      )}

      {Array.isArray(p.lines) && p.lines.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-1.5">{t('Journal lines')}</h4>
          {p.lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-4 py-1 text-sm">
              <span className="text-gray-700 dark:text-slate-200">{l.description || l.accountId}</span>
              <span className="tabular-nums text-gray-800 dark:text-slate-100">
                {l.debit ? `Dr ${fmtMoney(l.debit, sym)}` : `Cr ${fmtMoney(l.credit, sym)}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
