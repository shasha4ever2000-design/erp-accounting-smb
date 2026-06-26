// Shared UI primitives (light + dark mode aware)

export function Card({ children, className = '' }) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 ${className}`}>
      {children}
    </div>
  )
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between mb-6 gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

export function Btn({ children, onClick, variant = 'primary', size = 'md', type = 'button', disabled = false, className = '' }) {
  const base = 'inline-flex items-center gap-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 dark:focus:ring-offset-slate-800 disabled:opacity-50 disabled:cursor-not-allowed'
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-base' }
  const variants = {
    primary:   'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600 focus:ring-gray-400',
    danger:    'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    ghost:     'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 focus:ring-gray-400',
    success:   'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  )
}

export function Badge({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

export function Input({ label, error, className = '', ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{label}</label>}
      <input
        className={`w-full border rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
          error ? 'border-red-400 bg-red-50 dark:bg-red-900/20' : 'border-gray-300 dark:border-slate-600'
        }`}
        {...props}
      />
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

export function Select({ label, error, children, className = '', ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{label}</label>}
      <select
        className={`w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
          error ? 'border-red-400' : 'border-gray-300 dark:border-slate-600'
        }`}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

export function Textarea({ label, error, className = '', ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{label}</label>}
      <textarea
        className={`w-full border rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none ${
          error ? 'border-red-400' : 'border-gray-300 dark:border-slate-600'
        }`}
        {...props}
      />
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full ${width} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 text-2xl leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto p-6 flex-1">{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({ icon, title, desc, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-5xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-gray-700 dark:text-slate-200 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 dark:text-slate-400 max-w-sm mb-4">{desc}</p>
      {action}
    </div>
  )
}

export function StatCard({ label, value, sub, color = 'blue', icon }) {
  const colors = {
    blue:   'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300',
    green:  'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300',
    orange: 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-300',
    red:    'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300',
    purple: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300',
  }
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-slate-400 font-medium">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100 mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{sub}</p>}
        </div>
        {icon && (
          <div className={`p-2.5 rounded-lg ${colors[color]}`}>{icon}</div>
        )}
      </div>
    </Card>
  )
}

export function Table({ headers, children, empty }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 dark:border-slate-700">
            {headers.map((h, i) => (
              <th
                key={i}
                className={`px-4 py-3 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide ${
                  h.right ? 'text-right' : 'text-left'
                }`}
              >
                {h.label || h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
        </tbody>
      </table>
      {empty}
    </div>
  )
}

export function Tr({ children, onClick, className = '' }) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-gray-50 dark:border-slate-700/50 ${onClick ? 'cursor-pointer hover:bg-blue-50/50 dark:hover:bg-slate-700/50' : 'hover:bg-gray-50/50 dark:hover:bg-slate-700/30'} transition-colors ${className}`}
    >
      {children}
    </tr>
  )
}

export function Td({ children, right = false, className = '' }) {
  return (
    <td className={`px-4 py-3 text-gray-700 dark:text-slate-300 ${right ? 'text-right' : ''} ${className}`}>
      {children}
    </td>
  )
}

export function SectionDivider({ title }) {
  return (
    <div className="flex items-center gap-3 my-6">
      <div className="flex-1 border-t border-gray-200 dark:border-slate-700" />
      <span className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">{title}</span>
      <div className="flex-1 border-t border-gray-200 dark:border-slate-700" />
    </div>
  )
}
