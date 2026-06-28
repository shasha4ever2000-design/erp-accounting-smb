import { useState } from 'react'
import { useAuth } from '../auth'
import { useT, useI18n } from '../i18n'
import { TrendingUp, Mail, Lock, User, Loader2, ShieldCheck, Globe } from 'lucide-react'

export default function AuthScreen() {
  const { signup, login } = useAuth()
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const toggleLang = useI18n((s) => s.toggle)
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e?.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = mode === 'signup' ? await signup(form) : await login(form)
      if (res?.error) setError(res.error)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex relative">
      <button onClick={toggleLang} className="absolute top-4 right-4 z-10 flex items-center gap-1.5 bg-white/80 backdrop-blur border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-white">
        <Globe size={15} /> {lang === 'ar' ? 'English' : 'العربية'}
      </button>
      {/* Brand panel */}
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 text-white p-12 flex-col justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center"><TrendingUp size={20} /></div>
          <span className="text-lg font-bold">ERP Accounting</span>
        </div>
        <div>
          <h1 className="text-4xl font-black leading-tight mb-4">{t('Run your whole business in one place.')}</h1>
          <p className="text-blue-100 text-lg leading-relaxed">Double-entry accounting, invoicing, inventory, payroll, projects, POS and ZATCA e-invoicing — built for small &amp; medium businesses in Saudi Arabia and beyond.</p>
          <div className="mt-8 space-y-2 text-blue-50/90 text-sm">
            <p>✓ ZATCA-compliant tax invoices with QR</p>
            <p>✓ Multiple companies in one app</p>
            <p>✓ Works offline · installable on desktop</p>
          </div>
        </div>
        <p className="text-blue-200/70 text-xs">© {new Date().getFullYear()} ERP Accounting</p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-slate-50">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-8 justify-center">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white"><TrendingUp size={20} /></div>
            <span className="text-lg font-bold text-gray-800">ERP Accounting</span>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-1">{mode === 'signup' ? t('Create your account') : t('Welcome back')}</h2>
          <p className="text-gray-500 text-sm mb-6">{mode === 'signup' ? t('Sign up to start managing your companies.') : t('Sign in to continue.')}</p>

          <form onSubmit={submit} className="space-y-3">
            {mode === 'signup' && (
              <Field icon={<User size={16} />}>
                <input className="auth-in" placeholder={t('Full name')} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
              </Field>
            )}
            <Field icon={<Mail size={16} />}>
              <input className="auth-in" type="email" placeholder={t('Email')} value={form.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field icon={<Lock size={16} />}>
              <input className="auth-in" type="password" placeholder={t('Password')} value={form.password} onChange={(e) => set('password', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit(e)} />
            </Field>

            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <button type="submit" disabled={busy} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2">
              {busy && <Loader2 size={16} className="animate-spin" />}
              {mode === 'signup' ? t('Create account') : t('Sign in')}
            </button>
          </form>

          <p className="text-sm text-gray-500 mt-5 text-center">
            {mode === 'signup' ? t('Already have an account?') : t('New here?')}{' '}
            <button onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError('') }} className="text-blue-600 font-medium hover:underline">
              {mode === 'signup' ? t('Sign in') : t('Create an account')}
            </button>
          </p>

          <div className="mt-6 flex items-start gap-2 text-xs text-gray-400 bg-white border border-gray-100 rounded-lg p-3">
            <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />
            <span>Accounts are stored locally on this device for organising your work. For secure, cross-device sign-in, cloud sync can be enabled later.</span>
          </div>
        </div>
      </div>

      <style>{`.auth-in{width:100%;background:transparent;outline:none;font-size:14px;color:#111827}
        .auth-field{display:flex;align-items:center;gap:8px;border:1px solid #d1d5db;border-radius:10px;padding:10px 12px;background:#fff}
        .auth-field:focus-within{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15)}`}</style>
    </div>
  )
}

function Field({ icon, children }) {
  return <div className="auth-field"><span className="text-gray-400">{icon}</span>{children}</div>
}
