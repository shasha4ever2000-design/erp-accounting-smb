// Turns a seeded company Arabic.
//
// Account names, customer names, item names and so on are *data*, not interface
// strings, so switching the app to Arabic leaves them in English. A guide whose
// journal entries read "Accounts Receivable" under an Arabic heading is only
// half translated, so the Arabic build renames the books themselves.
//
// This is what an Arabic-speaking business's chart of accounts would look like
// after they renamed it — the app ships an English default chart and every
// account is renameable.

export const ACCOUNT_NAMES = {
  'Cash on Hand': 'النقدية بالصندوق',
  'Main Bank Account': 'الحساب البنكي الرئيسي',
  'USD Account': 'حساب الدولار الأمريكي',
  'Accounts Receivable': 'الذمم المدينة (العملاء)',
  'Cheques Under Collection': 'شيكات برسم التحصيل',
  'Employee Advances': 'سلف الموظفين',
  'Tax Receivable (Input)': 'ضريبة القيمة المضافة — المدخلات',
  'Inventory': 'المخزون',
  'Raw Materials': 'المواد الخام',
  'Work-in-Progress': 'إنتاج تحت التشغيل',
  'Finished Goods': 'بضاعة تامة الصنع',
  'Prepaid Expenses': 'مصروفات مدفوعة مقدماً',
  'Fixed Assets – Cost': 'الأصول الثابتة — التكلفة',
  'Accumulated Depreciation': 'مجمع الإهلاك',
  'Right-of-Use Assets': 'أصول حق الاستخدام',
  'Accounts Payable': 'الذمم الدائنة (الموردون)',
  'Goods Received Not Invoiced': 'بضاعة مستلمة ولم تُفوتر',
  'Tax Payable (Output)': 'ضريبة القيمة المضافة — المخرجات',
  'Withholding Tax Payable': 'ضريبة الاستقطاع المستحقة',
  'Cheques Payable': 'شيكات مستحقة الدفع',
  'Salaries Payable': 'رواتب مستحقة الدفع',
  'PAYE Tax Payable': 'ضريبة الدخل على الرواتب المستحقة',
  'Social Security Payable': 'التأمينات الاجتماعية المستحقة',
  'End-of-Service Provision': 'مخصص مكافأة نهاية الخدمة',
  'Customer Advances': 'دفعات مقدمة من العملاء',
  'Accrued Expenses': 'مصروفات مستحقة',
  'Employee Expense Claims': 'مطالبات مصروفات الموظفين',
  'Bank Loan': 'قرض بنكي',
  "Owner's Capital": 'رأس مال المالك',
  'Capital Accounts': 'حسابات الشركاء',
  'Retained Earnings': 'الأرباح المبقاة',
  'Opening Balance Equity': 'حقوق ملكية الأرصدة الافتتاحية',
  'Sales Revenue': 'إيرادات المبيعات',
  'Service Revenue': 'إيرادات الخدمات',
  'Sales Returns & Allowances': 'مردودات ومسموحات المبيعات',
  'Unrealized FX Gain/(Loss)': 'أرباح/(خسائر) صرف غير محققة',
  'Realized FX Gain/(Loss)': 'أرباح/(خسائر) صرف محققة',
  'Gain on Asset Disposal': 'أرباح استبعاد أصول',
  'Loss on Asset Disposal': 'خسائر استبعاد أصول',
  'Sales Discounts': 'خصومات المبيعات',
  'Shipping & Delivery Income': 'إيرادات الشحن والتوصيل',
  'Other Income': 'إيرادات أخرى',
  'Cost of Goods Sold': 'تكلفة البضاعة المباعة',
  'Salaries & Wages': 'الرواتب والأجور',
  'Employer Social Insurance (GOSI)': 'حصة صاحب العمل في التأمينات',
  'Rent Expense': 'مصروف الإيجار',
  'Utilities': 'المرافق (كهرباء ومياه)',
  'General & Administrative': 'مصروفات عمومية وإدارية',
  'Marketing & Advertising': 'التسويق والإعلان',
  'Depreciation Expense': 'مصروف الإهلاك',
  'Bank Charges': 'مصاريف بنكية',
  'Miscellaneous Expense': 'مصروفات متنوعة',
  'Inventory Adjustments': 'تسويات المخزون',
  'Purchase Returns': 'مردودات المشتريات',
  'End-of-Service Benefit': 'مكافأة نهاية الخدمة',
  'Purchase Discounts': 'خصومات المشتريات',
  'Freight-In / Delivery': 'مصاريف الشحن الداخل',
  'Credit Card': 'بطاقة ائتمان',
  'Lease Liability': 'التزام عقد الإيجار',
  "Owner's Drawings": 'مسحوبات المالك',
  'Interest Expense': 'مصروف الفوائد',
  'Manufacturing Costs': 'تكاليف التصنيع',
}

