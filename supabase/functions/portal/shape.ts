// What a customer sees in the portal, cut down from the company's synced
// records. No network, no Deno APIs: the app's unit tests import this file.
//
// Only fields a customer would see on the printed invoice leave the server:
// no costs, margins, accounts, journal links, internal notes or other
// customers. Drafts and voided documents are left out.

type Rec = Record<string, unknown>;
const num = (v: unknown) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const str = (v: unknown, max = 300) => String(v ?? "").slice(0, max);

const live = (d: Rec) => d && !["void", "cancelled", "draft"].includes(String(d.status));

export function shapePortal({ settings = {}, customer = {}, invoices = [], creditNotes = [], today = "" }: {
  settings?: Rec; customer?: Rec; invoices?: Rec[]; creditNotes?: Rec[]; today?: string;
}) {
  const company = (settings.company ?? {}) as Rec;
  const invSettings = (settings.invoice ?? {}) as Rec;
  const zatca = (settings.zatca ?? {}) as Rec;
  const customerId = String(customer.id ?? "");
  const mine = <T extends Rec>(xs: T[]) => xs.filter((d) => String(d.customerId) === customerId && live(d));

  const notes = mine(creditNotes);
  const credited = (invId: unknown) => notes.filter((n) => n.invoiceId === invId).reduce((s, n) => s + num(n.total), 0);

  const docs = mine(invoices)
    .map((i) => {
      const due = r2(Math.max(0, num(i.total) - num(i.amountPaid) - credited(i.id)));
      return {
        id: str(i.id, 80),
        number: str(i.number, 40),
        date: str(i.date, 10),
        dueDate: str(i.dueDate, 10),
        status: due <= 0.005 ? "paid" : (i.dueDate && today && String(i.dueDate) < today ? "overdue" : (num(i.amountPaid) > 0 ? "partial" : "open")),
        currency: str(i.currency || company.currency, 3),
        subtotal: r2(num(i.subtotal)),
        taxAmount: r2(num(i.taxAmount)),
        total: r2(num(i.total)),
        paid: r2(num(i.amountPaid)),
        credited: r2(credited(i.id)),
        due,
        notes: str(i.notes, 1000),
        items: (Array.isArray(i.items) ? i.items as Rec[] : []).slice(0, 200).map((l) => ({
          description: str(l.description || l.name, 300),
          quantity: num(l.quantity),
          unitPrice: r2(num(l.unitPrice)),
          taxRate: num(l.taxRate),
          amount: r2(num(l.subtotal ?? num(l.quantity) * num(l.unitPrice))),
        })),
        payments: (Array.isArray(i.payments) ? i.payments as Rec[] : []).map((p) => ({
          date: str(p.date, 10), amount: r2(num(p.amount)), number: str(p.number, 40),
        })),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  // Balance in the company's own currency: foreign invoices at their own rate.
  const rate = (id: string) => num((invoices.find((i) => i.id === id) ?? {}).exchangeRate) || 1;
  const unapplied = notes.filter((n) => !n.invoiceId).reduce((s, n) => s + num(n.total) * (num(n.exchangeRate) || 1), 0);
  const balance = r2(docs.reduce((s, d) => s + d.due * rate(d.id), 0) - unapplied);

  return {
    company: {
      name: str(company.name, 120),
      address: str(company.address, 300),
      phone: str(company.phone, 40),
      email: str(company.email, 120),
      taxId: str(zatca.vatNumber || company.taxId, 40),
      currency: str(company.currency, 3),
      currencySymbol: str(company.currencySymbol, 8),
      logo: typeof company.logo === "string" && company.logo.startsWith("data:image/") && company.logo.length < 400_000 ? company.logo : "",
      bankDetails: str(invSettings.bankDetails, 600),
    },
    customer: { name: str(customer.name, 120) },
    balance,
    invoices: docs,
    creditNotes: notes.map((n) => ({
      number: str(n.number, 40), date: str(n.date, 10), total: r2(num(n.total)),
      invoiceNumber: str(n.invoiceNumber, 40),
    })),
  };
}
