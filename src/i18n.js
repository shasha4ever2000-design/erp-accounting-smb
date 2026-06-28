import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// English-string → Arabic dictionary. t(s) returns Arabic when the language is
// set to 'ar' and a translation exists, otherwise the original English string.
const AR = {
  // App / shell
  'ERP Accounting': 'محاسبة ERP',
  'Accounting ERP': 'نظام محاسبة',
  'Search…': 'بحث…',
  'Search modules or actions…': 'ابحث عن وحدة أو إجراء…',
  'Companies': 'الشركات',
  'New company': 'شركة جديدة',
  'Manage companies…': 'إدارة الشركات…',
  'Log out': 'تسجيل الخروج',
  'Go to': 'الانتقال إلى',
  'Create': 'إنشاء',
  'Full report →': 'التقرير الكامل ←',
  'Total': 'إجمالي',

  // Nav sections (dividers)
  'Cash & Banking': 'النقد والبنوك',
  'Sales': 'المبيعات',
  'Purchases': 'المشتريات',
  'Inventory & Production': 'المخزون والإنتاج',
  'Projects & Financials': 'المشاريع والماليات',
  'Fixed Assets': 'الأصول الثابتة',
  'HR & Payroll': 'الموارد البشرية والرواتب',
  'Reports & System': 'التقارير والنظام',

  // Nav items
  'Dashboard': 'لوحة التحكم',
  'Chart of Accounts': 'دليل الحسابات',
  'Cash & Bank Accounts': 'الحسابات النقدية والبنكية',
  'Bank Transactions': 'المعاملات البنكية',
  'Bank Reconciliation': 'التسوية البنكية',
  'Journal Entries': 'قيود اليومية',
  'Sales Pipeline (CRM)': 'مسار المبيعات',
  'Point of Sale': 'نقطة البيع',
  'Customers': 'العملاء',
  'Quotations': 'عروض الأسعار',
  'Sales Invoices': 'فواتير المبيعات',
  'Recurring Invoices': 'الفواتير المتكررة',
  'Delivery Notes': 'سندات التسليم',
  'Credit Notes': 'إشعارات دائنة',
  'Requisitions': 'طلبات الشراء',
  'Suppliers': 'الموردون',
  'Purchase Orders': 'أوامر الشراء',
  'Purchase Invoices': 'فواتير المشتريات',
  'Debit Notes': 'إشعارات مدينة',
  'Inventory Items': 'أصناف المخزون',
  'Warehouses': 'المستودعات',
  'Stock Adjustments': 'تسويات المخزون',
  'Manufacturing': 'التصنيع',
  'Projects': 'المشاريع',
  'Budgets': 'الموازنات',
  'Prepaid Expenses': 'المصروفات المدفوعة مقدماً',
  'Leases & Rent': 'الإيجارات',
  'Expense Claims': 'مطالبات المصروفات',
  'Departments': 'الأقسام',
  'Employees': 'الموظفون',
  'Payroll': 'الرواتب',
  'Analytics': 'التحليلات',
  'Currencies': 'العملات',
  'Statements': 'كشوف الحسابات',
  'Reports': 'التقارير',
  'Audit Log': 'سجل النشاط',
  'Team & Roles': 'الفريق والصلاحيات',
  'Settings': 'الإعدادات',

  // Dashboard
  'Total Revenue': 'إجمالي الإيرادات',
  'Total Expenses': 'إجمالي المصروفات',
  'Net Profit': 'صافي الربح',
  'Cash & Bank': 'النقد والبنك',
  'Accounts Receivable': 'الذمم المدينة',
  'Accounts Payable': 'الذمم الدائنة',
  'Overdue Invoices': 'الفواتير المتأخرة',
  'Total Assets': 'إجمالي الأصول',
  'Balance Sheet': 'الميزانية العمومية',
  'Profit & Loss': 'الأرباح والخسائر',
  'Quick Actions': 'إجراءات سريعة',
  'Recent Sales Invoices': 'أحدث فواتير المبيعات',
  'View all': 'عرض الكل',
  'Assets': 'الأصول',
  'Liabilities': 'الخصوم',
  'Equity': 'حقوق الملكية',
  'Revenue': 'الإيرادات',
  'Expenses': 'المصروفات',
  'Liabilities + Equity': 'الخصوم + حقوق الملكية',
  'Net Loss': 'صافي الخسارة',
  'Amount owed to you': 'المبالغ المستحقة لك',
  'Amount you owe': 'المبالغ المستحقة عليك',

  // Auth & company screens
  'Run your whole business in one place.': 'أدر أعمالك بالكامل من مكان واحد.',
  'Welcome back': 'مرحباً بعودتك',
  'Create your account': 'أنشئ حسابك',
  'Sign in to continue.': 'سجّل الدخول للمتابعة.',
  'Sign up to start managing your companies.': 'سجّل لبدء إدارة شركاتك.',
  'Full name': 'الاسم الكامل',
  'Email': 'البريد الإلكتروني',
  'Password': 'كلمة المرور',
  'Create account': 'إنشاء حساب',
  'Sign in': 'تسجيل الدخول',
  'Already have an account?': 'لديك حساب بالفعل؟',
  'New here?': 'مستخدم جديد؟',
  'Create an account': 'إنشاء حساب',
  'Your Companies': 'شركاتك',
  'New Company': 'شركة جديدة',
  'Company name': 'اسم الشركة',
  'Create': 'إنشاء',
  'Cancel': 'إلغاء',
  'Open': 'فتح',
  'Pick a company to work on, or create a new one. Each company keeps its own books.': 'اختر شركة للعمل عليها أو أنشئ شركة جديدة. لكل شركة دفاترها الخاصة.',
}

export const useI18n = create(
  persist(
    (set) => ({
      lang: 'en',
      setLang: (lang) => set({ lang }),
      toggle: () => set((s) => ({ lang: s.lang === 'ar' ? 'en' : 'ar' })),
    }),
    { name: 'erp-lang', version: 1 }
  )
)

export function useT() {
  const lang = useI18n((s) => s.lang)
  return (s) => (lang === 'ar' && AR[s]) ? AR[s] : s
}