const NAMES = {
  'Al-Noor Trading Est.': 'مؤسسة النور التجارية',
  'Gulf Star LLC': 'شركة نجمة الخليج المحدودة',
  'Desert Rose Café': 'مقهى وردة الصحراء',
  'Riyadh Supplies Co': 'شركة الرياض للتوريدات',
  'Jeddah Import House': 'دار جدة للاستيراد',
  'Office Chair': 'كرسي مكتب',
  'Standing Desk': 'مكتب قائم',
  'Filing Cabinet': 'خزانة ملفات',
  'Steel sheet 2mm': 'صفيحة فولاذ ٢ مم',
  'Powder coating': 'طلاء بودرة',
  'Steel shelving unit': 'وحدة أرفف فولاذية',
  'Riyadh Main Store': 'المستودع الرئيسي — الرياض',
  'Jeddah Branch': 'فرع جدة',
  'Main Warehouse': 'المستودع الرئيسي',
  'Operations': 'العمليات',
  'Sales': 'المبيعات',
  'Warehouse': 'المستودع',
  'Finance': 'المالية',
  'Yusuf Haddad': 'يوسف حداد',
  'Layla Mansour': 'ليلى منصور',
  'Omar Farouk': 'عمر فاروق',
  'Ahmed Al-Salem': 'أحمد السالم',
  'Sara Hassan': 'سارة حسن',
  'Sales Manager': 'مدير مبيعات',
  'Accountant': 'محاسب',
  'Storekeeper': 'أمين مستودع',
}

/** Rename the whole company into Arabic, in place. */
export function arabize(g, useStore) {
  const tr = (v) => (v && NAMES[v]) || v
  const renamed = []

  g().accounts.forEach((a) => {
    const ar = ACCOUNT_NAMES[a.name]
    if (ar) { g().updateAccount(a.id, { name: ar }); renamed.push(a.name) }
  })

  const untranslated = g().accounts.filter((a) => /^[\x20-\x7E]+$/.test(a.name) && !/^\d/.test(a.name))
  g().updateCompany({ name: 'شركة نورث ويند التجارية' })

  // Master data.
  g().customers.forEach((c) => g().updateCustomer?.(c.id, { name: tr(c.name) }))
  g().suppliers.forEach((s) => g().updateSupplier?.(s.id, { name: tr(s.name) }))
  g().inventoryItems.forEach((i) => g().updateInventoryItem?.(i.id, { name: tr(i.name) }))
  g().warehouses.forEach((w) => g().updateWarehouse?.(w.id, { name: tr(w.name) }))
  g().departments.forEach((d) => g().updateDepartment?.(d.id, { name: tr(d.name) }))
  g().employees.forEach((e) => g().updateEmployee?.(e.id, { name: tr(e.name), position: tr(e.position) }))

  // Documents copy the customer/supplier/item name onto themselves when they
  // are created, so renaming the master record afterwards never reaches them.
  // Rewrite every denormalised *Name field too.
  const SLICES = [
    'invoices', 'quotations', 'salesOrders', 'creditNotes', 'deliveryNotes', 'recurringInvoices',
    'purchases', 'purchaseOrders', 'purchaseQuotes', 'debitNotes', 'requisitions', 'goodsReceipts',
    'cheques', 'customerAdvances', 'employeeAdvances', 'expenseClaims', 'stockAdjustments',
    'payrollRuns', 'employmentContracts', 'workOrders', 'billsOfMaterials', 'projects',
    'leads', 'timeEntries', 'stockTransfers', 'leases',
  ]
  const deep = (v) => {
    if (Array.isArray(v)) return v.map(deep)
    if (v && typeof v === 'object') {
      const out = {}
      for (const [k, val] of Object.entries(v)) {
        out[k] = (typeof val === 'string' && (/Name$/.test(k) || k === 'name' || k === 'client' || k === 'company'))
          ? tr(val) : deep(val)
      }
      return out
    }
    return v
  }
  const patch = {}
  SLICES.forEach((k) => { if (Array.isArray(g()[k])) patch[k] = deep(g()[k]) })
  useStore.setState(patch)

  return { renamedAccounts: renamed.length, stillEnglish: untranslated.map((a) => a.name) }
}
