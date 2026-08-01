import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../store'
import { useAuth } from '../auth'
import { useT } from '../i18n'
import { Card, Btn, Input, Select } from './UI'
import {
  Cloud, CloudOff, RefreshCw, Users, Mail, X, Crown, Shield, Eye, LogOut, Link2, Unlink, CheckCircle2, AlertTriangle,
} from 'lucide-react'

const ROLE_ICON = { owner: Crown, admin: Shield, member: Users, viewer: Eye }

export default function CloudSyncCard() {
  const t = useT()
  const { companies, currentCompanyId, linkCompanyCloud, unlinkCompanyCloud } = useAuth()
  const company = companies.find((c) => c.id === currentCompanyId)
  const syncStatus = useStore((s) => s.syncStatus)
  const lastSyncAt = useStore((s) => s.lastSyncAt)
  const lastSyncError = useStore((s) => s.lastSyncError)

  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Sign-in / sign-up / forgot-password form
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const [signupSent, setSignupSent] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  // Set when Supabase redirects the user back with a one-time recovery
  // session (after they click the link from a reset email), independent of
  // an ordinary signed-in session — the user needs to pick a new password
  // before they can do anything else.
  const [recovering, setRecovering] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [resetDone, setResetDone] = useState(false)

  // Company linking
  const [myCloudCompanies, setMyCloudCompanies] = useState([])
  const [myInvites, setMyInvites] = useState([])
  const [newCloudName, setNewCloudName] = useState(company?.name || '')

  // Linked-company panel
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')

  const refreshCloudState = useCallback(async (sess) => {
    if (!sess) return
    const cloudAuth = await import('../cloudAuth')
    if (company?.cloudCompanyId) {
      const [mRes, iRes] = await Promise.all([
        cloudAuth.listCompanyMembers(company.cloudCompanyId),
        cloudAuth.listPendingInvites(company.cloudCompanyId),
      ])
      if (mRes.ok) setMembers(mRes.members)
      if (iRes.ok) setInvites(iRes.invites)
    } else {
      const [cRes, invRes] = await Promise.all([cloudAuth.listMyCloudCompanies(), cloudAuth.myPendingInvites()])
      if (cRes.ok) setMyCloudCompanies(cRes.companies)
      if (invRes.ok) setMyInvites(invRes.invites)
    }
  }, [company?.cloudCompanyId])

  useEffect(() => {
    let unsub = () => {}
    ;(async () => {
      const cloudAuth = await import('../cloudAuth')
      const sess = await cloudAuth.getCloudSession()
      setSession(sess)
      setLoading(false)
      if (sess) refreshCloudState(sess)
      unsub = cloudAuth.onCloudAuthChange((s, event) => {
        if (event === 'PASSWORD_RECOVERY') { setRecovering(true); return }
        setSession(s)
        if (s) refreshCloudState(s)
      })
    })()
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (session) refreshCloudState(session) }, [session, refreshCloudState])

  const myRole = session ? members.find((m) => m.user_id === session.user.id)?.role : null
  const canManage = ['owner', 'admin'].includes(myRole)

  const handleAuth = async () => {
    setErr(''); setBusy(true)
    const cloudAuth = await import('../cloudAuth')
    if (mode === 'forgot') {
      const res = await cloudAuth.cloudResetPassword(form.email)
      setBusy(false)
      if (res.error) { setErr(res.error); return }
      setResetSent(true)
      return
    }
    const res = mode === 'signup'
      ? await cloudAuth.cloudSignUp(form)
      : await cloudAuth.cloudSignIn(form)
    setBusy(false)
    if (res.error) { setErr(res.error); return }
    if (mode === 'signup' && res.needsEmailConfirm) { setSignupSent(true); return }
    const sess = await cloudAuth.getCloudSession()
    setSession(sess)
  }

  const handleSetNewPassword = async () => {
    setErr(''); setBusy(true)
    const cloudAuth = await import('../cloudAuth')
    const res = await cloudAuth.cloudUpdatePassword(newPassword)
    setBusy(false)
    if (res.error) { setErr(res.error); return }
    setNewPassword('')
    setResetDone(true)
    setRecovering(false)
    const sess = await cloudAuth.getCloudSession()
    setSession(sess)
  }

  const handleSignOut = async () => {
    const cloudAuth = await import('../cloudAuth')
    await cloudAuth.cloudSignOut()
    setSession(null); setMembers([]); setInvites([]); setMyCloudCompanies([]); setMyInvites([])
  }

  const handleCreateCloudCompany = async () => {
    setBusy(true); setErr('')
    const cloudAuth = await import('../cloudAuth')
    const res = await cloudAuth.createCloudCompany(newCloudName || company.name)
    setBusy(false)
    if (res.error) return setErr(res.error)
    linkCompanyCloud(company.id, res.company.id)
    await useStore.getState().syncNow()
  }

  const handleLinkExisting = async (cloudCompanyId) => {
    linkCompanyCloud(company.id, cloudCompanyId)
    await useStore.getState().syncNow()
  }

  const handleAcceptInvite = async (token, cloudCompanyId) => {
    setBusy(true); setErr('')
    const cloudAuth = await import('../cloudAuth')
    const res = await cloudAuth.acceptInvite(token)
    setBusy(false)
    if (res.error) return setErr(res.error)
    if (!company.cloudCompanyId) linkCompanyCloud(company.id, cloudCompanyId)
    refreshCloudState(session)
  }

  const handleUnlink = () => {
    if (!confirm(t('Stop syncing this company to the cloud? Your local data is unaffected — you can re-link anytime.'))) return
    unlinkCompanyCloud(company.id)
  }

  const handleSyncNow = () => useStore.getState().syncNow()

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setBusy(true); setErr('')
    const cloudAuth = await import('../cloudAuth')
    const res = await cloudAuth.inviteMember(company.cloudCompanyId, inviteEmail, inviteRole)
    setBusy(false)
    if (res.error) return setErr(res.error)
    setInviteEmail('')
    refreshCloudState(session)
  }

  const handleCancelInvite = async (id) => {
    const cloudAuth = await import('../cloudAuth')
    await cloudAuth.cancelInvite(id)
    refreshCloudState(session)
  }

  const handleRoleChange = async (userId, role) => {
    const cloudAuth = await import('../cloudAuth')
    await cloudAuth.updateMemberRole(company.cloudCompanyId, userId, role)
    refreshCloudState(session)
  }

  const handleRemoveMember = async (userId) => {
    if (!confirm(t('Remove this teammate from the company?'))) return
    const cloudAuth = await import('../cloudAuth')
    await cloudAuth.removeMember(company.cloudCompanyId, userId)
    refreshCloudState(session)
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
          <Cloud size={14} className="text-white" />
        </div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">{t('Cloud Sync')}</h2>
        {company?.cloudCompanyId && (
          <span className={`ms-auto inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-md ${
            syncStatus === 'syncing' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
            : syncStatus === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
            : 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300'}`}>
            {syncStatus === 'syncing' ? <RefreshCw size={12} className="animate-spin" /> : syncStatus === 'error' ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
            {syncStatus === 'syncing' ? t('Syncing…') : syncStatus === 'error' ? t('Sync error') : lastSyncAt ? t('Synced') : t('Not yet synced')}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">{t('Checking cloud account…')}</p>
      ) : recovering ? (
        <>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">{t('Choose a new password for your cloud account.')}</p>
          {resetDone ? (
            <p className="text-sm bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300 rounded-lg px-3 py-2.5">
              {t('Password updated. You are signed in.')}
            </p>
          ) : (
            <div className="max-w-sm space-y-3">
              <Input label={t('New password')} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              {err && <p className="text-sm text-red-500">{err}</p>}
              <Btn onClick={handleSetNewPassword} disabled={busy || !newPassword}>
                {busy ? t('Please wait…') : t('Set new password')}
              </Btn>
            </div>
          )}
        </>
      ) : !session ? (
        <>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
            {t('Sign in to sync this company across devices and invite teammates. Your data stays local-only until you do — nothing changes unless you opt in.')}
          </p>
          {signupSent ? (
            <p className="text-sm bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300 rounded-lg px-3 py-2.5">
              {t('Check your email to confirm your account, then come back and sign in.')}
            </p>
          ) : mode === 'forgot' ? (
            <div className="max-w-sm space-y-3">
              <div className="flex gap-1.5 mb-1">
                <button onClick={() => { setMode('signin'); setErr(''); setResetSent(false) }} className="text-xs font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">{t('← Back to sign in')}</button>
              </div>
              {resetSent ? (
                <p className="text-sm bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300 rounded-lg px-3 py-2.5">
                  {t('If an account exists for that email, a reset link is on its way.')}
                </p>
              ) : (
                <>
                  <Input label={t('Email')} type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
                  {err && <p className="text-sm text-red-500">{err}</p>}
                  <Btn onClick={handleAuth} disabled={busy || !form.email}>
                    {busy ? t('Please wait…') : t('Send reset link')}
                  </Btn>
                </>
              )}
            </div>
          ) : (
            <div className="max-w-sm space-y-3">
              <div className="flex gap-1.5 mb-1">
                <button onClick={() => setMode('signin')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === 'signin' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}>{t('Sign in')}</button>
                <button onClick={() => setMode('signup')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === 'signup' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}>{t('Create cloud account')}</button>
              </div>
              {mode === 'signup' && <Input label={t('Your name')} value={form.name} onChange={(e) => setField('name', e.target.value)} />}
              <Input label={t('Email')} type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
              <Input label={t('Password')} type="password" value={form.password} onChange={(e) => setField('password', e.target.value)} />
              {mode === 'signin' && (
                <button onClick={() => { setMode('forgot'); setErr('') }} className="text-xs font-semibold text-brand-600 hover:text-brand-700">{t('Forgot password?')}</button>
              )}
              {err && <p className="text-sm text-red-500">{err}</p>}
              <Btn onClick={handleAuth} disabled={busy || !form.email || !form.password}>
                {busy ? t('Please wait…') : mode === 'signup' ? t('Create cloud account') : t('Sign in')}
              </Btn>
            </div>
          )}
        </>
      ) : !company?.cloudCompanyId ? (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500 dark:text-slate-400">{t('Signed in as')} <strong className="text-gray-700 dark:text-slate-200">{session.user.email}</strong></p>
            <button onClick={handleSignOut} className="text-xs font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 inline-flex items-center gap-1"><LogOut size={12} /> {t('Sign out')}</button>
          </div>

          {myInvites.length > 0 && (
            <div className="mb-5 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">{t('Invitations for you')}</p>
              {myInvites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between rounded-lg bg-brand-50/60 dark:bg-brand-500/[0.08] px-3 py-2.5 text-sm">
                  <span className="text-gray-700 dark:text-slate-200">{inv.companies?.name || t('Unnamed company')} <span className="text-gray-400 dark:text-slate-500">· {inv.role}</span></span>
                  <Btn size="sm" onClick={() => handleAcceptInvite(inv.token, inv.company_id)}>{t('Accept & link this company')}</Btn>
                </div>
              ))}
            </div>
          )}

          <p className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">{t('Link "{name}" to the cloud').replace('{name}', company?.name)}</p>
          <div className="flex flex-wrap items-end gap-2 mb-4">
            <Input label={t('New cloud company name')} value={newCloudName} onChange={(e) => setNewCloudName(e.target.value)} className="w-56" />
            <Btn onClick={handleCreateCloudCompany} disabled={busy}><Link2 size={14} /> {t('Create & link')}</Btn>
          </div>
          {err && <p className="text-sm text-red-500 mb-3">{err}</p>}

          {myCloudCompanies.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">{t('Or link to a cloud company you already belong to')}</p>
              {myCloudCompanies.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-slate-800/60 px-3 py-2.5 text-sm">
                  <span className="text-gray-700 dark:text-slate-200">{c.name}</span>
                  <Btn size="sm" variant="secondary" onClick={() => handleLinkExisting(c.id)}>{t('Link')}</Btn>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {t('Signed in as')} <strong className="text-gray-700 dark:text-slate-200">{session.user.email}</strong>
              {lastSyncAt && <span className="block text-xs mt-0.5">{t('Last synced')}: {new Date(lastSyncAt).toLocaleString()}</span>}
              {lastSyncError && <span className="block text-xs mt-0.5 text-red-500">{lastSyncError}</span>}
            </p>
            <div className="flex items-center gap-2">
              <Btn size="sm" variant="secondary" onClick={handleSyncNow} disabled={syncStatus === 'syncing'}>
                <RefreshCw size={13} className={syncStatus === 'syncing' ? 'animate-spin' : ''} /> {t('Sync now')}
              </Btn>
              <button onClick={handleUnlink} title={t('Stop syncing')} className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"><Unlink size={14} /></button>
              <button onClick={handleSignOut} title={t('Sign out')} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"><LogOut size={14} /></button>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-slate-700 pt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-2">{t('Team members')}</p>
            <div className="space-y-1.5 mb-3">
              {members.map((m) => {
                const RoleIcon = ROLE_ICON[m.role] || Users
                return (
                  <div key={m.user_id} className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-slate-800/60 px-3 py-2 text-sm">
                    <span className="flex items-center gap-2 text-gray-700 dark:text-slate-200">
                      <RoleIcon size={13} className="text-gray-400 dark:text-slate-500" />
                      {m.name || m.email} {m.user_id === session.user.id && <span className="text-gray-400 dark:text-slate-500 text-xs">({t('you')})</span>}
                    </span>
                    {canManage && m.user_id !== session.user.id ? (
                      <div className="flex items-center gap-2">
                        <select value={m.role} onChange={(e) => handleRoleChange(m.user_id, e.target.value)} className="text-xs bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-md px-1.5 py-1">
                          <option value="admin">{t('Admin')}</option>
                          <option value="member">{t('Member')}</option>
                          <option value="viewer">{t('Viewer')}</option>
                        </select>
                        <button onClick={() => handleRemoveMember(m.user_id)} className="text-gray-300 hover:text-red-500"><X size={14} /></button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-slate-500 capitalize">{t(m.role)}</span>
                    )}
                  </div>
                )
              })}
            </div>

            {canManage && (
              <>
                <div className="flex flex-wrap items-end gap-2">
                  <Input label={t('Invite by email')} type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@company.com" className="flex-1 min-w-[200px]" />
                  <Select label={t('Role')} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="w-32">
                    <option value="admin">{t('Admin')}</option>
                    <option value="member">{t('Member')}</option>
                    <option value="viewer">{t('Viewer')}</option>
                  </Select>
                  <Btn size="sm" onClick={handleInvite} disabled={busy}><Mail size={13} /> {t('Invite')}</Btn>
                </div>
                {err && <p className="text-sm text-red-500 mt-2">{err}</p>}
                {invites.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {invites.map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between rounded-lg bg-amber-50/60 dark:bg-amber-500/[0.08] px-3 py-2 text-sm">
                        <span className="text-gray-600 dark:text-slate-300">{inv.email} <span className="text-gray-400 dark:text-slate-500">· {t('pending')} · {inv.role}</span></span>
                        <button onClick={() => handleCancelInvite(inv.id)} className="text-gray-300 hover:text-red-500"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
