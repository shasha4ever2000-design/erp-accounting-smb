import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store'
import { Bot, X, Send, Sparkles, Trash2, AlertCircle, Minimize2 } from 'lucide-react'

export default function AIAssistant() {
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
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-200 ${
          open
            ? 'bg-slate-700 hover:bg-slate-600'
            : 'bg-gradient-to-br from-violet-500 to-blue-600 hover:from-violet-600 hover:to-blue-700 hover:scale-105'
        }`}
        title={open ? 'Close assistant' : 'AI Accounting Assistant'}
      >
        {open
          ? <X size={22} className="text-white" />
          : <Sparkles size={22} className="text-white" />
        }
      </button>

      {/* Pulse ring when closed */}
      {!open && (
        <span className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-violet-500 opacity-30 animate-ping pointer-events-none" />
      )}

      {/* Chat Panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[390px] flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
          style={{ height: '520px' }}>

          {/* Header */}
          <div className="bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-3 flex items-center gap-3 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Bot size={20} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-tight">AI Accounting Assistant</p>
              <p className="text-violet-200 text-xs">Powered by Claude · {settings.company.name}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={clearChat} title="Clear conversation" className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
                <Trash2 size={14} className="text-white/80" />
              </button>
              <button onClick={() => setOpen(false)} title="Minimize" className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
                <Minimize2 size={14} className="text-white/80" />
              </button>
            </div>
          </div>

          {/* No API Key Banner */}
          {!apiKey && (
            <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700 flex items-center gap-1.5 flex-shrink-0">
              <AlertCircle size={12} className="flex-shrink-0" />
              <span>Add your Claude API key in <strong>Settings → AI Assistant</strong> to enable chat.</span>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {displayMessages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-100 to-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5 border border-violet-200">
                    <Sparkles size={12} className="text-violet-600" />
                  </div>
                )}
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-white text-gray-800 shadow-sm border border-gray-100 rounded-bl-sm'
                }`}>
                  {renderText(msg.content)}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="flex gap-2 justify-start">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-100 to-blue-100 flex items-center justify-center flex-shrink-0 border border-violet-200">
                  <Sparkles size={12} className="text-violet-600" />
                </div>
                <div className="bg-white rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm border border-gray-100">
                  <div className="flex gap-1.5 items-center">
                    <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '160ms' }} />
                    <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '320ms' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600 flex gap-2 items-start">
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Suggested prompts (show only at start) */}
          {displayMessages.length === 1 && !loading && (
            <div className="px-3 pb-2 bg-slate-50 flex-shrink-0">
              <div className="flex flex-wrap gap-1.5">
                {[
                  'What is my AR balance?',
                  'How many unpaid invoices?',
                  'Explain double-entry bookkeeping',
                  'What is my monthly rent cost?',
                ].map((prompt) => (
                  <button key={prompt} onClick={() => { setInput(prompt); inputRef.current?.focus() }}
                    className="text-xs bg-white border border-gray-200 text-gray-600 hover:border-violet-300 hover:text-violet-700 rounded-full px-2.5 py-1 transition-colors">
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-gray-100 bg-white flex-shrink-0">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder={apiKey ? 'Ask about your finances...' : 'Set API key in Settings first'}
                className="flex-1 text-sm border border-gray-200 rounded-xl px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent bg-gray-50"
                disabled={loading}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || loading || !apiKey}
                className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity flex-shrink-0"
              >
                <Send size={14} className="text-white ml-0.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
