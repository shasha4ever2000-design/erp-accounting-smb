import { useState, useRef, useEffect } from 'react'
import { useT } from '../i18n'
import { useStore } from '../store'
import { Bot, X, Send, Sparkles, Trash2, AlertCircle, Minimize2 } from 'lucide-react'

export default function AIAssistant() {
  const t = useT()
  const store     = useStore()
  const { settings, invoices, purchases, employees, journalEntries, expenseClaims, leases, getAccountBalance } = store

  const [open,     setOpen]     = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [input,    setInput]    = useState('')
  const [error,    setError]    = useState('')
  const [messages, setMessages] = useState(null) // null = not yet initialized

  const messagesEndRef = useRef(null)
  const inputRef       = useRef(null)

  const apiKey = settings.ai?.apiKey || ''
  const model  = settings.ai?.model  || 'claude-haiku-4-5-20251001'

  // Build greeting on first open using live company name
  const greeting = `Hello! I'm your AI accounting assistant for **${settings.company.name}**. I can answer questions about your finances, explain accounting concepts, and guide you through this ERP. What would you like to know?`

  useEffect(() => {
    if (open && messages === null) {
      setMessages([{ role: 'assistant', content: greeting }])
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
      inputRef.current?.focus()
    }
  }, [open, messages, loading])

  const buildSystemPrompt = () => {
    const sym       = settings.company.currencySymbol
    const arBal     = getAccountBalance('acc-ar')
    const apBal     = getAccountBalance('acc-ap')
    const cashBal   = getAccountBalance('acc-cash')
    const bankBal   = getAccountBalance('acc-bank1')
    const invBal    = getAccountBalance('acc-inv')
    const prepBal   = getAccountBalance('acc-prepaid')

    const unpaidInv = invoices.filter(i => ['sent','partial'].includes(i.status))
    const unpaidPur = purchases.filter(p => ['received','partial'].includes(p.status))
    const activeEmp = employees.filter(e => e.status !== 'inactive').length
    const pendingExp= expenseClaims.filter(c => c.status === 'pending').length
    const activeLeases = leases.filter(l => l.status === 'active')

    return `You are an intelligent AI accounting assistant embedded in the ERP system for "${settings.company.name}".

TODAY'S DATE: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
CURRENCY: ${settings.company.currency} (${sym})

LIVE FINANCIAL SNAPSHOT:
• Cash on Hand:          ${sym}${cashBal.toFixed(2)}
• Main Bank Account:     ${sym}${bankBal.toFixed(2)}
• Accounts Receivable:   ${sym}${arBal.toFixed(2)}   (${unpaidInv.length} unpaid invoices totalling ${sym}${unpaidInv.reduce((s,i)=>s+(i.total-i.amountPaid),0).toFixed(2)})
• Accounts Payable:      ${sym}${apBal.toFixed(2)}   (${unpaidPur.length} outstanding purchase bills)
• Inventory Value:       ${sym}${invBal.toFixed(2)}
• Prepaid Expenses:      ${sym}${prepBal.toFixed(2)}
• Active Leases:         ${activeLeases.length} (monthly commitment: ${sym}${activeLeases.reduce((s,l)=>s+(l.monthlyRent||0),0).toFixed(2)})

HR & PAYROLL:
• Active Employees:      ${activeEmp}
• Pending Expense Claims:${pendingExp}

ACCOUNTING SYSTEM:
• Tax: ${settings.tax.enabled ? `${settings.tax.name} at ${settings.tax.rate}%` : 'Not enabled'}
• Total Journal Entries: ${journalEntries.length}
• Double-entry bookkeeping with automatic JEs for every transaction

AVAILABLE MODULES: Dashboard, Chart of Accounts, Cash & Banking, Sales (Quotations, Invoices, Credit Notes), Purchases (POs, Bills, Debit Notes), Inventory, Manufacturing (BOMs, Work Orders), Fixed Assets (depreciation & disposal), HR & Payroll, Prepaid Expenses, Leases & Rent, Expense Claims, Reports (P&L, Balance Sheet, Trial Balance, VAT).

You are an expert in double-entry bookkeeping, IFRS/GAAP, and financial management for small and medium businesses. Answer concisely and professionally. Use ${sym} for amounts. For journal entries use Dr/Cr notation. Format lists clearly. If asked what you can do, mention you can explain the live financial data above, accounting concepts, how to use modules, and interpret reports.`
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return

    if (!apiKey) {
      setError('No API key set. Go to Settings → AI Assistant and enter your Claude API key.')
      return
    }

    const userMsg   = { role: 'user', content: text }
    const history   = [...(messages || [{ role: 'assistant', content: greeting }]), userMsg]
    setMessages(history)
    setInput('')
    setLoading(true)
    setError('')

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-calls': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: buildSystemPrompt(),
          messages: history.map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error?.message || `API error ${res.status}`)
      }

      const data  = await res.json()
      const reply = data.content?.[0]?.text || 'No response received.'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      setError(e.message || 'Connection failed. Check your API key.')
    } finally {
      setLoading(false)
    }
  }

  const clearChat = () => {
    setMessages([{ role: 'assistant', content: greeting }])
    setError('')
  }

  // Simple markdown-ish rendering: bold **text** and line breaks
  const renderText = (text) =>
    text.split('\n').map((line, i) => {
      const parts = line.split(/\*\*(.*?)\*\*/g)
      return (
        <span key={i}>
          {parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p)}
          {i < text.split('\n').length - 1 && <br />}
        </span>
      )
    })

  const displayMessages = messages || []

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`no-print fixed bottom-6 end-6 z-50 w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 ease-spring active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-surface-900 ${
          open
            ? 'bg-surface-700 hover:bg-surface-600 shadow-elevated'
            : 'bg-gradient-to-br from-accent-500 to-brand-600 hover:from-accent-600 hover:to-brand-700 hover:scale-105 shadow-elevated shadow-glow'
        }`}
        title={open ? 'Close assistant' : 'AI Accounting Assistant'}
      >
        {open
          ? <X size={22} className="text-white" />
          : <Sparkles size={22} className="text-white" />
        }
      </button>

      {/* Chat Panel */}
      {open && (
        <div className="no-print fixed bottom-24 end-6 z-50 w-[390px] flex flex-col bg-white dark:bg-surface-850 rounded-2xl shadow-modal ring-1 ring-black/5 dark:ring-white/10 overflow-hidden animate-scale-in"
          style={{ height: '520px' }}>

          {/* Header */}
          <div className="bg-gradient-to-r from-accent-600 to-brand-600 px-4 py-3 flex items-center gap-3 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-white/[0.15] ring-1 ring-inset ring-white/20 flex items-center justify-center flex-shrink-0">
              <Bot size={20} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-tight">{t('AI Accounting Assistant')}</p>
              <p className="text-white/70 text-xs truncate">Powered by Claude · {settings.company.name}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={clearChat} title="Clear conversation" className="p-1.5 rounded-lg text-white/75 hover:text-white hover:bg-white/[0.15] transition-colors">
                <Trash2 size={14} />
              </button>
              <button onClick={() => setOpen(false)} title="Minimize" className="p-1.5 rounded-lg text-white/75 hover:text-white hover:bg-white/[0.15] transition-colors">
                <Minimize2 size={14} />
              </button>
            </div>
          </div>

          {/* No API Key Banner */}
          {!apiKey && (
            <div className="px-3 py-2 bg-warning-50 dark:bg-warning-500/10 border-b border-warning-200 dark:border-warning-400/20 text-xs text-warning-700 dark:text-warning-300 flex items-center gap-1.5 flex-shrink-0">
              <AlertCircle size={12} className="flex-shrink-0" />
              <span>{t('Add your Claude API key in')}<strong>Settings → AI Assistant</strong> to enable chat.</span>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-surface-900/60">
            {displayMessages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent-50 to-brand-50 dark:from-accent-500/20 dark:to-brand-500/20 flex items-center justify-center flex-shrink-0 mt-0.5 ring-1 ring-inset ring-accent-200/80 dark:ring-accent-400/25">
                    <Sparkles size={12} className="text-accent-600 dark:text-accent-400" />
                  </div>
                )}
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-b from-brand-500 to-brand-600 text-white rounded-ee-sm'
                    : 'bg-white dark:bg-surface-800 text-slate-800 dark:text-slate-100 shadow-xs dark:shadow-none border border-slate-200/70 dark:border-surface-700 rounded-es-sm'
                }`}>
                  {renderText(msg.content)}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="flex gap-2 justify-start">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent-50 to-brand-50 dark:from-accent-500/20 dark:to-brand-500/20 flex items-center justify-center flex-shrink-0 ring-1 ring-inset ring-accent-200/80 dark:ring-accent-400/25">
                  <Sparkles size={12} className="text-accent-600 dark:text-accent-400" />
                </div>
                <div className="bg-white dark:bg-surface-800 rounded-2xl rounded-es-sm px-4 py-3 shadow-xs dark:shadow-none border border-slate-200/70 dark:border-surface-700">
                  <div className="flex gap-1.5 items-center">
                    <span className="w-2 h-2 bg-accent-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-accent-400 rounded-full animate-bounce" style={{ animationDelay: '160ms' }} />
                    <span className="w-2 h-2 bg-accent-400 rounded-full animate-bounce" style={{ animationDelay: '320ms' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-danger-50 dark:bg-danger-500/10 border border-danger-200 dark:border-danger-400/25 rounded-xl p-3 text-xs text-danger-600 dark:text-danger-300 flex gap-2 items-start animate-fade-in">
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Suggested prompts (show only at start) */}
          {displayMessages.length === 1 && !loading && (
            <div className="px-3 pb-2 bg-slate-50 dark:bg-surface-900/60 flex-shrink-0">
              <div className="flex flex-wrap gap-1.5">
                {[
                  'What is my AR balance?',
                  'How many unpaid invoices?',
                  'Explain double-entry bookkeeping',
                  'What is my monthly rent cost?',
                ].map((prompt) => (
                  <button key={prompt} onClick={() => { setInput(prompt); inputRef.current?.focus() }}
                    className="text-xs bg-white dark:bg-surface-800 border border-slate-200/90 dark:border-surface-700 text-slate-600 dark:text-slate-300 hover:border-accent-300 hover:text-accent-700 dark:hover:border-accent-400/50 dark:hover:text-accent-300 rounded-full px-2.5 py-1 transition-colors duration-150">
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-slate-100 dark:border-surface-750 bg-white dark:bg-surface-850 flex-shrink-0">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder={apiKey ? 'Ask about your finances...' : 'Set API key in Settings first'}
                className="flex-1 text-sm border border-slate-300/90 dark:border-surface-600 rounded-xl px-3.5 py-2 bg-white dark:bg-surface-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 shadow-input dark:shadow-none transition-all duration-150 focus:outline-none focus:border-accent-500 focus:ring-4 focus:ring-accent-500/15"
                disabled={loading}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading || !apiKey}
                className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent-500 to-brand-600 hover:from-accent-600 hover:to-brand-700 flex items-center justify-center disabled:opacity-40 transition-all duration-150 active:scale-95 flex-shrink-0"
              >
                <Send size={14} className="text-white ms-0.5 rtl:-scale-x-100" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
