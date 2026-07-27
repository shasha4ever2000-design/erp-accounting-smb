import { useState } from 'react'
import { useAuth } from '../auth'
import { useT, useI18n } from '../i18n'
import { scorePassword, scoreLabel, passwordHint } from '../utils/password'
import { TrendingUp, Mail, Lock, User, Loader2, ShieldCheck, Globe, Check } from 'lucide-react'

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
    <div className="min-h-screen flex relative bg-slate-50 dark:bg-slate-950">
      <button
        onClick={toggleLang}
        className="absolute top-4 end-4 z-10 inline-flex items-center gap-1.5 bg-white/80 dark:bg-slate-800/80 backdrop-blur border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-slate-300 shadow-card hover:bg-white dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
      >
        <Globe size={15} /> {lang === 'ar' ? 'English' : 'العربية'}
      </button>

      {/* Brand panel */}
      <div className="hidden lg:flex w-1/2 relative overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 dark:from-blue-800 dark:via-indigo-900 dark:to-slate-950 text-white p-12 xl:p-16 flex-col justify-between">
        {/* Decorative texture — subtle, professional */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 -start-32 w-[28rem] h-[28rem] rounded-full bg-white/10 blur-3xl" />
          <div className="absolute bottom-0 end-0 w-[34rem] h-[34rem] translate-x-1/3 translate-y-1/3 rtl:-translate-x-1/3 rounded-full bg-indigo-400/20 dark:bg-indigo-500/10 blur-3xl" />
          <div className="absolute inset-0 opacity-[0.06] bg-[linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] bg-[size:44px_44px]" />
        </div>

        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 bg-white/15 ring-1 ring-white/25 rounded-xl flex items-center justify-center shadow-elevated backdrop-blur-sm">
            <TrendingUp size={22} strokeWidth={2.25} />
          </div>
          <span className="text-lg font-bold tracking-tight">{t('ERP Accounting')}</span>
        </div>

        <div className="relative max-w-lg">
          <h1 className="text-4xl xl:text-[2.75rem] font-black leading-[1.12] tracking-tight mb-5">{t('Run your whole business in one place.')}</h1>
          <p className="text-blue-100/90 text-lg leading-relaxed">{t('Double-entry accounting, invoicing, inventory, payroll, projects and POS — with VAT/GST, sales tax, and Saudi ZATCA e-invoicing built in. Built for small & medium businesses anywhere.')}</p>
          <div className="mt-9 space-y-3.5 text-sm">
            {[
              t('VAT/GST, sales tax & ZATCA e-invoicing built in'),
              t('Multiple companies in one app'),
              t('Works offline · installable on desktop'),
            ].map((f) => (
              <p key={f} className="flex items-center gap-3 text-blue-50/95">
                <span className="w-5 h-5 rounded-full bg-white/15 ring-1 ring-white/25 flex items-center justify-center flex-shrink-0">
                  <Check size={12} strokeWidth={3} />
                </span>
                {f}
              </p>
            ))}
          </div>
        </div>

        <p className="relative text-blue-200/70 text-xs">© {new Date().getFullYear()} ERP Accounting</p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 relative">
        {/* Subtle backdrop wash behind the card */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 w-[36rem] h-[18rem] rounded-full bg-brand-100/60 dark:bg-brand-900/20 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md animate-scale-in">
          <div className="lg:hidden flex items-center gap-2.5 mb-8 justify-center">
            <div className="w-11 h-11 bg-gradient-to-br from-brand-500 to-accent-600 rounded-xl flex items-center justify-center text-white shadow-btn-primary">
              <TrendingUp size={22} strokeWidth={2.25} />
            </div>
            <span className="text-lg font-bold tracking-tight text-gray-800 dark:text-slate-100">{t('ERP Accounting')}</span>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-elevated ring-1 ring-black/5 dark:ring-white/10 border border-gray-100 dark:border-slate-800 p-7 sm:p-9">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-slate-100 mb-1.5">{mode === 'signup' ? t('Create your account') : t('Welcome back')}</h2>
            <p className="text-gray-500 dark:text-slate-400 text-sm mb-7">{mode === 'signup' ? t('Sign up to start managing your companies.') : t('Sign in to continue.')}</p>

            <form onSubmit={submit} className="space-y-3.5">
              {mode === 'signup' && (
                <Field icon={<User size={16} />}>
                  <input className="w-full bg-transparent outline-none text-sm text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500" aria-label={t('Full name')} placeholder={t('Full name')} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
                </Field>
              )}
              <Field icon={<Mail size={16} />}>
                <input className="w-full bg-transparent outline-none text-sm text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500" aria-label={t('Email')} type="email" placeholder={t('Email')} value={form.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field icon={<Lock size={16} />}>
                <input className="w-full bg-transparent outline-none text-sm text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500" aria-label={t('Password')} type="password" placeholder={t('Password')} value={form.password} onChange={(e) => set('password', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit(e)} />
              </Field>

              {mode === 'signup' && form.password && (
                <PasswordMeter password={form.password} t={t} />
              )}

              {error && (
                <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/25 border border-red-100 dark:border-red-900/40 rounded-xl px-3.5 py-2.5 animate-fade-in">{error}</p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full bg-gradient-to-b from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 active:from-brand-700 active:to-brand-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 shadow-btn-primary transition-all duration-150 ease-spring active:scale-[.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
              >
                {busy && <Loader2 size={16} className="animate-spin" />}
                {mode === 'signup' ? t('Create account') : t('Sign in')}
              </button>
            </form>

            <p className="text-sm text-gray-500 dark:text-slate-400 mt-6 text-center">
              {mode === 'signup' ? t('Already have an account?') : t('New here?')}{' '}
              <button
                onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError('') }}
                className="text-brand-600 dark:text-brand-400 font-semibold hover:text-brand-700 dark:hover:text-brand-300 hover:underline underline-offset-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {mode === 'signup' ? t('Sign in') : t('Create an account')}
              </button>
            </p>
          </div>

          <div className="mt-5 flex items-start gap-2.5 text-xs leading-relaxed text-gray-500 dark:text-slate-400 bg-white/70 dark:bg-slate-900/60 backdrop-blur border border-gray-100 dark:border-slate-800 rounded-xl px-4 py-3 shadow-card">
            <ShieldCheck size={15} className="mt-0.5 flex-shrink-0 text-brand-600 dark:text-brand-400" />
            <span>Accounts are stored locally on this device for organising your work. For secure, cross-device sign-in, cloud sync can be enabled later.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * A strength meter, shown only while signing up.
 *
 * Four bars rather than a percentage: a number invites people to optimise for
 * the number. The hint underneath names the one thing to change, because
 * "weak" on its own tells nobody what to do about it.
 */
function PasswordMeter({ password, t }) {
  const score = scorePassword(password)
  const hint = passwordHint(password)
  const tone = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500'][score]
  const text = ['text-red-600 dark:text-red-400', 'text-orange-600 dark:text-orange-400',
    'text-amber-600 dark:text-amber-400', 'text-lime-600 dark:text-lime-400',
    'text-emerald-600 dark:text-emerald-400'][score]

  return (
    <div className="animate-fade-in" aria-live="polite">
      <div className="flex gap-1.5" role="img" aria-label={`${t('Password strength')}: ${t(scoreLabel(score))}`}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < score ? tone : 'bg-gray-200 dark:bg-slate-700'}`} />
        ))}
      </div>
      <p className={`text-xs mt-1.5 ${text}`}>
        <span className="font-medium">{t(scoreLabel(score))}</span>
        {hint && <span className="text-gray-500 dark:text-slate-400"> · {t(hint)}</span>}
      </p>
    </div>
  )
}

function Field({ icon, children }) {
  return (
    <div className="flex items-center gap-2.5 border border-gray-300 dark:border-slate-600 rounded-xl px-3.5 py-2.5 bg-white dark:bg-slate-800/80 transition-shadow duration-150 focus-within:border-brand-500 dark:focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-500/20">
      <span className="text-gray-400 dark:text-slate-500 flex-shrink-0">{icon}</span>
      {children}
    </div>
  )
}
