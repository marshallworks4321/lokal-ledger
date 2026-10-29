"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Command,
  CreditCard,
  Headphones,
  LayoutDashboard,
  LogOut,
  MapPin,
  MessageCircle,
  Menu,
  Mic,
  Moon,
  Package,
  Pencil,
  Phone,
  Plus,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Sun,
  TrendingUp,
  Undo2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Image from "next/image";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient, getSupabaseConfig } from "@/lib/supabase/client";

type Business = { id: string; name: string; ownerId: string };
type SubscriptionSummary = {
  businessId: string;
  ownerId: string;
  status: "trialing" | "active" | "past_due" | "canceled";
  trialStartedAt: string;
  trialEndsAt: string;
  planTier: "single" | "multi" | null;
  nextPaymentDate: string | null;
  cancelAtPeriodEnd: boolean;
  branchCount: number;
  hasAccess: boolean;
  canManage: boolean;
};
type Location = { id: string; businessId: string; name: string };
type StockItem = {
  id: string;
  businessId: string;
  locationId: string;
  name: string;
  category: string;
  branch: string;
  stock: number;
  unitPrice: number;
  averageCost: number | null;
  reorderLevel: number;
  archivedAt: string | null;
};
type ServiceJobDraft = {
  businessId: string;
  locationId: string;
  locationName: string;
};
type LedgerEntry = {
  id: string;
  source: "sale" | "service";
  businessId: string;
  locationId: string;
  customer: string;
  customerPhone: string;
  branch: string;
  item: string;
  quantity: number;
  total: number;
  paid: number;
  dueDate: string;
  payments: PaymentHistory[];
};
type PaymentHistory = {
  id: string;
  source: "sale" | "service";
  amount: number;
  createdAt: string;
};
type RepaymentRecord = PaymentHistory & {
  locationId: string;
  customer: string;
  item: string;
  branch: string;
};
type Customer = {
  id: string;
  businessId: string;
  fullName: string;
  phone: string;
  notes: string;
};
type ServiceRecord = {
  id: string;
  businessId: string;
  locationId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  branch: string;
  title: string;
  description: string;
  dueDate: string;
  status: "pending" | "completed";
};
type BusinessInsights = {
  productSales: number;
  productCollections: number;
  estimatedProductCostOfGoods: number;
  inventoryValueAtCost: number;
  inventoryProductsWithCost: number;
  salesLinesWithoutCost: number;
};
type ServiceJob = {
  id: string;
  businessId: string;
  locationId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  branch: string;
  title: string;
  description: string;
  serviceDate: string;
  totalAmount: number;
  amountPaid: number;
  dueDate: string;
  payments: PaymentHistory[];
};
type Transaction = {
  id: string;
  transactionId: string;
  businessId: string;
  locationId: string;
  customerId: string | null;
  customerName: string | null;
  kind: "Sale" | "Restock";
  item: string;
  quantity: number;
  branch: string;
  amount: number;
  date: string;
};
type SaleDraftLine = {
  itemId: string;
  item: string;
  quantity: number;
  unitPrice: number;
  averageCost: number | null;
};
type SaleDraft = {
  kind: "sale" | "restock";
  businessId: string;
  locationId: string;
  locationName: string;
  lines: SaleDraftLine[];
};
type SmartLogParseResult = {
  serviceTitle: string | null;
  locationName: string | null;
  customerName: string | null;
  statedTotal: number | null;
  amountPaid: number | null;
  paymentFraction: number | null;
  dueDate: string | null;
  items: Array<{ name: string; quantity: number; unitPrice: number | null }>;
};
type Workspace = {
  businesses: Business[];
  locations: Location[];
  inventory: StockItem[];
  archivedInventory: StockItem[];
  customers: Customer[];
  services: ServiceRecord[];
  serviceJobs: ServiceJob[];
  ledger: LedgerEntry[];
  repayments: RepaymentRecord[];
  transactions: Transaction[];
  insightsByLocation: Record<string, BusinessInsights>;
  subscriptionSummaries: SubscriptionSummary[];
};
type View = "Overview" | "Inventory" | "Locations" | "Customers" | "Service log" | "Credit ledger" | "Insights" | "Subscription";
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

const ALL_LOCATIONS = "all";
const blankWorkspace: Workspace = {
  businesses: [],
  locations: [],
  inventory: [],
  archivedInventory: [],
  customers: [],
  services: [],
  serviceJobs: [],
  ledger: [],
  repayments: [],
  transactions: [],
  insightsByLocation: {},
  subscriptionSummaries: [],
};

function localDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getServiceReminderMessage(
  entry: Pick<ServiceRecord, "customerName" | "branch" | "title" | "dueDate" | "description">,
) {
  const dueDate = entry.dueDate ? formatDate(entry.dueDate) : "a date to be confirmed";
  return `Hello ${entry.customerName}, this is a reminder from ${entry.branch} about ${entry.title}, due ${dueDate}.${entry.description ? ` ${entry.description}` : ""} Please contact us if you have already arranged this service.`;
}

function getCreditReminderMessage(entry: LedgerEntry) {
  return `Hello ${entry.customer}, this is a friendly reminder from ${entry.branch} about the outstanding balance of ${formatNaira(entry.total - entry.paid)} for ${entry.item}. Please contact us if you have already paid.`;
}

function getWhatsAppNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  const international = value.trim().startsWith("+") || digits.startsWith("234")
    ? digits
    : digits.startsWith("0")
      ? `234${digits.slice(1)}`
      : "";
  return international.length >= 10 && international.length <= 15 ? international : null;
}

function getSmsNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

function getGreeting(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function readSavedTheme() {
  try {
    return typeof window !== "undefined" &&
      window.localStorage.getItem("lokal-ledger-dark") === "true";
  } catch {
    return false;
  }
}

const formatNaira = (value: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(value);

function getErrorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "object" && reason !== null && "message" in reason) {
    const message = reason.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "An unexpected error occurred. Please try again or contact support.";
}

function isSmartLogParseResult(value: unknown, kind: "sale" | "restock" | "service"): value is SmartLogParseResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const parsed = value as Record<string, unknown>;
  if (
    (parsed.serviceTitle !== null && (
      typeof parsed.serviceTitle !== "string" ||
      parsed.serviceTitle.length > 160
    )) ||
    (parsed.locationName !== null && typeof parsed.locationName !== "string") ||
    (parsed.customerName !== null && typeof parsed.customerName !== "string") ||
    (parsed.statedTotal !== null && (!Number.isSafeInteger(parsed.statedTotal) || Number(parsed.statedTotal) < 1)) ||
    (parsed.amountPaid !== null && (!Number.isSafeInteger(parsed.amountPaid) || Number(parsed.amountPaid) < 0)) ||
    (parsed.paymentFraction !== null && (
      typeof parsed.paymentFraction !== "number" ||
      parsed.paymentFraction < 0 ||
      parsed.paymentFraction > 1
    )) ||
    (parsed.dueDate !== null && typeof parsed.dueDate !== "string") ||
    !Array.isArray(parsed.items) ||
    parsed.items.length > 12 ||
    (kind === "service" ? parsed.items.length > 0 : parsed.items.length === 0)
  ) return false;
  const parsedItems: unknown[] = parsed.items;
  for (const item of parsedItems) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
    const parsedItem = item as Record<string, unknown>;
    if (
      typeof parsedItem.name !== "string" ||
      !parsedItem.name.trim() ||
      !Number.isSafeInteger(parsedItem.quantity) ||
      Number(parsedItem.quantity) < 1 ||
      (parsedItem.unitPrice !== null &&
        (!Number.isSafeInteger(parsedItem.unitPrice) || Number(parsedItem.unitPrice) < 0))
    ) return false;
  }
  return true;
}

function findInventoryMatch(name: string, inventory: StockItem[]) {
  const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  const wanted = normalize(name);
  const exact = inventory.filter((item) => normalize(item.name) === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const wordsFor = (value: string) =>
    value.toLowerCase().replace(/\d+[a-z]*|[a-z]+\d+/g, " ").match(/[a-z]+/g) ?? [];
  const aliases = inventory.map((item) => {
    const words = wordsFor(item.name);
    const finalWord = words.at(-1) ?? normalize(item.name);
    const unique = inventory.filter((candidate) => wordsFor(candidate.name).at(-1) === finalWord).length === 1;
    return { item, alias: unique ? finalWord : normalize(item.name) };
  });
  const matches = aliases.filter(({ alias }) => normalize(alias) === wanted);
  return matches.length === 1 ? matches[0].item : null;
}

async function loadWorkspace(client: SupabaseClient): Promise<Workspace> {
  const businessResult = await client.from("businesses").select("id, name, owner_id").order("created_at");
  if (businessResult.error) throw businessResult.error;
  const businesses: Business[] = businessResult.data.map((business) => ({
    id: business.id,
    name: business.name,
    ownerId: business.owner_id,
  }));
  if (businesses.length === 0) return blankWorkspace;

  const businessIds = businesses.map((business) => business.id);
  const subscriptionSummaries = (await Promise.all(businesses.map(async (business) => {
    const { data, error } = await client.rpc("get_business_subscription_summary", {
      target_business_id: business.id,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;
    return {
      businessId: business.id,
      ownerId: String(row.owner_id),
      status: row.status as SubscriptionSummary["status"],
      trialStartedAt: String(row.trial_started_at),
      trialEndsAt: String(row.trial_ends_at),
      planTier: row.plan_tier === "single" || row.plan_tier === "multi" ? row.plan_tier : null,
      nextPaymentDate: typeof row.next_payment_date === "string" ? row.next_payment_date : null,
      cancelAtPeriodEnd: row.cancel_at_period_end === true,
      branchCount: Number(row.branch_count),
      hasAccess: row.has_access === true,
      canManage: row.can_manage === true,
    } satisfies SubscriptionSummary;
  }))).filter((summary): summary is SubscriptionSummary => summary !== null);
  const locationResult = await client
    .from("locations")
    .select("id, business_id, name")
    .in("business_id", businessIds)
    .order("created_at");
  if (locationResult.error) throw locationResult.error;
  const locations: Location[] = locationResult.data.map((location) => ({
    id: location.id,
    businessId: location.business_id,
    name: location.name,
  }));
  const customerResult = await client
    .from("customers")
    .select("id, business_id, full_name, phone, notes")
    .in("business_id", businessIds)
    .order("full_name");
  if (customerResult.error) throw customerResult.error;
  const customers: Customer[] = customerResult.data.map((customer) => ({
    id: customer.id,
    businessId: customer.business_id,
    fullName: customer.full_name,
    phone: customer.phone ?? "",
    notes: customer.notes,
  }));
  if (locations.length === 0) {
    return { ...blankWorkspace, businesses, locations, customers, subscriptionSummaries };
  }

  const locationById = new Map(locations.map((location) => [location.id, location]));
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const productResult = await client
    .from("products")
    .select("id, business_id, location_id, name, category, quantity, unit_price, average_cost, reorder_level, archived_at")
    .in("business_id", businessIds);
  if (productResult.error) throw productResult.error;
  const allProducts: StockItem[] = productResult.data.map((product) => ({
    id: product.id,
    businessId: product.business_id,
    locationId: product.location_id,
    name: product.name,
    category: product.category,
    branch: locationById.get(product.location_id)?.name ?? "Unknown location",
    stock: Number(product.quantity),
    unitPrice: Number(product.unit_price),
    averageCost: product.average_cost === null ? null : Number(product.average_cost),
    reorderLevel: Number(product.reorder_level),
    archivedAt: product.archived_at,
  }));
  const inventory = allProducts.filter((product) => product.archivedAt === null);
  const archivedInventory = allProducts.filter((product) => product.archivedAt !== null);

  const transactionResult = await client
    .from("transactions")
    .select("id, business_id, location_id, kind, customer_name, customer_id, total_amount, amount_paid, due_date, created_at")
    .in("business_id", businessIds)
    .order("created_at", { ascending: false });
  if (transactionResult.error) throw transactionResult.error;
  const serviceResult = await client
    .from("service_records")
    .select("id, business_id, location_id, customer_id, title, description, due_date, status")
    .in("business_id", businessIds)
    .order("due_date");
  if (serviceResult.error) throw serviceResult.error;
  const serviceJobResult = await client
    .from("service_jobs")
    .select("id, business_id, location_id, customer_id, title, description, service_date, total_amount, amount_paid, due_date")
    .in("business_id", businessIds)
    .order("service_date", { ascending: false });
  if (serviceJobResult.error) throw serviceJobResult.error;
  const services: ServiceRecord[] = serviceResult.data.map((record) => ({
    id: record.id,
    businessId: record.business_id,
    locationId: record.location_id,
    customerId: record.customer_id,
    customerName: customerById.get(record.customer_id)?.fullName ?? "Customer",
    customerPhone: customerById.get(record.customer_id)?.phone ?? "",
    branch: locationById.get(record.location_id)?.name ?? "Unknown location",
    title: record.title,
    description: record.description,
    dueDate: record.due_date,
    status: record.status,
  }));
  const serviceJobs: ServiceJob[] = serviceJobResult.data.map((job) => ({
    id: job.id,
    businessId: job.business_id,
    locationId: job.location_id,
    customerId: job.customer_id,
    customerName: customerById.get(job.customer_id)?.fullName ?? "Customer",
    customerPhone: customerById.get(job.customer_id)?.phone ?? "",
    branch: locationById.get(job.location_id)?.name ?? "Unknown location",
    title: job.title,
    description: job.description,
    serviceDate: job.service_date,
    totalAmount: Number(job.total_amount),
    amountPaid: Number(job.amount_paid),
    dueDate: job.due_date ?? "",
    payments: [],
  }));
  const transactionIds = transactionResult.data.map((transaction) => transaction.id);
  const itemResult = transactionIds.length
    ? await client
        .from("transaction_items")
        .select("id, transaction_id, product_id, quantity, unit_price, unit_cost, line_total")
        .in("transaction_id", transactionIds)
    : { data: [], error: null };
  if (itemResult.error) throw itemResult.error;

  const productById = new Map(allProducts.map((product) => [product.id, product]));
  const transactionById = new Map(transactionResult.data.map((transaction) => [transaction.id, transaction]));
  const paymentTransactionIds = transactionResult.data
    .filter((transaction) => transaction.kind === "sale")
    .map((transaction) => transaction.id);
  const paymentServiceJobIds = serviceJobs.map((job) => job.id);
  const transactionPaymentResult = paymentTransactionIds.length
    ? await client.from("transaction_payments")
        .select("id, transaction_id, amount, created_at")
        .in("transaction_id", paymentTransactionIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (transactionPaymentResult.error) throw transactionPaymentResult.error;
  const servicePaymentResult = paymentServiceJobIds.length
    ? await client.from("service_job_payments")
        .select("id, service_job_id, amount, created_at")
        .in("service_job_id", paymentServiceJobIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (servicePaymentResult.error) throw servicePaymentResult.error;
  const paymentsByRecord = new Map<string, PaymentHistory[]>();
  for (const payment of transactionPaymentResult.data) {
    const history = paymentsByRecord.get(payment.transaction_id) ?? [];
    history.push({
      id: payment.id,
      source: "sale",
      amount: Number(payment.amount),
      createdAt: payment.created_at,
    });
    paymentsByRecord.set(payment.transaction_id, history);
  }
  for (const payment of servicePaymentResult.data) {
    const history = paymentsByRecord.get(payment.service_job_id) ?? [];
    history.push({
      id: payment.id,
      source: "service",
      amount: Number(payment.amount),
      createdAt: payment.created_at,
    });
    paymentsByRecord.set(payment.service_job_id, history);
  }
  for (const job of serviceJobs) {
    job.payments = paymentsByRecord.get(job.id) ?? [];
  }
  const insightsByLocation: Record<string, BusinessInsights> = Object.fromEntries(
    locations.map((location) => [location.id, {
      productSales: 0,
      productCollections: 0,
      estimatedProductCostOfGoods: 0,
      inventoryValueAtCost: 0,
      inventoryProductsWithCost: 0,
      salesLinesWithoutCost: 0,
    }]),
  );
  for (const transaction of transactionResult.data) {
    if (transaction.kind !== "sale") continue;
    const insight = insightsByLocation[transaction.location_id];
    if (insight) {
      insight.productSales += Number(transaction.total_amount);
      insight.productCollections += Number(transaction.amount_paid);
    }
  }
  for (const item of itemResult.data) {
    const transaction = transactionById.get(item.transaction_id);
    if (transaction?.kind !== "sale") continue;
    if (item.unit_cost !== null) {
      const insight = insightsByLocation[transaction.location_id];
      if (insight) {
        insight.estimatedProductCostOfGoods += Number(item.quantity) * Number(item.unit_cost);
      }
    } else {
      const insight = insightsByLocation[transaction.location_id];
      if (insight) insight.salesLinesWithoutCost += 1;
    }
  }
  for (const product of inventory) {
    const insight = insightsByLocation[product.locationId];
    if (insight && product.averageCost !== null) {
      insight.inventoryValueAtCost += product.stock * product.averageCost;
      insight.inventoryProductsWithCost += 1;
    }
  }
  const itemsByTransaction = new Map<string, typeof itemResult.data>();
  for (const item of itemResult.data) {
    const current = itemsByTransaction.get(item.transaction_id) ?? [];
    current.push(item);
    itemsByTransaction.set(item.transaction_id, current);
  }
  const serviceJobById = new Map(serviceJobs.map((job) => [job.id, job]));
  const repayments: RepaymentRecord[] = [
    ...transactionPaymentResult.data.flatMap((payment) => {
      const transaction = transactionById.get(payment.transaction_id);
      if (!transaction) return [];
      const items = itemsByTransaction.get(transaction.id) ?? [];
      return [{
        id: payment.id,
        source: "sale" as const,
        amount: Number(payment.amount),
        createdAt: payment.created_at,
        locationId: transaction.location_id,
        customer: transaction.customer_name ?? "Customer",
        item: items.map((item) =>
          `${item.quantity} × ${productById.get(item.product_id)?.name ?? "Deleted product"}`,
        ).join(", "),
        branch: locationById.get(transaction.location_id)?.name ?? "Unknown location",
      }];
    }),
    ...servicePaymentResult.data.flatMap((payment) => {
      const job = serviceJobById.get(payment.service_job_id);
      return job ? [{
        id: payment.id,
        source: "service" as const,
        amount: Number(payment.amount),
        createdAt: payment.created_at,
        locationId: job.locationId,
        customer: job.customerName,
        item: job.title,
        branch: job.branch,
      }] : [];
    }),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const transactions: Transaction[] = [];
  const ledger: LedgerEntry[] = [];
  for (const transaction of transactionResult.data) {
    const items = itemsByTransaction.get(transaction.id) ?? [];
    const location = locationById.get(transaction.location_id);
    const branch = location?.name ?? "Unknown location";
    for (const item of items) {
      transactions.push({
        id: item.id,
        transactionId: transaction.id,
        businessId: transaction.business_id,
        locationId: transaction.location_id,
        customerId: transaction.customer_id,
        customerName: transaction.customer_name,
        kind: transaction.kind === "sale" ? "Sale" : "Restock",
        item: productById.get(item.product_id)?.name ?? "Deleted product",
        quantity: Number(item.quantity),
        branch,
        amount: Number(item.line_total),
        date: new Date(transaction.created_at).toLocaleString("en-NG", {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      });
    }
    if (transaction.kind === "sale" && Number(transaction.amount_paid) < Number(transaction.total_amount)) {
      ledger.push({
        id: transaction.id,
        source: "sale",
        businessId: transaction.business_id,
        locationId: transaction.location_id,
        customer: transaction.customer_name ?? "Customer",
        customerPhone: customerById.get(transaction.customer_id ?? "")?.phone ?? "",
        branch,
        item: items.map((item) =>
          `${item.quantity} × ${productById.get(item.product_id)?.name ?? "Deleted product"}`,
        ).join(", "),
        quantity: items.reduce((sum, item) => sum + Number(item.quantity), 0),
        total: Number(transaction.total_amount),
        paid: Number(transaction.amount_paid),
        dueDate: transaction.due_date ?? "",
        payments: paymentsByRecord.get(transaction.id) ?? [],
      });
    }
  }

  for (const job of serviceJobs) {
    if (job.amountPaid < job.totalAmount) {
      ledger.push({
        id: job.id,
        source: "service",
        businessId: job.businessId,
        locationId: job.locationId,
        customer: job.customerName,
        customerPhone: job.customerPhone,
        branch: job.branch,
        item: job.title,
        quantity: 1,
        total: job.totalAmount,
        paid: job.amountPaid,
        dueDate: job.dueDate,
        payments: paymentsByRecord.get(job.id) ?? [],
      });
    }
  }

  return {
    businesses,
    locations,
    inventory,
    archivedInventory,
    customers,
    services,
    serviceJobs,
    ledger,
    repayments,
    transactions,
    insightsByLocation,
    subscriptionSummaries,
  };
}

export default function LedgerWorkspace() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [workspaceLoadedFor, setWorkspaceLoadedFor] = useState<string | null>(null);
  const [workspaceLoadError, setWorkspaceLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [workspace, setWorkspace] = useState<Workspace>(blankWorkspace);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationBusinessId, setNewLocationBusinessId] = useState("");
  const [view, setView] = useState<View>("Overview");
  const [greeting, setGreeting] = useState("Welcome");
  const [locationFilter, setLocationFilter] = useState(ALL_LOCATIONS);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [locationFilterMenuOpen, setLocationFilterMenuOpen] = useState(false);
  const [smartLocationId, setSmartLocationId] = useState("");
  const [smartEntryKind, setSmartEntryKind] = useState<"sale" | "restock" | "service">("restock");
  const [darkMode, setDarkMode] = useState(readSavedTheme);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [prompt, setPrompt] = useState("");
  const [smartParsing, setSmartParsing] = useState(false);
  const [manualEntryNote, setManualEntryNote] = useState("");
  const [aiInsights, setAiInsights] = useState<string[]>([]);
  const [aiInsightsScope, setAiInsightsScope] = useState("");
  const [aiInsightsError, setAiInsightsError] = useState("");
  const [aiInsightsBusy, setAiInsightsBusy] = useState(false);
  const [draft, setDraft] = useState<SaleDraft | null>(null);
  const [serviceJobDraft, setServiceJobDraft] = useState<ServiceJobDraft | null>(null);
  const [serviceJobTitle, setServiceJobTitle] = useState("");
  const [serviceJobDescription, setServiceJobDescription] = useState("");
  const [serviceJobDate, setServiceJobDate] = useState("");
  const [serviceJobPhone, setServiceJobPhone] = useState("");
  const [serviceMaintenanceDate, setServiceMaintenanceDate] = useState("");
  const [saleTotal, setSaleTotal] = useState("");
  const [statedTotal, setStatedTotal] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentFraction, setPaymentFraction] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [customerBusinessId, setCustomerBusinessId] = useState("");
  const [customerEditingId, setCustomerEditingId] = useState("");
  const [customerFullName, setCustomerFullName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [serviceLocationId, setServiceLocationId] = useState("");
  const [serviceCustomerName, setServiceCustomerName] = useState("");
  const [serviceCustomerPhone, setServiceCustomerPhone] = useState("");
  const [serviceTitle, setServiceTitle] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [serviceDueDate, setServiceDueDate] = useState("");
  const [today, setToday] = useState("");
  const [listening, setListening] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showArchivedInventory, setShowArchivedInventory] = useState(false);
  const [productName, setProductName] = useState("");
  const [productCategory, setProductCategory] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productAverageCost, setProductAverageCost] = useState("");
  const [productReorderLevel, setProductReorderLevel] = useState("5");
  const [costEditingProduct, setCostEditingProduct] = useState<StockItem | null>(null);
  const [averageCostValue, setAverageCostValue] = useState("");
  const [selectedPaymentEntry, setSelectedPaymentEntry] = useState<LedgerEntry | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");

  useEffect(() => {
    const updateGreeting = () => {
      const now = new Date();
      const date = localDateInputValue(now);
      setGreeting(getGreeting(now));
      setToday(date);
      setServiceDueDate((current) => current || date);
      setServiceJobDate((current) => current || date);
    };
    const initialUpdate = window.setTimeout(updateGreeting, 0);
    const interval = window.setInterval(updateGreeting, 60_000);
    return () => {
      window.clearTimeout(initialUpdate);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const billingResult = new URLSearchParams(window.location.search).get("billing");
    const message = billingResult === "success"
      ? "Payment verified. Your subscription is active."
      : billingResult === "processing"
        ? "Payment received. Subscription confirmation is still processing; refresh this page shortly."
        : billingResult === "failed"
          ? "Payment was not confirmed. No subscription access was activated."
          : "";
    if (!message) return;
    const timeout = window.setTimeout(() => setNotice(message), 0);
    window.history.replaceState({}, "", window.location.pathname);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!getSupabaseConfig()) {
      return;
    }
    let active = true;
    let unsubscribe = () => {};
    let knownUserId: string | null | undefined;
    void Promise.resolve()
      .then(() => {
        if (!active) return;
        const client = createClient();
        setSupabase(client);
        const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
          if (!active) return;
          const nextUser = session?.user ?? null;
          const nextUserId = nextUser?.id ?? null;
          if (knownUserId !== undefined && knownUserId !== nextUserId) {
            setWorkspace(blankWorkspace);
            setLocationFilter(ALL_LOCATIONS);
            setSmartLocationId("");
            setWorkspaceLoadedFor(null);
            setWorkspaceLoadError("");
            setError("");
            setManualEntryNote("");
          }
          knownUserId = nextUserId;
          setUser(nextUser);
          setAuthLoading(false);
        });
        unsubscribe = () => listener.subscription.unsubscribe();
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(`Could not initialize Supabase: ${getErrorMessage(reason)}`);
        setAuthLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !user) return;
    let active = true;
    void loadWorkspace(supabase)
      .then((result) => {
        if (!active) return;
        setWorkspace(result);
        setWorkspaceLoadedFor(user.id);
        setWorkspaceLoadError("");
        setServiceLocationId((current) =>
          result.locations.some((location) => location.id === current)
            ? current
            : result.locations[0]?.id ?? "",
        );
        setSmartLocationId((current) =>
          result.locations.some((location) => location.id === current)
            ? current
            : result.locations[0]?.id ?? "",
        );
        setNewLocationBusinessId((current) =>
          result.businesses.some((business) => business.id === current)
            ? current
            : result.businesses[0]?.id ?? "",
        );
        setCustomerBusinessId((current) =>
          result.businesses.some((business) => business.id === current)
            ? current
            : result.businesses[0]?.id ?? "",
        );
        setError("");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        const message = getErrorMessage(reason);
        setWorkspaceLoadError(message.includes("service_job_payments")
          ? "We couldn’t load repayment history because the latest database permissions are not installed. Run supabase/migrations/20261028030000_manual_followups_and_repayment_history.sql in the Supabase SQL Editor, then retry."
          : message.includes("get_business_subscription_summary")
            ? "Subscription setup is not installed. Run supabase/migrations/20261029120000_owner_subscriptions.sql in the Supabase SQL Editor, then retry."
          : ["average_cost", "unit_cost", "reorder_level"].some((column) => message.includes(column))
            ? "Inventory cost and stock-watch fields are not installed. Run supabase/migrations/20261028040000_cost_controls_and_stock_watch.sql in the Supabase SQL Editor, then retry."
          : `We couldn’t load your business data. ${message}`);
        setWorkspaceLoadedFor(user.id);
      });
    return () => {
      active = false;
    };
  }, [supabase, user, workspaceVersion]);

  const locationById = useMemo(
    () => new Map(workspace.locations.map((location) => [location.id, location])),
    [workspace.locations],
  );
  const businessById = useMemo(
    () => new Map(workspace.businesses.map((business) => [business.id, business])),
    [workspace.businesses],
  );
  const ownerSubscriptionSummaries = useMemo(
    () => [...new Map(workspace.subscriptionSummaries.map((summary) => [summary.ownerId, summary])).values()],
    [workspace.subscriptionSummaries],
  );
  const serviceCustomers = workspace.customers.filter(
    (customer) => customer.businessId === locationById.get(serviceLocationId)?.businessId,
  );
  const selectedServiceCustomer = serviceCustomers.find(
    (customer) => customer.fullName.toLowerCase() === serviceCustomerName.trim().toLowerCase(),
  );
  const selectedServiceLocation = locationById.get(serviceLocationId);
  const serviceContactMessage = selectedServiceCustomer
    ? getServiceReminderMessage({
        customerName: selectedServiceCustomer.fullName,
        branch: selectedServiceLocation?.name ?? "our business",
        title: serviceTitle.trim() || "a service follow-up",
        dueDate: serviceDueDate,
        description: serviceDescription.trim(),
      })
    : "";
  const serviceWhatsAppNumber = selectedServiceCustomer
    ? getWhatsAppNumber(selectedServiceCustomer.phone)
    : null;
  const serviceSmsNumber = selectedServiceCustomer
    ? getSmsNumber(selectedServiceCustomer.phone)
    : null;
  const inventory = workspace.inventory.filter(
    (item) => locationFilter === ALL_LOCATIONS || item.locationId === locationFilter,
  );
  const archivedInventory = workspace.archivedInventory.filter(
    (item) => locationFilter === ALL_LOCATIONS || item.locationId === locationFilter,
  );
  const ledger = workspace.ledger.filter(
    (entry) => entry.paid < entry.total && (locationFilter === ALL_LOCATIONS || entry.locationId === locationFilter),
  );
  const repayments = workspace.repayments.filter((entry) =>
    locationFilter === ALL_LOCATIONS || entry.locationId === locationFilter,
  );
  const transactions = workspace.transactions.filter(
    (entry) => locationFilter === ALL_LOCATIONS || entry.locationId === locationFilter,
  );
  const services = workspace.services.filter(
    (entry) => locationFilter === ALL_LOCATIONS || entry.locationId === locationFilter,
  );
  const serviceJobs = workspace.serviceJobs.filter(
    (job) => locationFilter === ALL_LOCATIONS || job.locationId === locationFilter,
  );
  const visibleCustomers = workspace.customers.filter((customer) =>
    locationFilter === ALL_LOCATIONS ||
    customer.businessId === locationById.get(locationFilter)?.businessId,
  );
  const totalRevenue = transactions
    .filter((transaction) => transaction.kind === "Sale")
    .reduce((sum, transaction) => sum + transaction.amount, 0) +
    serviceJobs.reduce((sum, job) => sum + job.totalAmount, 0);
  const visibleLocationIds = locationFilter === ALL_LOCATIONS
    ? workspace.locations.map((location) => location.id)
    : [locationFilter];
  const selectedInsights = visibleLocationIds.reduce<BusinessInsights>((total, locationId) => {
    const insight = workspace.insightsByLocation[locationId];
    if (!insight) return total;
    return {
      productSales: total.productSales + insight.productSales,
      productCollections: total.productCollections + insight.productCollections,
      estimatedProductCostOfGoods: total.estimatedProductCostOfGoods + insight.estimatedProductCostOfGoods,
      inventoryValueAtCost: total.inventoryValueAtCost + insight.inventoryValueAtCost,
      inventoryProductsWithCost: total.inventoryProductsWithCost + insight.inventoryProductsWithCost,
      salesLinesWithoutCost: total.salesLinesWithoutCost + insight.salesLinesWithoutCost,
    };
  }, {
    productSales: 0,
    productCollections: 0,
    estimatedProductCostOfGoods: 0,
    inventoryValueAtCost: 0,
    inventoryProductsWithCost: 0,
    salesLinesWithoutCost: 0,
  });
  const estimatedProductProfit = selectedInsights.productSales - selectedInsights.estimatedProductCostOfGoods;
  const outstanding = ledger.reduce((sum, entry) => sum + entry.total - entry.paid, 0);
  const lowStockCount = inventory.filter((item) => item.stock <= item.reorderLevel).length;
  const stockWatchItems = inventory.filter((item) => item.stock <= item.reorderLevel);
  const openCustomers = new Set(ledger.map((entry) => entry.customer)).size;
  const searchedInventory = inventory.filter((item) =>
    `${item.name} ${item.category} ${item.branch}`.toLowerCase().includes(query.toLowerCase()),
  );
  const searchedArchivedInventory = archivedInventory.filter((item) =>
    `${item.name} ${item.category} ${item.branch}`.toLowerCase().includes(query.toLowerCase()),
  );
  const searchedLedger = ledger.filter((entry) =>
    `${entry.customer} ${entry.item} ${entry.branch}`.toLowerCase().includes(query.toLowerCase()),
  );
  const searchedCustomers = visibleCustomers.filter((customer) =>
    `${customer.fullName} ${customer.phone} ${customer.notes}`.toLowerCase().includes(query.toLowerCase()),
  );
  const searchedServices = services.filter((entry) =>
    `${entry.customerName} ${entry.title} ${entry.description} ${entry.branch}`.toLowerCase().includes(query.toLowerCase()),
  );
  const searchedServiceJobs = serviceJobs.filter((job) =>
    `${job.customerName} ${job.title} ${job.description} ${job.branch}`.toLowerCase().includes(query.toLowerCase()),
  );
  const serviceDueCount = services.filter(
    (entry) => today !== "" && entry.status === "pending" && entry.dueDate <= today,
  ).length;

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4500);
  }

  function chooseWorkspaceLocation(locationId: string) {
    setLocationFilter(locationId);
    setAiInsights([]);
    setAiInsightsError("");
    if (locationId !== ALL_LOCATIONS) setSmartLocationId(locationId);
    setWorkspaceMenuOpen(false);
    setLocationFilterMenuOpen(false);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setError("");
    setBusy(true);
    try {
      if (authMode === "sign-up") {
        const { data, error: signupError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signupError) throw signupError;
        if (!data.session) {
          flash("Account created. Check your email to confirm it, then sign in.");
          setAuthMode("sign-in");
        } else {
          flash("Your account is ready.");
        }
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (loginError) throw loginError;
      }
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    const { error: signoutError } = await supabase.auth.signOut();
    if (signoutError) setError(`Could not sign out: ${signoutError.message}`);
  }

  async function beginSubscription(businessId: string, planTier: "single" | "multi") {
    if (billingBusy) return;
    setBillingBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, planTier }),
      });
      const result: unknown = await response.json();
      if (!response.ok || typeof result !== "object" || result === null || !("authorizationUrl" in result)) {
        const message = typeof result === "object" && result !== null && "message" in result && typeof result.message === "string"
          ? result.message
          : "Could not start Paystack checkout.";
        throw new Error(message);
      }
      const authorizationUrl = (result as { authorizationUrl: unknown }).authorizationUrl;
      if (typeof authorizationUrl !== "string") throw new Error("Paystack did not return a checkout link.");
      window.location.assign(authorizationUrl);
    } catch (reason) {
      setError(`Could not start subscription: ${getErrorMessage(reason)}`);
      setBillingBusy(false);
    }
  }

  async function cancelSubscription(businessId: string, pastDue = false) {
    if (billingBusy) return;
    const accepted = window.confirm(pastDue
      ? "Stop this failed subscription so the owner can start a fresh checkout? Access remains paused until a new payment succeeds."
      : "Stop future monthly renewals? Access will continue until the current paid period ends.");
    if (!accepted) return;
    setBillingBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "message" in result && typeof result.message === "string"
          ? result.message
          : "Paystack could not cancel the renewal.";
        throw new Error(message);
      }
      setWorkspaceLoadedFor(null);
      setWorkspaceVersion((version) => version + 1);
      flash("Renewal cancellation requested. Access remains available through the paid period.");
    } catch (reason) {
      setError(`Could not cancel renewal: ${getErrorMessage(reason)}`);
    } finally {
      setBillingBusy(false);
    }
  }

  function retryWorkspaceLoad() {
    setWorkspaceLoadError("");
    setWorkspaceLoadedFor(null);
    setWorkspaceVersion((version) => version + 1);
  }

  function toggleTheme() {
    const next = !darkMode;
    setDarkMode(next);
    try {
      window.localStorage.setItem("lokal-ledger-dark", String(next));
    } catch {
      setError("Could not save the theme preference in this browser.");
    }
  }

  async function createBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setError("");
    setBusy(true);
    try {
      const { error: createError } = await supabase.rpc("create_business_with_location", {
        business_name: businessName.trim(),
        first_location_name: locationName.trim(),
      });
      if (createError) throw createError;
      setBusinessName("");
      setLocationName("");
      setWorkspaceLoadedFor(null);
      setWorkspaceVersion((version) => version + 1);
      flash("Business and first location created.");
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function createLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    if (!newLocationBusinessId) {
      setError("Choose which business this location belongs to.");
      return;
    }
    if (!newLocationName.trim()) {
      setError("Enter a name for the new location.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { data, error: insertError } = await supabase
        .from("locations")
        .insert({
          business_id: newLocationBusinessId,
          name: newLocationName.trim(),
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      setNewLocationName("");
      setLocationFilter(data.id);
      setSmartLocationId(data.id);
      setWorkspaceVersion((version) => version + 1);
      flash("Location added. Add products and stock for this location.");
    } catch (reason) {
      setError(`Could not add this location: ${getErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const fullName = customerFullName.trim();
    if (!customerBusinessId) {
      setError("Choose which business this customer belongs to.");
      return;
    }
    if (fullName.length < 1 || fullName.length > 160) {
      setError("Enter a customer name between 1 and 160 characters.");
      return;
    }
    if (customerPhone.trim().length > 40 || customerNotes.trim().length > 1000) {
      setError("Keep the phone number under 40 characters and notes under 1,000 characters.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const customerValues = {
        business_id: customerBusinessId,
        full_name: fullName,
        phone: customerPhone.trim() || null,
        notes: customerNotes.trim(),
      };
      const saveResult = customerEditingId
        ? await supabase.from("customers").update(customerValues)
            .eq("id", customerEditingId)
            .eq("business_id", customerBusinessId)
            .select("id")
            .single()
        : await supabase.from("customers").insert(customerValues).select("id").single();
      if (saveResult.error) throw saveResult.error;
      const wasEditing = Boolean(customerEditingId);
      setCustomerEditingId("");
      setCustomerFullName("");
      setCustomerPhone("");
      setCustomerNotes("");
      setWorkspaceVersion((version) => version + 1);
      flash(wasEditing ? `${fullName}’s profile updated.` : `${fullName} added to your customer list.`);
    } catch (reason) {
      const duplicateName = typeof reason === "object" && reason !== null &&
        "code" in reason && reason.code === "23505";
      setError(duplicateName
        ? "A customer with this name already exists in this business. Find the existing profile and choose Edit."
        : `Could not ${customerEditingId ? "update" : "add"} customer: ${getErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  function editCustomer(customer: Customer) {
    setCustomerEditingId(customer.id);
    setCustomerBusinessId(customer.businessId);
    setCustomerFullName(customer.fullName);
    setCustomerPhone(customer.phone);
    setCustomerNotes(customer.notes);
  }

  function cancelCustomerEdit() {
    setCustomerEditingId("");
    setCustomerFullName("");
    setCustomerPhone("");
    setCustomerNotes("");
  }

  async function createServiceRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const location = locationById.get(serviceLocationId);
    if (!location || !serviceCustomerName.trim()) {
      setError("Choose a location and enter the customer's name.");
      return;
    }
    if (serviceCustomerName.trim().length > 160 || serviceCustomerPhone.trim().length > 40) {
      setError("Keep the customer name under 160 characters and phone under 40 characters.");
      return;
    }
    if (serviceTitle.trim().length < 2 || serviceTitle.trim().length > 120 || !serviceDueDate) {
      setError("Enter a service title and due date.");
      return;
    }
    if (serviceDescription.trim().length > 1200) {
      setError("Keep service notes under 1,200 characters.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { error: insertError } = await supabase.rpc("schedule_service_followup", {
        target_business_id: location.businessId,
        target_location_id: location.id,
        customer: serviceCustomerName.trim(),
        customer_phone: serviceCustomerPhone.trim(),
        follow_up_title: serviceTitle.trim(),
        follow_up_description: serviceDescription.trim(),
        follow_up_due: serviceDueDate,
      });
      if (insertError) throw insertError;
      const savedCustomerName = serviceCustomerName.trim();
      setServiceCustomerName("");
      setServiceCustomerPhone("");
      setServiceTitle("");
      setServiceDescription("");
      setServiceDueDate(localDateInputValue(new Date()));
      setWorkspaceVersion((version) => version + 1);
      flash(`Service follow-up scheduled for ${savedCustomerName}.`);
    } catch (reason) {
      setError(`Could not schedule service follow-up: ${getErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  function startServiceJobDraft() {
    const location = workspace.locations.find((entry) => entry.id === locationFilter)
      ?? workspace.locations.find((entry) => entry.id === smartLocationId)
      ?? workspace.locations[0];
    if (!location) {
      setError("Add a business location before recording a service job.");
      return;
    }
    setError("");
    setServiceJobDraft({
      businessId: location.businessId,
      locationId: location.id,
      locationName: location.name,
    });
    setDraft(null);
    setServiceJobTitle("");
    setServiceJobDescription("");
    setServiceJobDate(today || localDateInputValue(new Date()));
    setServiceJobPhone("");
    setServiceMaintenanceDate("");
    setCustomerName("");
    setSaleTotal("");
    setStatedTotal(null);
    setAmountPaid("");
    setPaymentFraction(null);
    setDueDate("");
    setView("Service log");
  }

  function startManualEntry(kind: "sale" | "restock") {
    const location = workspace.locations.find((entry) => entry.id === locationFilter)
      ?? workspace.locations.find((entry) => entry.id === smartLocationId)
      ?? workspace.locations[0];
    if (!location) {
      setError("Add a business location before recording a sale or restock.");
      return;
    }
    if (!workspace.inventory.some((item) => item.locationId === location.id)) {
      setError(`Add a product to ${location.name} before recording a ${kind}.`);
      return;
    }
    setError("");
    setDraft({
      kind,
      businessId: location.businessId,
      locationId: location.id,
      locationName: location.name,
      lines: [],
    });
    setServiceJobDraft(null);
    setLocationFilter(location.id);
    setSmartLocationId(location.id);
    setSaleTotal("0");
    setStatedTotal(null);
    setCustomerName("");
    setAmountPaid(kind === "sale" ? "" : "0");
    setPaymentFraction(null);
    setDueDate("");
    setView("Overview");
  }

  async function confirmServiceJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !serviceJobDraft) return;
    const total = Number(saleTotal);
    const paid = Number(amountPaid);
    if (!customerName.trim()) {
      setError("Enter the customer's name.");
      return;
    }
    if (serviceJobTitle.trim().length < 2) {
      setError("Describe the service that was completed.");
      return;
    }
    if (!serviceJobDate) {
      setError("Choose the date the service was provided.");
      return;
    }
    if (serviceJobPhone.trim().length > 40) {
      setError("Keep the customer's phone number under 40 characters.");
      return;
    }
    if (serviceMaintenanceDate && serviceMaintenanceDate < serviceJobDate) {
      setError("The maintenance follow-up date cannot be before the service date.");
      return;
    }
    if (!Number.isSafeInteger(total) || total <= 0) {
      setError("Enter the agreed service fee as a whole number greater than zero.");
      return;
    }
    if (amountPaid === "" || !Number.isSafeInteger(paid) || paid < 0 || paid > total) {
      setError("Enter how much the customer paid. Enter 0 if the service is unpaid.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { error: saveError } = await supabase.rpc("record_service_job", {
        target_business_id: serviceJobDraft.businessId,
        target_location_id: serviceJobDraft.locationId,
        customer: customerName.trim(),
        customer_phone: serviceJobPhone.trim(),
        service_title: serviceJobTitle.trim(),
        service_description: serviceJobDescription.trim(),
        service_date: serviceJobDate,
        service_total: total,
        paid_amount: paid,
        payment_due: paid < total
          ? dueDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
          : null,
        maintenance_due: serviceMaintenanceDate || null,
      });
      if (saveError) throw saveError;
      setServiceJobDraft(null);
      setServiceJobTitle("");
      setServiceJobDescription("");
      setServiceJobPhone("");
      setServiceMaintenanceDate("");
      setCustomerName("");
      setSaleTotal("");
      setStatedTotal(null);
      setAmountPaid("");
      setPaymentFraction(null);
      setDueDate("");
      setWorkspaceVersion((version) => version + 1);
      flash(`Service job saved${serviceMaintenanceDate ? " and maintenance follow-up scheduled" : ""}. ${paid < total ? `${formatNaira(total - paid)} remains outstanding.` : "Payment received in full."}`);
    } catch (reason) {
      setError(`Could not save service job: ${getErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function completeServiceRecord(record: ServiceRecord) {
    if (!supabase) return;
    setBusy(true);
    const nextStatus = record.status === "completed" ? "pending" : "completed";
    const { error: updateError } = await supabase
      .from("service_records")
      .update({
        status: nextStatus,
        completed_at: nextStatus === "completed" ? new Date().toISOString() : null,
      })
      .eq("id", record.id);
    setBusy(false);
    if (updateError) {
      setError(`Could not ${nextStatus === "completed" ? "complete" : "undo completion for"} service follow-up: ${updateError.message}`);
      return;
    }
    setWorkspaceVersion((version) => version + 1);
    flash(nextStatus === "completed"
      ? `Follow-up for ${record.customerName} marked complete.`
      : `Follow-up for ${record.customerName} reopened.`);
  }

  async function copyServiceReminder(record: ServiceRecord) {
    const message = getServiceReminderMessage(record);
    try {
      await navigator.clipboard.writeText(message);
      flash("Reminder draft copied. Review and send it yourself; no message was sent.");
    } catch {
      setError("Could not copy the reminder. Check your browser clipboard permissions.");
    }
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const location = locationById.get(smartLocationId);
    const price = Number(productPrice);
    if (!location) {
      setError("Select a specific location before adding a product.");
      return;
    }
    const averageCost = productAverageCost === "" ? null : Number(productAverageCost);
    const reorderLevel = Number(productReorderLevel);
    if (!productName.trim() || !Number.isSafeInteger(price) || price < 0 ||
      (averageCost !== null && (!Number.isSafeInteger(averageCost) || averageCost < 0)) ||
      !Number.isSafeInteger(reorderLevel) || reorderLevel < 0 || reorderLevel > 1000000) {
      setError("Enter a product name, valid prices, and a stock alert quantity from 0 to 1,000,000.");
      return;
    }
    if (averageCost !== null && price < averageCost) {
      setError("The selling price cannot be below the current unit cost.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { error: insertError } = await supabase.from("products").insert({
        business_id: location.businessId,
        location_id: location.id,
        name: productName.trim(),
        category: productCategory.trim() || "Uncategorized",
        unit_price: price,
        average_cost: averageCost,
        reorder_level: reorderLevel,
      });
      if (insertError) throw insertError;
      setProductName("");
      setProductCategory("");
      setProductPrice("");
      setProductAverageCost("");
      setProductReorderLevel("5");
      setShowProductForm(false);
      setLocationFilter(smartLocationId);
      setWorkspaceVersion((version) => version + 1);
      flash("Product added. Record its first restock cost to establish its average cost.");
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveAverageCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !costEditingProduct) return;
    const cost = Number(averageCostValue);
    if (!Number.isSafeInteger(cost) || cost < 0) {
      setError("Enter a valid, non-negative whole-number unit cost.");
      return;
    }
    if (cost > costEditingProduct.unitPrice) {
      setError("The unit cost cannot be higher than the selling price. Update the selling price first.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { error: saveError } = await supabase.rpc("set_product_average_cost", {
        target_product_id: costEditingProduct.id,
        next_average_cost: cost,
      });
      if (saveError) throw saveError;
      setCostEditingProduct(null);
      setAverageCostValue("");
      setWorkspaceVersion((version) => version + 1);
      flash(`Average cost updated for ${costEditingProduct.name}.`);
    } catch (reason) {
      setError(`Could not update the average cost: ${getErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveReorderLevel(productId: string, reorderLevel: number) {
    if (!supabase || !Number.isSafeInteger(reorderLevel) || reorderLevel < 0 || reorderLevel > 1000000) {
      setError("Enter a whole-number stock alert quantity from 0 to 1,000,000.");
      return;
    }
    setError("");
    setBusy(true);
    const { error: saveError } = await supabase
      .from("products")
      .update({ reorder_level: reorderLevel })
      .eq("id", productId);
    setBusy(false);
    if (saveError) {
      setError(`Could not update the stock alert: ${saveError.message}`);
      return;
    }
    setWorkspaceVersion((version) => version + 1);
    flash("Stock watch alert updated.");
  }

  async function saveSellingPrice(product: StockItem, sellingPrice: number) {
    if (!supabase || !Number.isSafeInteger(sellingPrice) || sellingPrice < 0) {
      setError("Enter a valid, non-negative whole-number selling price.");
      return;
    }
    if (product.averageCost !== null && sellingPrice < product.averageCost) {
      setError(`The selling price for ${product.name} cannot be below its average cost of ${formatNaira(product.averageCost)}.`);
      return;
    }
    setError("");
    setBusy(true);
    const { error: saveError } = await supabase
      .from("products")
      .update({ unit_price: sellingPrice })
      .eq("id", product.id);
    setBusy(false);
    if (saveError) {
      setError(`Could not update the selling price: ${saveError.message}`);
      return;
    }
    setWorkspaceVersion((version) => version + 1);
    flash(`Selling price updated for ${product.name}.`);
  }

  async function setProductArchived(product: StockItem, shouldArchive: boolean) {
    if (!supabase) return;
    if (shouldArchive && product.stock > 0) {
      setError("Clear the remaining stock before archiving this product.");
      return;
    }
    const action = shouldArchive ? "archive" : "restore";
    if (!window.confirm(`${shouldArchive ? "Archive" : "Restore"} ${product.name}? ${shouldArchive ? "It will be hidden from active inventory, while its transaction history is kept." : "It will be available in active inventory again."}`)) {
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { error: archiveError } = await supabase.rpc("set_product_archived", {
        target_product_id: product.id,
        should_archive: shouldArchive,
      });
      if (archiveError) throw archiveError;
      setWorkspaceVersion((version) => version + 1);
      flash(`${product.name} ${shouldArchive ? "archived" : "restored"}.`);
    } catch (reason) {
      setError(`Could not ${action} product: ${getErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitSmartLog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!smartLocationId) {
      setError("Choose a business location before recording a sale or restock.");
      return;
    }
    if (smartEntryKind !== "service" && !workspace.inventory.some((item) => item.locationId === smartLocationId)) {
      setError(smartEntryKind === "restock"
        ? "Add a product to this location before recording a restock."
        : "There are no products at this location to sell. Add products, or choose Service job to record non-inventory work.");
      return;
    }
    if (!prompt.trim()) {
      setError("Describe the products and quantities before asking Smart Log to prepare a draft.");
      return;
    }
    setSmartParsing(true);
    try {
      const response = await fetch("/api/smart-log/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: smartEntryKind, text: prompt.trim() }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "message" in result &&
          typeof result.message === "string"
          ? result.message
          : "Smart Log could not prepare a draft.";
        throw new Error(message);
      }
      if (!isSmartLogParseResult(result, smartEntryKind)) {
        throw new Error("Smart Log returned an invalid draft. Try rephrasing the entry.");
      }

      const selectedLocation = workspace.locations.find((location) => location.id === smartLocationId);
      if (!selectedLocation) {
        throw new Error("Choose an available business location and try again.");
      }
      let location = selectedLocation;
      if (result.locationName) {
        const matches = workspace.locations.filter(
          (entry) => entry.name.trim().toLocaleLowerCase() === result.locationName?.trim().toLocaleLowerCase(),
        );
        if (matches.length === 0) {
          throw new Error(`I couldn't find the location "${result.locationName}". Choose its location in the app and try again.`);
        }
        if (matches.length > 1) {
          const selectedMatch = matches.find((entry) => entry.id === selectedLocation.id);
          if (!selectedMatch) {
            throw new Error(`More than one business has a location named "${result.locationName}". Select the correct location and remove its name from the text.`);
          }
          location = selectedMatch;
        } else {
          location = matches[0];
        }
      }

      if (smartEntryKind === "service") {
        setServiceJobDraft({
          businessId: location.businessId,
          locationId: location.id,
          locationName: location.name,
        });
        setServiceJobTitle(result.serviceTitle ?? "");
        setServiceJobDescription("");
        setServiceJobDate(today || localDateInputValue(new Date()));
        setServiceJobPhone(workspace.customers.find((customer) =>
          customer.businessId === location.businessId &&
          customer.fullName.toLowerCase() === (result.customerName ?? "").trim().toLowerCase(),
        )?.phone ?? "");
        setServiceMaintenanceDate("");
        setLocationFilter(location.id);
        setSmartLocationId(location.id);
        setSaleTotal(result.statedTotal === null ? "" : String(result.statedTotal));
        setStatedTotal(result.statedTotal);
        const parsedServicePaid = result.amountPaid ??
          (result.paymentFraction !== null && result.statedTotal !== null
            ? result.statedTotal * result.paymentFraction
            : null);
        setAmountPaid(parsedServicePaid !== null && Number.isSafeInteger(parsedServicePaid)
          ? String(parsedServicePaid)
          : "");
        setPaymentFraction(result.amountPaid === null ? result.paymentFraction : null);
        setCustomerName(result.customerName ?? "");
        setDueDate(result.dueDate ?? "");
        setDraft(null);
        setPrompt("");
        return;
      }

      const locationInventory = workspace.inventory.filter((item) => item.locationId === location.id);
      const linesById = new Map<string, SaleDraftLine>();
      const explicitPriceById = new Map<string, boolean>();
      const unmatched: string[] = [];
      for (const parsedItem of result.items) {
        const product = findInventoryMatch(parsedItem.name, locationInventory);
        if (!product) {
          unmatched.push(parsedItem.name);
          continue;
        }
        const totalUnitPrice = result.items.length === 1 &&
          result.statedTotal !== null &&
          result.statedTotal % parsedItem.quantity === 0
          ? result.statedTotal / parsedItem.quantity
          : null;
        const explicitUnitPrice = parsedItem.unitPrice ?? totalUnitPrice;
        const unitPrice = explicitUnitPrice ?? (smartEntryKind === "sale" ? product.unitPrice : 0);
        const existing = linesById.get(product.id);
        const wasExplicit = explicitPriceById.get(product.id) ?? false;
        if (existing && wasExplicit && explicitUnitPrice !== null && existing.unitPrice !== explicitUnitPrice) {
          throw new Error(`Smart Log found different unit prices for ${product.name}. Record it as one line and confirm its price manually.`);
        }
        linesById.set(product.id, {
          itemId: product.id,
          item: product.name,
          quantity: (existing?.quantity ?? 0) + parsedItem.quantity,
          unitPrice: explicitUnitPrice !== null && !wasExplicit ? explicitUnitPrice : existing?.unitPrice ?? unitPrice,
          averageCost: product.averageCost,
        });
        explicitPriceById.set(product.id, wasExplicit || explicitUnitPrice !== null);
      }
      if (unmatched.length > 0) {
        throw new Error(`I couldn't match ${unmatched.join(", ")} to products at ${location.name}. Use product names from that location's inventory.`);
      }
      const lines = [...linesById.values()];
      if (!lines.length) {
        throw new Error("No products were found. Include at least one product name and quantity.");
      }

      const nextDraft: SaleDraft = {
        kind: smartEntryKind,
        businessId: location.businessId,
        locationId: location.id,
        locationName: location.name,
        lines,
      };
      const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
      setDraft(nextDraft);
      setLocationFilter(location.id);
      setSmartLocationId(location.id);
      setSaleTotal(String(total));
      setStatedTotal(result.statedTotal);
      setAmountPaid("");
      setPaymentFraction(null);
      setCustomerName("");
      setDueDate("");
      if (smartEntryKind === "sale") {
        setCustomerName(result.customerName ?? "");
        setDueDate(result.dueDate ?? "");
        if (result.amountPaid !== null) {
          setAmountPaid(String(result.amountPaid));
        } else if (result.paymentFraction !== null) {
          setPaymentFraction(result.paymentFraction);
          const inferredPaid = total * result.paymentFraction;
          if (Number.isSafeInteger(inferredPaid)) setAmountPaid(String(inferredPaid));
        }
      }
      setPrompt("");
    } catch (reason) {
      if (smartEntryKind === "service") {
        const selectedLocation = workspace.locations.find((location) => location.id === smartLocationId);
        if (selectedLocation) {
          setServiceJobDraft({
            businessId: selectedLocation.businessId,
            locationId: selectedLocation.id,
            locationName: selectedLocation.name,
          });
          setServiceJobTitle("");
          setServiceJobDescription(prompt.trim());
          setServiceJobDate(today || localDateInputValue(new Date()));
          setServiceJobPhone("");
          setServiceMaintenanceDate("");
          setCustomerName("");
          setSaleTotal("");
          setStatedTotal(null);
          setAmountPaid("");
          setPaymentFraction(null);
          setDueDate("");
          setDraft(null);
          setView("Service log");
          setError(`${getErrorMessage(reason)} The original text is in Work notes. Complete the customer, phone, service, and payment details manually; nothing has been saved yet.`);
          return;
        }
      }
      if (smartEntryKind !== "service") {
        startManualEntry(smartEntryKind);
        setManualEntryNote(prompt.trim());
        setError(`Smart Log could not prepare a reliable draft: ${getErrorMessage(reason)} Enter the transaction manually below; no transaction has been saved.`);
        return;
      }
      setError(getErrorMessage(reason));
    } finally {
      setSmartParsing(false);
    }
  }

  function updateDraftLine(itemId: string, field: "quantity" | "unitPrice", value: string) {
    if (!draft) return;
    const nextValue = value === "" ? 0 : Number(value);
    if (!Number.isSafeInteger(nextValue) || nextValue < 0) return;
    const lines = draft.lines.map((line) =>
      line.itemId === itemId ? { ...line, [field]: nextValue } : line,
    );
    setDraft({ ...draft, lines });
    const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    setSaleTotal(String(total));
    if (paymentFraction !== null) {
      const inferredPaid = total * paymentFraction;
      setAmountPaid(Number.isSafeInteger(inferredPaid) ? String(inferredPaid) : "");
    }
  }

  function addDraftProduct(productId: string) {
    if (!draft) return;
    const product = workspace.inventory.find(
      (item) => item.id === productId && item.locationId === draft.locationId,
    );
    if (!product) return;
    const existing = draft.lines.find((line) => line.itemId === product.id);
    const lines = existing
      ? draft.lines.map((line) =>
          line.itemId === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        )
      : [...draft.lines, {
          itemId: product.id,
          item: product.name,
          quantity: 1,
          unitPrice: product.unitPrice,
          averageCost: product.averageCost,
        }];
    setDraft({ ...draft, lines });
    const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    setSaleTotal(String(total));
    if (paymentFraction !== null) {
      const inferredPaid = total * paymentFraction;
      setAmountPaid(Number.isSafeInteger(inferredPaid) ? String(inferredPaid) : "");
    }
  }

  function removeDraftProduct(productId: string) {
    if (!draft) return;
    const lines = draft.lines.filter((line) => line.itemId !== productId);
    setDraft({ ...draft, lines });
    const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    setSaleTotal(String(total));
    if (paymentFraction !== null) {
      const inferredPaid = total * paymentFraction;
      setAmountPaid(Number.isSafeInteger(inferredPaid) ? String(inferredPaid) : "");
    }
  }

  async function confirmEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !draft) return;
    const total = Number(saleTotal);
    const paid = draft.kind === "sale" ? Number(amountPaid) : 0;
    if (statedTotal !== null && total !== statedTotal) {
      setError(`The text says ${formatNaira(statedTotal)}, but the reviewed product prices total ${formatNaira(total)}. Adjust the line prices to match, or cancel and re-enter the correct total.`);
      return;
    }
    if (!Number.isSafeInteger(total) || total <= 0) {
      setError(draft.kind === "restock"
        ? "Enter the unit cost for each restocked product. The total is calculated from quantity × unit cost."
        : "Enter a valid total amount before saving.");
      return;
    }
    if (total !== draft.lines.reduce(
      (sum, line) => sum + line.quantity * line.unitPrice,
      0,
    )) {
      setError("The total must match the product line amounts. Adjust the quantities or unit prices above.");
      return;
    }
    if (draft.lines.length === 0 || draft.lines.some((line) => !Number.isSafeInteger(line.quantity) || line.quantity < 1)) {
      setError("Add a product and enter a quantity of at least one for every line.");
      return;
    }
    if (draft.kind === "sale" && (!customerName.trim() || amountPaid === "" || !Number.isFinite(paid) || paid < 0 || paid > total)) {
      setError("Enter the customer's name and amount paid. Enter 0 if they have not paid.");
      return;
    }
    if (draft.kind === "restock" && draft.lines.some((line) => line.unitPrice <= 0)) {
      setError("Enter a unit cost greater than zero for each restocked product.");
      return;
    }
    if (draft.kind === "sale") {
      const missingCost = draft.lines.find((line) => line.averageCost === null);
      if (missingCost) {
        setError(`Set the average cost for ${missingCost.item} in Inventory before selling it.`);
        return;
      }
      const underCost = draft.lines.find((line) =>
        line.averageCost !== null && line.unitPrice < line.averageCost,
      );
      if (underCost) {
        setError(`${underCost.item} cannot be sold below its average cost of ${formatNaira(underCost.averageCost ?? 0)}.`);
        return;
      }
    }
    if (draft.kind === "restock") {
      const missingCost = draft.lines.find((line) =>
        workspace.inventory.some((product) =>
          product.id === line.itemId && product.stock > 0 && product.averageCost === null,
        ),
      );
      if (missingCost) {
        setError(`Set the existing average cost for ${missingCost.item} in Inventory before adding more stock.`);
        return;
      }
    }
    for (const line of draft.lines) {
      const product = workspace.inventory.find(
        (item) => item.id === line.itemId && item.locationId === draft.locationId,
      );
      if (!product) {
        setError(`${line.item} is no longer in this location's inventory.`);
        return;
      }
      if (draft.kind === "sale" && product.stock < line.quantity) {
        setError(`Only ${product.stock} ${line.item} available; this sale needs ${line.quantity}.`);
        return;
      }
    }

    const lines = draft.lines.map((line) => ({
      product_id: line.itemId,
      quantity: line.quantity,
      unit_price: line.unitPrice,
    }));
    setError("");
    setBusy(true);
    try {
      const { error: transactionError } = await supabase.rpc("record_transaction", {
        target_business_id: draft.businessId,
        target_location_id: draft.locationId,
        transaction_type: draft.kind,
        transaction_total: total,
        paid_amount: paid,
        customer: draft.kind === "sale" ? customerName.trim() : null,
        payment_due: draft.kind === "sale" && paid < total
          ? dueDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
          : null,
        lines,
      });
      if (transactionError) throw transactionError;
      setDraft(null);
      setManualEntryNote("");
      setWorkspaceVersion((version) => version + 1);
      flash(draft.kind === "restock"
        ? `Restock saved at ${draft.locationName}.`
        : `Sale saved. ${formatNaira(total - paid)} outstanding.`);
    } catch (reason) {
      setError(`Could not save this entry: ${getErrorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  function openPaymentForm(entry: LedgerEntry) {
    setSelectedPaymentEntry(entry);
    setPaymentAmount("");
    setView("Credit ledger");
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entry = selectedPaymentEntry;
    if (!supabase) return;
    if (!entry) {
      setError("Choose a balance before recording a payment.");
      return;
    }
    const amount = Number(paymentAmount);
    const remaining = entry.total - entry.paid;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) {
      setError(`Enter a whole-number payment between ₦1 and ${formatNaira(remaining)}.`);
      return;
    }
    setError("");
    setBusy(true);
    const { error: paymentError } = entry.source === "service"
      ? await supabase.rpc("record_service_job_payment", {
          target_service_job_id: entry.id,
          payment_amount: amount,
        })
      : await supabase.rpc("record_payment", {
          target_transaction_id: entry.id,
          payment_amount: amount,
        });
    setBusy(false);
    if (paymentError) {
      setError(`Could not record payment: ${paymentError.message}`);
      return;
    }
    setSelectedPaymentEntry(null);
    setPaymentAmount("");
    setWorkspaceVersion((version) => version + 1);
    flash(`${formatNaira(amount)} payment recorded for ${entry.customer}.`);
  }

  async function generateInsights() {
    setAiInsightsBusy(true);
    setAiInsightsError("");
    try {
      const productSales = transactions
        .filter((entry) => entry.kind === "Sale")
        .reduce<Record<string, { quantity: number; sales: number }>>((result, entry) => {
          const current = result[entry.item] ?? { quantity: 0, sales: 0 };
          current.quantity += entry.quantity;
          current.sales += entry.amount;
          result[entry.item] = current;
          return result;
        }, {});
      const topProducts = Object.entries(productSales)
        .sort((a, b) => b[1].sales - a[1].sales)
        .slice(0, 10)
        .map(([name, values]) => ({ name, ...values }));
      const response = await fetch("/api/insights/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sales: selectedInsights.productSales,
          collected: selectedInsights.productCollections +
            serviceJobs.reduce((sum, job) => sum + job.amountPaid, 0),
          estimatedProductGrossProfit: estimatedProductProfit,
          outstandingDebt: outstanding,
          inventoryValueAtCost: selectedInsights.inventoryValueAtCost,
          inventoryProductsWithCost: selectedInsights.inventoryProductsWithCost,
          productSalesWithoutCost: selectedInsights.salesLinesWithoutCost,
          stockWatch: stockWatchItems.slice(0, 15).map((item) => ({
            name: item.name,
            quantity: item.stock,
            alertAt: item.reorderLevel,
          })),
          topProducts,
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "message" in result &&
          typeof result.message === "string"
          ? result.message
          : "Gemini could not prepare business insights.";
        throw new Error(message);
      }
      if (typeof result !== "object" || result === null || !("insights" in result) ||
        !Array.isArray(result.insights) ||
        !result.insights.every((insight): insight is string =>
          typeof insight === "string" && insight.trim().length > 0,
        )) {
        throw new Error("Gemini returned an unreadable insight summary. Try again.");
      }
      setAiInsights(result.insights.slice(0, 4));
      setAiInsightsScope(locationFilter);
    } catch (reason) {
      setAiInsightsError(getErrorMessage(reason));
    } finally {
      setAiInsightsBusy(false);
    }
  }

  async function copyReminder(entry: LedgerEntry) {
    const message = getCreditReminderMessage(entry);
    try {
      await navigator.clipboard.writeText(message);
      flash("Reminder copied. Review it before sending; no message was sent.");
    } catch {
      setError("Could not copy the reminder. Check your browser clipboard permissions.");
    }
  }

  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice input is not supported in this browser. Try Chrome or Edge, or type the entry.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-NG";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) setPrompt(transcript);
    };
    recognition.onerror = () => {
      setError("Voice input stopped. Check microphone permission and try again.");
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    setError("");
    setListening(true);
    recognition.start();
  }

  if (!getSupabaseConfig()) {
    return <SetupScreen />;
  }
  if (authLoading || !supabase) {
    return <StatusScreen message="Connecting to your secure workspace…" />;
  }
  if (!user) {
    return (
      <AuthScreen
        mode={authMode}
        email={email}
        password={password}
        busy={busy}
        notice={notice}
        error={error}
        onMode={setAuthMode}
        onEmail={setEmail}
        onPassword={setPassword}
        onSubmit={submitAuth}
      />
    );
  }
  if (user && workspaceLoadedFor !== user.id) {
    return <StatusScreen message="Loading your business workspace…" />;
  }
  if (workspaceLoadError) {
    return (
      <WorkspaceErrorScreen
        message={workspaceLoadError}
        onRetry={retryWorkspaceLoad}
        onSignOut={signOut}
      />
    );
  }
  if (workspace.businesses.length === 0) {
    return (
      <OnboardingScreen
        businessName={businessName}
        locationName={locationName}
        busy={busy}
        error={error}
        onBusinessName={setBusinessName}
        onLocationName={setLocationName}
        onSubmit={createBusiness}
        onSignOut={signOut}
      />
    );
  }

  const navigation: { label: View; icon: typeof LayoutDashboard }[] = [
    { label: "Overview", icon: LayoutDashboard },
    { label: "Inventory", icon: Package },
    { label: "Locations", icon: MapPin },
    { label: "Customers", icon: Users },
    { label: "Service log", icon: ClipboardList },
    { label: "Credit ledger", icon: CreditCard },
    { label: "Insights", icon: BarChart3 },
    { label: "Subscription", icon: Wallet },
  ];

  return (
    <div className={`app-shell${darkMode ? " dark" : ""}`}>
      <aside className={`sidebar${mobileMenuOpen ? " sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <BrandLogo />
          <button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)}><X size={18} /></button>
        </div>
        <div className="workspace-picker" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setWorkspaceMenuOpen(false);
          }
        }}>
          <button
            className="workspace-switch"
            aria-expanded={workspaceMenuOpen}
            aria-haspopup="menu"
            aria-controls="workspace-location-menu"
            onClick={() => setWorkspaceMenuOpen((open) => !open)}
          >
            <div className="workspace-icon"><ShoppingBag size={16} /></div>
            <span><strong>My workspace</strong><small>{workspace.businesses.length} connected business{workspace.businesses.length === 1 ? "" : "es"}</small></span>
            <ChevronDown size={15} className="muted-icon" />
          </button>
          {workspaceMenuOpen && (
            <div className="workspace-menu" id="workspace-location-menu" role="menu" aria-label="Choose locations">
              <button
                className={`workspace-menu-item${locationFilter === ALL_LOCATIONS ? " selected" : ""}`}
                role="menuitem"
                onClick={() => chooseWorkspaceLocation(ALL_LOCATIONS)}
              >
                <span>All locations</span><small>Combined business view</small>
              </button>
              {workspace.locations.map((location) => (
                <button
                  key={location.id}
                  className={`workspace-menu-item${locationFilter === location.id ? " selected" : ""}`}
                  role="menuitem"
                  onClick={() => chooseWorkspaceLocation(location.id)}
                >
                  <span>{location.name}</span><small>{businessById.get(location.businessId)?.name ?? "Business"}</small>
                </button>
              ))}
              <button
                className="workspace-menu-manage"
                role="menuitem"
                onClick={() => { setView("Locations"); setWorkspaceMenuOpen(false); }}
              >
                Manage locations <ArrowUpRight size={13} />
              </button>
            </div>
          )}
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav className="primary-nav" aria-label="Main navigation">
          {navigation.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item${view === label ? " active" : ""}`} onClick={() => { setView(label); setMobileMenuOpen(false); setQuery(""); }}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {label === "Service log" && serviceDueCount > 0 && <span className="nav-count">{serviceDueCount}</span>}
              {label === "Credit ledger" && ledger.length > 0 && <span className="nav-count">{ledger.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-icon"><Headphones size={17} /></div><strong>Getting started?</strong><p>Track product sales, restocks, and completed service work.</p><button onClick={() => flash("Tip: choose Sale, Restock, or Service job in Smart Log, then review the draft before saving.")}>View quick tip <ArrowUpRight size={13} /></button></div>
          <div className="profile-card">
            <div className="avatar">{(user.email ?? "LL").slice(0, 2).toUpperCase()}</div>
            <span><strong>{user.email}</strong><small>Supabase account</small></span>
            <button className="icon-button" aria-label="Sign out" onClick={signOut}><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      {mobileMenuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)} />}
      <main className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileMenuOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{view}</strong></div>
          <div className="topbar-actions">
            <div className="branch-picker" onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setLocationFilterMenuOpen(false);
              }
            }}>
              <button
                type="button"
                className="branch-select"
                aria-label={`Location filter: ${locationFilter === ALL_LOCATIONS ? "All locations" : workspace.locations.find((location) => location.id === locationFilter)?.name ?? "Selected location"}`}
                aria-expanded={locationFilterMenuOpen}
                aria-haspopup="menu"
                aria-controls="location-filter-menu"
                onClick={() => setLocationFilterMenuOpen((open) => !open)}
              >
                <span className="branch-dot" />
                <span className="branch-select-label">{locationFilter === ALL_LOCATIONS
                  ? "All locations"
                  : workspace.locations.find((location) => location.id === locationFilter)?.name ?? "Selected location"}</span>
                <ChevronDown size={14} />
              </button>
              {locationFilterMenuOpen && (
                <div className="branch-menu" id="location-filter-menu" role="menu" aria-label="Filter by location">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={locationFilter === ALL_LOCATIONS}
                    className={`branch-menu-item${locationFilter === ALL_LOCATIONS ? " selected" : ""}`}
                    onClick={() => chooseWorkspaceLocation(ALL_LOCATIONS)}
                  >
                    <span>All locations</span><small>Combined business view</small>
                  </button>
                  {workspace.locations.map((location) => (
                    <button
                      type="button"
                      key={location.id}
                      role="menuitemradio"
                      aria-checked={locationFilter === location.id}
                      className={`branch-menu-item${locationFilter === location.id ? " selected" : ""}`}
                      onClick={() => chooseWorkspaceLocation(location.id)}
                    >
                      <span>{location.name}</span><small>{businessById.get(location.businessId)?.name ?? "Business"}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="icon-button theme-button" aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>{darkMode ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="icon-button notification-button" aria-label="Open service log" onClick={() => setView("Service log")}><Bell size={18} /><i /></button>
            <div className="top-avatar">{(user.email ?? "LL").slice(0, 2).toUpperCase()}</div>
          </div>
        </header>

        <div className="page-content">
          {notice && <div className="toast"><CheckCircle2 size={17} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss" onClick={() => setNotice("")}><X size={15} /></button></div>}
          {error && <div className="error-banner" role="alert"><X size={16} /><span>{error}</span>{error.startsWith("Could not load your Supabase workspace:") && <button className="text-button" onClick={() => setWorkspaceVersion((version) => version + 1)}>Retry sync</button>}<button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div>}
          {busy && <div className="sync-note"><Activity size={14} /> Syncing with Supabase…</div>}

          {serviceJobDraft && <section className="confirm-card service-job-form-card">
            <div className="confirm-heading"><div><div className="eyebrow">REVIEW SERVICE JOB</div><h2>Record completed service</h2><p>{serviceJobDraft.locationName} · Review the customer, job, fee, and payment before saving.</p></div><button className="icon-button" aria-label="Cancel service job" type="button" onClick={() => setServiceJobDraft(null)}><X size={18} /></button></div>
            <form className="confirm-form" onSubmit={confirmServiceJob}>
              <label>Location<select value={serviceJobDraft.locationId} onChange={(event) => {
                const location = workspace.locations.find((entry) => entry.id === event.target.value);
                if (location) setServiceJobDraft({ businessId: location.businessId, locationId: location.id, locationName: location.name });
              }} required>{workspace.locations.map((location) => <option key={location.id} value={location.id}>{businessById.get(location.businessId)?.name} · {location.name}</option>)}</select></label>
              <label>Customer name<input list="service-job-customers" value={customerName} onChange={(event) => {
                const nextName = event.target.value;
                setCustomerName(nextName);
                const existingCustomer = workspace.customers.find((customer) =>
                  customer.businessId === serviceJobDraft.businessId &&
                  customer.fullName.toLowerCase() === nextName.trim().toLowerCase(),
                );
                setServiceJobPhone(existingCustomer?.phone ?? "");
              }} maxLength={160} placeholder="Who received the service?" required /><datalist id="service-job-customers">{workspace.customers.filter((customer) => customer.businessId === serviceJobDraft.businessId).map((customer) => <option key={customer.id} value={customer.fullName} />)}</datalist></label>
              <label>Customer phone<input type="tel" value={serviceJobPhone} onChange={(event) => setServiceJobPhone(event.target.value)} maxLength={40} placeholder="For follow-up (include country code if known)" /></label>
              <label>Service provided<input value={serviceJobTitle} onChange={(event) => setServiceJobTitle(event.target.value)} maxLength={160} placeholder="e.g. Generator repair" required /></label>
              <label>Date provided<input type="date" value={serviceJobDate} onChange={(event) => setServiceJobDate(event.target.value)} required /></label>
              <label>Agreed fee (₦)<input inputMode="numeric" type="number" min="1" step="1" value={saleTotal} onChange={(event) => {
                const nextTotal = event.target.value;
                setSaleTotal(nextTotal);
                if (paymentFraction !== null) {
                  const paid = Number(nextTotal) * paymentFraction;
                  setAmountPaid(Number.isSafeInteger(paid) ? String(paid) : "");
                }
              }} required /></label>
              <label>Amount paid (₦)<input inputMode="numeric" type="number" min="0" max={saleTotal || undefined} step="1" value={amountPaid} onChange={(event) => {
                setAmountPaid(event.target.value);
                setPaymentFraction(null);
              }} placeholder="Enter 0 if unpaid" required /></label>
              {amountPaid !== "" && Number(amountPaid) < Number(saleTotal) && <label>Balance due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>}
              <label>Next maintenance follow-up (optional)<input type="date" min={serviceJobDate} value={serviceMaintenanceDate} onChange={(event) => setServiceMaintenanceDate(event.target.value)} /></label>
              <label className="crm-notes">Work notes (optional)<textarea value={serviceJobDescription} onChange={(event) => setServiceJobDescription(event.target.value)} maxLength={1200} rows={2} placeholder="Work completed or details to remember" /></label>
              <p className="service-follow-up-hint">The phone is saved to this customer&apos;s profile. If you choose a follow-up date, it will appear in the maintenance log with WhatsApp and SMS draft actions.</p>
              {statedTotal !== null && Number(saleTotal) !== statedTotal && <div className="total-warning" role="status">You mentioned {formatNaira(statedTotal)}; the current fee is {saleTotal ? formatNaira(Number(saleTotal)) : "not entered"}. Confirm the agreed fee before saving.</div>}
              <div className="confirm-actions"><button type="button" className="button button-secondary" onClick={() => setServiceJobDraft(null)}>Cancel</button><button type="submit" disabled={busy} className="button button-primary"><Check size={15} />{busy ? "Saving…" : "Save service job"}</button></div>
            </form>
          </section>}

          {view === "Overview" && <>
            <div className="page-heading"><div><div className="eyebrow"><span className="live-dot" /> YOUR BUSINESS AT A GLANCE</div><h1>{greeting} <span>✳</span></h1><p>Here’s what’s happening across your business today.</p></div><button className="button button-secondary" onClick={() => { setView("Inventory"); setQuery(""); }}><Package size={15} /> View inventory</button></div>
            <section className="metric-grid" aria-label="Business summary">
              <MetricCard title="Sales + service fees" value={formatNaira(totalRevenue)} change="Recorded transaction totals" icon={<Wallet size={18} />} tone="green" />
              <MetricCard title="Outstanding credit" value={formatNaira(outstanding)} change={`${ledger.length} open customer balances`} icon={<CircleDollarSign size={19} />} tone="amber" />
              <MetricCard title="Items to restock" value={String(lowStockCount).padStart(2, "0")} change="For businesses tracking products" icon={<Package size={18} />} tone="blue" />
              <MetricCard title="Customers with credit" value={String(openCustomers).padStart(2, "0")} change="Across selected locations" icon={<Users size={18} />} tone="violet" />
            </section>
            <section className="smart-card">
              <div className="smart-orb"><Sparkles size={18} /></div>
              <div className="smart-copy"><div className="smart-title">Smart Log <span className="review-chip">REVIEW BEFORE SAVE</span></div><p>Choose an entry type and location, describe what happened, then review the draft before saving.</p></div>
              <div className="smart-example"><span>TRY</span> {smartEntryKind === "service" ? "“Repaired Ada’s generator for ₦25,000; she paid ₦10,000”" : smartEntryKind === "restock" ? "“10 rice and 5 oil”" : "“3 rice and 2 oil”"}</div>
              <form className="smart-form" onSubmit={submitSmartLog}>
                <div className="smart-controls">
                  <div className="entry-kind-toggle" role="group" aria-label="Entry type">
                    <button type="button" disabled={smartParsing} className={smartEntryKind === "restock" ? "selected" : ""} onClick={() => setSmartEntryKind("restock")}><ArrowDownRight size={14} /> Restock</button>
                    <button type="button" disabled={smartParsing} className={smartEntryKind === "sale" ? "selected" : ""} onClick={() => setSmartEntryKind("sale")}><ShoppingBag size={14} /> Sale</button>
                    <button type="button" disabled={smartParsing} className={smartEntryKind === "service" ? "selected" : ""} onClick={() => setSmartEntryKind("service")}><ClipboardList size={14} /> Service job</button>
                  </div>
                  <label className="smart-location"><span>Location</span><select aria-label="Location for this entry" value={smartLocationId} onChange={(event) => setSmartLocationId(event.target.value)} disabled={smartParsing} required><option value="" disabled>Choose a location</option>{workspace.locations.map((location) => <option key={location.id} value={location.id}>{businessById.get(location.businessId)?.name} · {location.name}</option>)}</select><ChevronDown size={14} /></label>
                </div>
                <div className="smart-input-row">
                  <div className="prompt-input-wrap"><Command size={16} /><input aria-label={smartEntryKind === "service" ? "Describe completed service job" : "Describe products and quantities"} value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={1200} disabled={smartParsing} placeholder={smartEntryKind === "service" ? "e.g. Repaired Ada’s generator for ₦25,000; she paid ₦10,000" : smartEntryKind === "restock" ? "e.g. 10 rice and 5 cooking oil" : "e.g. 3 rice and 2 cooking oil"} required /><button type="button" disabled={smartParsing} className={`voice-button${listening ? " listening" : ""}`} aria-label={listening ? "Listening" : "Use voice input"} onClick={startVoiceInput}><Mic size={17} />{listening && <span>Listening…</span>}</button></div>
                  <button className="button button-primary" type="submit" disabled={smartParsing}>{smartParsing ? "Parsing…" : `Review ${smartEntryKind === "service" ? "service job" : smartEntryKind}`} <Send size={14} /></button>
                </div>
                {smartEntryKind !== "service" && <div className="manual-entry-actions"><span>Prefer not to use AI?</span><button type="button" className="text-button" onClick={() => startManualEntry("sale")}>Enter sale manually</button><button type="button" className="text-button" onClick={() => startManualEntry("restock")}>Enter restock manually</button></div>}
              </form>
              <div className="privacy-note"><ShieldCheck size={13} /> Gemini receives the text you enter to prepare a draft. Free-tier prompts may be used by Google to improve its products, so do not include customer names, phone numbers, or sensitive details. Verify all amounts. Inventory is optional for service jobs.</div>
            </section>

            {draft && <section className="confirm-card">
              <div className="confirm-heading"><div><div className="eyebrow">REVIEW BEFORE SAVING</div><h2>{draft.kind === "sale" ? "Sale" : "Restock"} · {draft.lines.length} {draft.lines.length === 1 ? "product" : "products"}</h2><p>{draft.locationName} · Check all products and amounts before confirming.</p></div><button className="icon-button" aria-label="Cancel entry" onClick={() => setDraft(null)}><X size={18} /></button></div>
              <form className="confirm-form" onSubmit={confirmEntry}>
                {manualEntryNote && <div className="manual-entry-note"><strong>Your original note:</strong> {manualEntryNote}<span>Use it as a reference while entering the item details below. Check quantities and amounts before saving.</span></div>}
                <div className="pending-items">
                  <div className="pending-items-heading"><strong>Products in this entry</strong><span>{draft.kind === "sale" ? "Suggested prices from inventory" : "Confirm quantities to restock"}</span></div>
                  {draft.lines.map((line) => <div className="pending-item-row" key={line.itemId}>
                    <span className="pending-item-name">{line.item}<small>{draft.locationName} · {draft.kind === "sale" ? "Sale price and quantity" : "Enter what each unit cost"}</small></span>
                    <label className="line-input"><span>Qty</span><input aria-label={`Quantity for ${line.item}`} inputMode="numeric" type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateDraftLine(line.itemId, "quantity", event.target.value)} required /></label>
                    <label className="line-input line-price"><span>{draft.kind === "sale" ? "Sale price (₦)" : "Unit cost (₦)"}</span><input aria-label={`${draft.kind === "sale" ? "Sale price" : "Unit cost"} for ${line.item}`} inputMode="numeric" type="number" min={draft.kind === "sale" ? line.averageCost ?? 0 : 0} step="1" value={line.unitPrice} onChange={(event) => updateDraftLine(line.itemId, "unitPrice", event.target.value)} required />{draft.kind === "sale" && line.averageCost !== null && <small className="field-hint">Cost floor: {formatNaira(line.averageCost)}</small>}</label>
                    <strong className="line-total">{formatNaira(line.quantity * line.unitPrice)}</strong>
                    <button type="button" className="icon-button remove-line" aria-label={`Remove ${line.item}`} onClick={() => removeDraftProduct(line.itemId)}><X size={15} /></button>
                  </div>)}
                  <label className="add-product-row"><Plus size={14} /><span>Add another product</span><select aria-label="Add another product" value="" onChange={(event) => addDraftProduct(event.target.value)}><option value="">Choose from {draft.locationName}</option>{workspace.inventory.filter((item) => item.locationId === draft.locationId).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.stock} in stock</option>)}</select><ChevronDown size={13} /></label>
                  <div className="suggested-total"><span>{draft.kind === "sale" ? "Sale total" : "Restock cost"}</span><strong>{formatNaira(draft.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0))}</strong></div>
                </div>
                <label>{draft.kind === "sale" ? "Sale total (₦)" : "Total restock cost (₦)"}<input inputMode="numeric" type="number" min="1" value={saleTotal} readOnly required /><small className="field-hint">Calculated from each product’s quantity × {draft.kind === "sale" ? "sale price" : "unit cost"}.</small></label>
                {statedTotal !== null && Number(saleTotal) !== statedTotal && <div className="total-warning" role="status">You mentioned {formatNaira(statedTotal)}. The current line total is {formatNaira(Number(saleTotal))}; adjust product prices before confirming.</div>}
                {draft.kind === "sale" && <><label>Customer name<input list="known-customers" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Who bought these items?" required /><datalist id="known-customers">{workspace.customers.filter((customer) => customer.businessId === draft.businessId).map((customer) => <option key={customer.id} value={customer.fullName} />)}</datalist></label><label>Amount paid (₦)<input inputMode="numeric" type="number" min="0" max={saleTotal || undefined} value={amountPaid} onChange={(event) => { setAmountPaid(event.target.value); setPaymentFraction(null); }} placeholder="Enter 0 if unpaid" required /></label>{amountPaid !== "" && Number(amountPaid) < Number(saleTotal) && <label>Payment due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>}</>}
                <div className="confirm-actions"><button type="button" className="button button-secondary" onClick={() => setDraft(null)}>Cancel</button><button type="submit" disabled={busy} className="button button-primary"><Check size={15} /> {busy ? "Saving…" : `Confirm ${draft.kind}`}</button></div>
              </form>
            </section>}

            <div className="dashboard-grid">
              <section className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Product movements and completed service work</p></div><button className="text-button" onClick={() => setView("Inventory")}>View inventory <ArrowUpRight size={14} /></button></div>
                <div className="activity-list">{transactions.slice(0, 4).map((entry) => <div className="activity-row" key={entry.id}><div className={`activity-icon ${entry.kind === "Sale" ? "sale-icon" : "restock-icon"}`}>{entry.kind === "Sale" ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}</div><div className="activity-detail"><strong>{entry.quantity} × {entry.item} {entry.kind === "Sale" ? "sold" : "restocked"}</strong><span>{entry.branch} · {entry.date}</span></div><div className="activity-amount">{formatNaira(entry.amount)}<span>{entry.kind === "Sale" ? "Sales" : "Stock in"}</span></div></div>)}{serviceJobs.slice(0, 4).map((job) => <div className="activity-row" key={`service-${job.id}`}><div className="activity-icon sale-icon"><ClipboardList size={16} /></div><div className="activity-detail"><strong>{job.title} · {job.customerName}</strong><span>{job.branch} · {formatDate(job.serviceDate)}</span></div><div className="activity-amount">{formatNaira(job.totalAmount)}<span>Service fee</span></div></div>)}</div>
                {transactions.length === 0 && serviceJobs.length === 0 && <EmptyState text="No activity yet. Record a product transaction or completed service job." />}
              </section>
              <section className="panel stock-panel"><div className="panel-heading"><div><h2>Stock watch</h2><p>Items that may need attention</p></div><button className="icon-button" aria-label="View inventory" onClick={() => setView("Inventory")}><ArrowUpRight size={17} /></button></div>
                <div className="stock-watch-list">{stockWatchItems.map((item) => <div className="stock-watch-row" key={item.id}><div className="product-initial">{item.name.charAt(0)}</div><div><strong>{item.name}</strong><span>{item.branch} · alert at {item.reorderLevel}</span></div><span className={`stock-pill ${item.stock === 0 ? "stock-critical" : "stock-low"}`}>{item.stock === 0 ? "Out" : `${item.stock} left`}</span></div>)}</div>
                {lowStockCount === 0 && <EmptyState text="No products are at their stock alert level. Set a Watch at quantity in Inventory." />}
                <button className="full-width-link" onClick={() => setView("Inventory")}>Manage inventory <ArrowUpRight size={14} /></button>
              </section>
            </div>
            <section className="panel credit-preview"><div className="panel-heading"><div><h2>Credit to follow up</h2><p>Customer balances by business location</p></div><button className="text-button" onClick={() => setView("Credit ledger")}>Open credit ledger <ArrowUpRight size={14} /></button></div><CreditTable entries={ledger.slice(0, 3)} onRecordPayment={openPaymentForm} onReminder={copyReminder} /></section>
            <div className="demo-disclaimer"><ShieldCheck size={14} /> Supabase sync is active. Verify account separation and backups before adding real customer records.</div>
          </>}

          {view === "Inventory" && <>
            <div className="page-heading"><div><div className="eyebrow">PRODUCTS & STOCK</div><h1>Inventory</h1><p>Live stock levels from your Supabase workspace.</p></div><div className="row-actions"><button className="button button-secondary" disabled={!smartLocationId} onClick={() => startManualEntry("sale")}><ShoppingBag size={15} /> Record sale</button><button className="button button-secondary" disabled={!smartLocationId} onClick={() => startManualEntry("restock")}><ArrowDownRight size={15} /> Restock</button><button className="button button-primary" disabled={!smartLocationId} onClick={() => setShowProductForm((show) => !show)}><Plus size={16} /> Add product</button></div></div>
            {showProductForm && <section className="confirm-card"><div className="confirm-heading"><div><div className="eyebrow">NEW INVENTORY ITEM</div><h2>Add a product</h2><p>Adding to {workspace.locations.find((location) => location.id === smartLocationId)?.name ?? "selected location"}. Starting stock is zero; record a restock to add units.</p></div><button className="icon-button" aria-label="Close product form" onClick={() => setShowProductForm(false)}><X size={18} /></button></div><form className="confirm-form" onSubmit={createProduct}><label>Product name<input value={productName} onChange={(event) => setProductName(event.target.value)} required /></label><label>Category<input value={productCategory} onChange={(event) => setProductCategory(event.target.value)} placeholder="e.g. Groceries" /></label><label>Selling price (₦)<input inputMode="numeric" type="number" min="0" step="1" value={productPrice} onChange={(event) => setProductPrice(event.target.value)} required /></label><label>Current unit cost (₦, optional)<input inputMode="numeric" type="number" min="0" step="1" value={productAverageCost} onChange={(event) => setProductAverageCost(event.target.value)} placeholder="Needed before first sale" /></label><label>Alert when stock reaches<input inputMode="numeric" type="number" min="0" max="1000000" step="1" value={productReorderLevel} onChange={(event) => setProductReorderLevel(event.target.value)} required /></label><div className="confirm-actions"><button type="button" className="button button-secondary" onClick={() => setShowProductForm(false)}>Cancel</button><button type="submit" disabled={busy} className="button button-primary">{busy ? "Saving…" : "Add product"}</button></div></form></section>}
            {costEditingProduct && <section className="confirm-card"><div className="confirm-heading"><div><div className="eyebrow">PRODUCT COST</div><h2>Update average cost for {costEditingProduct.name}</h2><p>This changes the current cost baseline for future valuation and profit estimates. Historical transaction cost snapshots are not changed. Selling price must be at least this amount.</p></div><button className="icon-button" aria-label="Close average cost form" type="button" onClick={() => setCostEditingProduct(null)}><X size={18} /></button></div><form className="confirm-form" onSubmit={saveAverageCost}><label>Current average unit cost (₦)<input type="number" inputMode="numeric" min="0" max={costEditingProduct.unitPrice} step="1" value={averageCostValue} onChange={(event) => setAverageCostValue(event.target.value)} required /></label><div className="confirm-actions"><button type="button" className="button button-secondary" onClick={() => setCostEditingProduct(null)}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save average cost"}</button></div></form></section>}
            <div className="inventory-summary"><div><Package size={17} /><span><strong>{inventory.length}</strong> products in this view</span></div><div><Activity size={15} /><span><strong>{lowStockCount}</strong> need attention</span></div><div><ShoppingBag size={15} /><span><strong>{locationFilter === ALL_LOCATIONS ? workspace.locations.length : 1}</strong> locations</span></div></div>
            <section className="panel table-panel"><div className="table-toolbar"><div><h2>{showArchivedInventory ? "Archived products" : "All inventory"}</h2><p>{showArchivedInventory ? "Archived items keep their transaction history and can be restored." : "Current quantities, selling prices, editable cost baselines, and stock alert levels"}</p></div><div className="inventory-toolbar-actions"><button className="button button-secondary" type="button" onClick={() => setShowArchivedInventory((show) => !show)}>{showArchivedInventory ? "View active inventory" : `Archived (${archivedInventory.length})`}</button><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products…" /></label></div></div><InventoryTable items={showArchivedInventory ? searchedArchivedInventory : searchedInventory} archived={showArchivedInventory} busy={busy} onSetThreshold={saveReorderLevel} onSetSellingPrice={saveSellingPrice} onSetCost={(product) => { setCostEditingProduct(product); setAverageCostValue(product.averageCost === null ? "" : String(product.averageCost)); }} onSetArchived={setProductArchived} /></section>
          </>}

          {view === "Locations" && <>
            <div className="page-heading"><div><div className="eyebrow">BUSINESS LOCATIONS</div><h1>Locations</h1><p>Add and switch between branches for each of your businesses.</p></div></div>
            <section className="panel location-panel">
              <div className="panel-heading"><div><h2>Add another location</h2><p>Each location keeps its inventory and activity separate.</p></div></div>
              <form className="location-form" onSubmit={createLocation}>
                <label>Business<select value={newLocationBusinessId} onChange={(event) => setNewLocationBusinessId(event.target.value)} required>{workspace.businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
                <label>New location name<input value={newLocationName} onChange={(event) => setNewLocationName(event.target.value)} placeholder="e.g. Wuse Branch" maxLength={100} required /></label>
                <button className="button button-primary" type="submit" disabled={busy || !newLocationBusinessId}><Plus size={15} /> {busy ? "Adding…" : "Add location"}</button>
              </form>
            </section>
            <section className="location-grid" aria-label="Your current locations">
              {workspace.locations.map((location) => (
                <article className="panel location-card" key={location.id}>
                  <div className="location-card-icon"><MapPin size={18} /></div>
                  <div className="location-card-info"><strong>{location.name}</strong><span>{businessById.get(location.businessId)?.name ?? "Business"}</span></div>
                  <button className="button button-secondary" onClick={() => { setLocationFilter(location.id); setSmartLocationId(location.id); setView("Inventory"); }}>View inventory</button>
                </article>
              ))}
            </section>
          </>}

          {view === "Customers" && <>
            <div className="page-heading"><div><div className="eyebrow">CUSTOMER RELATIONSHIPS</div><h1>Customers</h1><p>Keep contact details and sales history organized by business.</p></div><span className="insight-badge"><Users size={14} /> {visibleCustomers.length} profiles</span></div>
            <section className="panel location-panel">
              <div className="panel-heading"><div><h2>{customerEditingId ? "Edit customer profile" : "Add a customer"}</h2><p>Names from new sales are also added automatically to this list.</p></div></div>
              <form className="crm-form" onSubmit={createCustomer}>
                <label>Business<select value={customerBusinessId} onChange={(event) => setCustomerBusinessId(event.target.value)} disabled={Boolean(customerEditingId)} required>{workspace.businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
                <label>Customer name<input value={customerFullName} onChange={(event) => setCustomerFullName(event.target.value)} maxLength={160} required /></label>
                <label>Phone (optional)<input type="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} maxLength={40} placeholder="Include country code if known" /></label>
                <label className="crm-notes">Notes (optional)<textarea value={customerNotes} onChange={(event) => setCustomerNotes(event.target.value)} maxLength={1000} rows={2} placeholder="Preferences or details useful to your team" /></label>
                <div className="crm-form-actions">{customerEditingId && <button className="button button-secondary" type="button" onClick={cancelCustomerEdit}>Cancel</button>}<button className="button button-primary" type="submit" disabled={busy || !customerBusinessId}>{customerEditingId ? <Pencil size={14} /> : <Plus size={15} />} {busy ? "Saving…" : customerEditingId ? "Save changes" : "Add customer"}</button></div>
              </form>
            </section>
            <section className="panel table-panel"><div className="table-toolbar"><div><h2>Customer directory</h2><p>Product sales and completed service jobs linked to customers</p></div><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a customer…" /></label></div><CustomerTable customers={searchedCustomers} sales={transactions} serviceJobs={serviceJobs} businessById={businessById} onEdit={editCustomer} /></section>
          </>}

          {view === "Service log" && <>
            <div className="page-heading"><div><div className="eyebrow">CUSTOMER CARE</div><h1>Services & follow-ups</h1><p>Record completed work, fees, customer contact details, and maintenance reminders together.</p></div><div className="row-actions"><span className={`service-summary-badge${serviceDueCount ? " due" : ""}`}><Bell size={14} /> {serviceDueCount} due now</span><button className="button button-primary" type="button" onClick={startServiceJobDraft}><Plus size={15} /> Record service job</button></div></div>
            <section className="panel location-panel">
              <div className="panel-heading"><div><h2>Schedule a follow-up</h2><p>Only schedule a reminder when follow-up is needed. One-time service jobs can be recorded without a follow-up date.</p></div></div>
              <form className="crm-form" onSubmit={createServiceRecord}>
                <label>Location<select value={serviceLocationId} onChange={(event) => {
                  setServiceLocationId(event.target.value);
                }} required>{workspace.locations.map((location) => <option key={location.id} value={location.id}>{businessById.get(location.businessId)?.name} · {location.name}</option>)}</select></label>
                <label>Customer name<input list="service-followup-customers" value={serviceCustomerName} onChange={(event) => {
                  const name = event.target.value;
                  setServiceCustomerName(name);
                  setServiceCustomerPhone(serviceCustomers.find((customer) =>
                    customer.fullName.toLowerCase() === name.trim().toLowerCase(),
                  )?.phone ?? "");
                }} maxLength={160} placeholder="Choose an existing customer or enter a new name" required /><datalist id="service-followup-customers">{serviceCustomers.map((customer) => <option key={customer.id} value={customer.fullName} />)}</datalist></label>
                <label>Phone (optional)<input type="tel" value={serviceCustomerPhone} onChange={(event) => setServiceCustomerPhone(event.target.value)} maxLength={40} placeholder="For reminders; include country code if known" /></label>
                {selectedServiceCustomer && <div className="service-contact">
                  <strong>Customer contact</strong>
                  {selectedServiceCustomer.phone
                    ? <>
                      <a href={`tel:${getSmsNumber(selectedServiceCustomer.phone) ?? selectedServiceCustomer.phone}`}><Phone size={14} />{selectedServiceCustomer.phone}<span>Tap to call</span></a>
                      <div className="row-actions service-actions">
                        {serviceWhatsAppNumber
                          ? <a className="action-button" href={`https://wa.me/${serviceWhatsAppNumber}?text=${encodeURIComponent(serviceContactMessage)}`} target="_blank" rel="noreferrer"><MessageCircle size={13} />WhatsApp</a>
                          : <button className="action-button" type="button" disabled title="Add a valid Nigerian or international phone number to this customer profile"><MessageCircle size={13} />WhatsApp</button>}
                        {serviceSmsNumber
                          ? <a className="action-button" href={`sms:${serviceSmsNumber}?body=${encodeURIComponent(serviceContactMessage)}`}><Smartphone size={13} />SMS</a>
                          : <button className="action-button" type="button" disabled title="Add a phone number to this customer profile"><Smartphone size={13} />SMS</button>}
                      </div>
                    </>
                    : <div className="service-contact-missing"><span>No phone number saved for this customer.</span><button className="text-button" type="button" onClick={() => setView("Customers")}>Add or update in Customers <ArrowUpRight size={13} /></button></div>}
                </div>}
                <label>Service / maintenance title<input value={serviceTitle} onChange={(event) => setServiceTitle(event.target.value)} maxLength={120} placeholder="e.g. Generator maintenance" required /></label>
                <label>Due date<input type="date" min={today} value={serviceDueDate} onChange={(event) => setServiceDueDate(event.target.value)} required /></label>
                <label className="crm-notes">Notes (optional)<textarea value={serviceDescription} onChange={(event) => setServiceDescription(event.target.value)} maxLength={1200} rows={2} placeholder="What should be checked or prepared?" /></label>
                <button className="button button-primary" type="submit" disabled={busy || !serviceLocationId || !serviceCustomerName.trim()}><Plus size={15} /> {busy ? "Saving…" : "Schedule follow-up"}</button>
              </form>
            </section>
            <section className="panel table-panel"><div className="table-toolbar"><div><h2>Upcoming and overdue</h2><p>{services.filter((record) => record.status === "pending").length} open · {services.filter((record) => record.status === "completed").length} completed</p></div><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a follow-up…" /></label></div><ServiceTable entries={searchedServices} today={today} onComplete={completeServiceRecord} onReminder={copyServiceReminder} /></section>
            <section className="panel table-panel"><div className="table-toolbar"><div><h2>Completed service jobs</h2><p>{serviceJobs.length} recorded · unpaid fees remain visible in Credit ledger</p></div><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a completed job…" /></label></div><ServiceJobsTable jobs={searchedServiceJobs} onRecordPayment={(job) => {
              openPaymentForm({
                id: job.id,
                source: "service",
                businessId: job.businessId,
                locationId: job.locationId,
                customer: job.customerName,
                customerPhone: job.customerPhone,
                branch: job.branch,
                item: job.title,
                quantity: 1,
                total: job.totalAmount,
                paid: job.amountPaid,
                dueDate: job.dueDate,
                payments: workspace.ledger.find((entry) => entry.id === job.id)?.payments ?? [],
              });
            }} /></section>
            <div className="reminder-notice"><Bell size={17} /><span><strong>Manual reminders only.</strong><br />Use WhatsApp or SMS to open a message draft, review it, and press send yourself. Nothing sends automatically.</span></div>
          </>}

          {view === "Credit ledger" && <>
            <div className="page-heading"><div><div className="eyebrow">CUSTOMER FOLLOW-UP</div><h1>Credit ledger</h1><p>Balances from product sales and completed service jobs.</p></div><span className="ledger-total"><span>Outstanding</span><strong>{formatNaira(outstanding)}</strong></span></div>
            {selectedPaymentEntry && <section className="panel repayment-panel">
              <div className="panel-heading"><div><h2>Record customer repayment</h2><p>{selectedPaymentEntry.customer} · {selectedPaymentEntry.item} · balance {formatNaira(selectedPaymentEntry.total - selectedPaymentEntry.paid)}</p></div><button className="icon-button" type="button" aria-label="Close repayment form" onClick={() => setSelectedPaymentEntry(null)}><X size={17} /></button></div>
              <form className="repayment-form" onSubmit={submitPayment}>
                <label>Amount received (₦)<input type="number" inputMode="numeric" min="1" max={selectedPaymentEntry.total - selectedPaymentEntry.paid} step="1" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder="Enter this repayment amount" required /></label>
                <button className="button button-secondary" type="button" onClick={() => setPaymentAmount(String(selectedPaymentEntry.total - selectedPaymentEntry.paid))}>Fill remaining balance</button>
                <button className="button button-primary" type="submit" disabled={busy}><Check size={14} />{busy ? "Saving…" : "Save repayment"}</button>
              </form>
            </section>}
            <section className="panel table-panel"><div className="table-toolbar"><div><h2>Open balances</h2><p>{ledger.length} open customer {ledger.length === 1 ? "balance" : "balances"}</p></div><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a customer…" /></label></div><CreditTable entries={searchedLedger} onRecordPayment={openPaymentForm} onReminder={copyReminder} /></section>
            <section className="panel table-panel"><div className="table-toolbar"><div><h2>Repayment history</h2><p>Recorded payments for product sales and service jobs</p></div><strong>{formatNaira(repayments.reduce((sum, entry) => sum + entry.amount, 0))} received</strong></div><RepaymentHistoryTable entries={repayments} /></section>
            <div className="reminder-notice"><Bell size={17} /><span><strong>Review reminders before sending.</strong><br />The button copies a draft only. It does not send SMS or WhatsApp messages.</span></div>
          </>}

          {view === "Insights" && <>
            <div className="page-heading"><div><div className="eyebrow">YOUR NUMBERS, MADE CLEAR</div><h1>Business insights</h1><p>Calculated from your confirmed transactions.</p></div><span className="insight-badge"><Activity size={14} /> Supabase records</span></div>
            <div className="insight-grid"><section className="panel insight-main"><div className="panel-heading"><div><h2>Sales by product</h2><p>Recorded sales for the selected locations</p></div><span className="chart-period">All recorded</span></div><SalesChart transactions={transactions} /></section><section className="panel insight-side"><div className="insight-spark"><Sparkles size={17} /></div><h2>AI business summary</h2><p>Generate concise observations from your sales, payment, stock, and recorded cost totals.</p><button className="button button-primary" type="button" onClick={() => void generateInsights()} disabled={aiInsightsBusy}>{aiInsightsBusy ? "Analyzing…" : "Generate AI insights"} <Sparkles size={14} /></button>{aiInsightsError && <p className="insight-error" role="alert">{aiInsightsError}</p>}{aiInsightsScope === locationFilter && aiInsights.length > 0 && <ul className="ai-insight-list">{aiInsights.map((insight, index) => <li key={`${index}-${insight}`}>{insight}</li>)}</ul>}<span className="insight-source"><ShieldCheck size={13} /> Gemini receives aggregated totals and product names only; not customer records.</span></section></div>
            <div className="metric-grid insight-metrics">
              <MetricCard title="Sales + service fees" value={formatNaira(totalRevenue)} change="Total recorded sales and completed work" icon={<TrendingUp size={18} />} tone="green" />
              <MetricCard title="Money collected" value={formatNaira(selectedInsights.productCollections + serviceJobs.reduce((sum, job) => sum + job.amountPaid, 0))} change="Payments received so far" icon={<Wallet size={18} />} tone="blue" />
              <MetricCard title="Outstanding debt" value={formatNaira(outstanding)} change={`${ledger.length} open credit entries`} icon={<CircleDollarSign size={19} />} tone="amber" />
              <MetricCard title="Estimated product gross profit" value={formatNaira(estimatedProductProfit)} change={`${selectedInsights.salesLinesWithoutCost} sales lines lack recorded cost; excludes other expenses`} icon={<TrendingUp size={18} />} tone="green" />
              <MetricCard title="Inventory at recorded cost" value={formatNaira(selectedInsights.inventoryValueAtCost)} change={`${selectedInsights.inventoryProductsWithCost} products have recorded restock costs`} icon={<Package size={18} />} tone="violet" />
            </div>
          </>}

          {view === "Subscription" && <>
            <div className="page-heading"><div><div className="eyebrow">TRIAL AND MONTHLY PLAN</div><h1>Subscription</h1><p>Three weeks free, then pay in Nigerian naira through Paystack.</p></div><span className="insight-badge"><CreditCard size={14} /> NGN billing</span></div>
            {ownerSubscriptionSummaries.length === 0 && <section className="panel billing-card"><h2>No subscription status found</h2><p>Apply the latest subscription migration, then reload your workspace.</p></section>}
            <div className="billing-grid">
              {ownerSubscriptionSummaries.map((subscription) => {
                const accountBusinesses = workspace.businesses.filter((business) => business.ownerId === subscription.ownerId);
                const businessId = accountBusinesses[0]?.id;
                const trialActive = subscription.status === "trialing" && subscription.hasAccess;
                const paidActive = subscription.status === "active" && subscription.hasAccess;
                const endedCanceledPeriod = subscription.status === "active" && subscription.cancelAtPeriodEnd &&
                  !subscription.hasAccess;
                const planTier = paidActive && subscription.planTier
                  ? subscription.planTier
                  : subscription.branchCount > 1
                    ? "multi"
                    : "single";
                const monthlyPrice = planTier === "single" ? 3000 : 5000;
                const formattedTrialEnd = new Date(subscription.trialEndsAt).toLocaleDateString("en-NG", {
                  day: "numeric", month: "long", year: "numeric",
                });
                const relatedNames = accountBusinesses.map((business) => business.name).join(", ");
                return <section key={subscription.ownerId} className="panel billing-card">
                  <div className="eyebrow">{subscription.canManage ? "YOUR ACCOUNT" : "BUSINESS OWNER'S ACCOUNT"}</div>
                  <h2>{relatedNames || "Business subscription"}</h2>
                  <p className="billing-status">{trialActive
                    ? `Free trial · ends ${formattedTrialEnd}`
                    : paidActive
                      ? `Active · ${subscription.planTier === "single" ? "one branch" : "multiple branches"} plan`
                      : subscription.status === "past_due"
                      ? "Payment needs attention"
                      : subscription.status === "canceled"
                        ? "Subscription canceled"
                        : endedCanceledPeriod
                          ? "Paid period ended"
                          : "Free trial ended"}</p>
                  <p>{subscription.branchCount} {subscription.branchCount === 1 ? "branch" : "branches"} across this owner&apos;s businesses. The applicable plan is <strong>₦{monthlyPrice.toLocaleString("en-NG")}/month</strong>.</p>
                  {subscription.branchCount === 0 && <p>Create a first location before checkout; pricing is ₦3,000 for one branch or ₦5,000 for two or more.</p>}
                  {paidActive && subscription.nextPaymentDate && <p>Next renewal: {new Date(subscription.nextPaymentDate).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}.</p>}
                  {paidActive && subscription.planTier === "single" && <p>The one-branch plan is limited to one location. Multi-branch pricing applies only after two or more locations are registered.</p>}
                  {subscription.cancelAtPeriodEnd && <p>Renewal is canceled. Access remains until the current paid period ends.</p>}
                  {trialActive && <p>No payment is taken during the trial. When it ends, the owner chooses whether to start the monthly subscription.</p>}
                  {subscription.status === "past_due" && <p>To restart billing, stop the failed plan first, then complete a new Paystack checkout.</p>}
                  {!subscription.hasAccess && <p>Existing records remain readable. New changes and AI requests pause until the owner subscribes.</p>}
                  {!subscription.canManage && <p>Only the business owner can start or cancel billing.</p>}
                  <div className="billing-actions">
                    {subscription.canManage && subscription.branchCount > 0 && !subscription.hasAccess && (subscription.status === "trialing" || subscription.status === "canceled" || endedCanceledPeriod) && businessId && <button className="button button-primary" type="button" onClick={() => void beginSubscription(businessId, subscription.branchCount === 1 ? "single" : "multi")} disabled={billingBusy}>{billingBusy ? "Opening checkout…" : subscription.branchCount === 1 ? "One branch · ₦3,000/month" : "Multiple branches · ₦5,000/month"}</button>}
                    {subscription.canManage && paidActive && !subscription.cancelAtPeriodEnd && businessId && <button className="button button-secondary" type="button" onClick={() => void cancelSubscription(businessId)} disabled={billingBusy}>{billingBusy ? "Updating…" : "Cancel renewal"}</button>}
                    {subscription.canManage && subscription.status === "past_due" && businessId && <button className="button button-secondary" type="button" onClick={() => void cancelSubscription(businessId, true)} disabled={billingBusy}>{billingBusy ? "Updating…" : "Stop failed plan"}</button>}
                  </div>
                </section>;
              })}
            </div>
            <div className="reminder-notice"><ShieldCheck size={17} /><span><strong>Payment safety.</strong><br />Checkout is hosted by Paystack. Your card details are not stored by Lokal Ledger. No payment is taken until an owner opens checkout and completes it.</span></div>
          </>}
        </div>
      </main>
    </div>
  );
}

function SetupScreen() {
  return <AuthShell><div className="auth-card"><div className="brand-lockup auth-brand"><BrandLogo variant="auth" /></div><div className="eyebrow">SUPABASE CONNECTION</div><h1>Connect your project</h1><p>Add your Supabase project URL and publishable key to a local <code>.env.local</code> file. Restart the dev server after saving it.</p><div className="setup-code">NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co<br />NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key</div><p className="auth-footnote">Copy <code>.env.example</code> to <code>.env.local</code>. Never add a service-role or secret key to this app.</p></div></AuthShell>;
}

function StatusScreen({ message }: { message: string }) {
  return <AuthShell><div className="auth-card status-card"><BrandLogo variant="status" /><h1>{message}</h1><div className="status-spinner" /></div></AuthShell>;
}

function WorkspaceErrorScreen({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <AuthShell>
      <div className="auth-card workspace-error-card">
        <BrandLogo variant="auth" />
        <div className="eyebrow">WORKSPACE CONNECTION</div>
        <h1>Your workspace couldn’t be loaded</h1>
        <p>{message}</p>
        <p>A loading error does not create a new workspace. Retry the connection; your existing business data is left untouched.</p>
        <button className="button button-primary" onClick={onRetry}>Try again</button>
        <button className="auth-logout" onClick={onSignOut}>Sign out</button>
      </div>
    </AuthShell>
  );
}

function AuthScreen({ mode, email, password, busy, notice, error, onMode, onEmail, onPassword, onSubmit }: {
  mode: "sign-in" | "sign-up";
  email: string;
  password: string;
  busy: boolean;
  notice: string;
  error: string;
  onMode: (mode: "sign-in" | "sign-up") => void;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <AuthShell><div className="auth-card"><div className="brand-lockup auth-brand"><BrandLogo variant="auth" /></div><div className="eyebrow">SECURE MERCHANT WORKSPACE</div><h1>{mode === "sign-in" ? "Welcome back" : "Create your account"}</h1><p>{mode === "sign-in" ? "Sign in to open your Supabase-backed business ledger." : "Create an account to set up your business workspace."}</p>{error && <div className="error-banner" role="alert">{error}</div>}{notice && <div className="toast">{notice}</div>}<form className="auth-form" onSubmit={onSubmit}><label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => onEmail(event.target.value)} required /></label><label>Password<input type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} value={password} onChange={(event) => onPassword(event.target.value)} required /></label><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}</button></form><p className="auth-switch">{mode === "sign-in" ? "New to Lokal Ledger?" : "Already registered?"} <button onClick={() => onMode(mode === "sign-in" ? "sign-up" : "sign-in")}>{mode === "sign-in" ? "Create an account" : "Sign in"}</button></p><p className="auth-footnote">Use a test account first. Never share your password or Supabase secret keys.</p></div></AuthShell>;
}

function OnboardingScreen({ businessName, locationName, busy, error, onBusinessName, onLocationName, onSubmit, onSignOut }: {
  businessName: string;
  locationName: string;
  busy: boolean;
  error: string;
  onBusinessName: (value: string) => void;
  onLocationName: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSignOut: () => void;
}) {
  return <AuthShell><div className="auth-card"><div className="brand-lockup auth-brand"><BrandLogo variant="auth" /></div><div className="eyebrow">FIRST-TIME SETUP</div><h1>Create your workspace</h1><p>Set up a business and its first location. You can add products after this.</p>{error && <div className="error-banner" role="alert">{error}</div>}<form className="auth-form" onSubmit={onSubmit}><label>Business name<input value={businessName} onChange={(event) => onBusinessName(event.target.value)} minLength={2} maxLength={100} required /></label><label>First location name<input value={locationName} onChange={(event) => onLocationName(event.target.value)} maxLength={100} placeholder="e.g. Main Store" required /></label><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create workspace"}</button></form><button className="auth-logout" onClick={onSignOut}>Sign out</button></div></AuthShell>;
}

function BrandLogo({ variant = "sidebar" }: { variant?: "sidebar" | "auth" | "status" }) {
  return (
    <Image
      className={`brand-logo brand-logo-${variant}`}
      src="/lokal-ledger-logo.webp"
      alt="Lokal Ledger"
      width={775}
      height={285}
      loading={variant === "sidebar" ? "lazy" : "eager"}
    />
  );
}

function AuthShell({ children }: { children: ReactNode }) {
  return <main className="auth-shell"><div className="auth-decoration" /><div className="auth-content">{children}</div></main>;
}

function MetricCard({ title, value, change, icon, tone }: { title: string; value: string; change: string; icon: ReactNode; tone: string }) {
  return <article className="metric-card"><div className="metric-top"><span>{title}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><strong className="metric-value">{value}</strong><div className="metric-change"><span className={`metric-dot ${tone}`} />{change}</div></article>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><ClipboardList size={19} /><span>{text}</span></div>;
}

function InventoryTable({
  items,
  archived,
  busy,
  onSetThreshold,
  onSetSellingPrice,
  onSetCost,
  onSetArchived,
}: {
  items: StockItem[];
  archived: boolean;
  busy: boolean;
  onSetThreshold: (productId: string, value: number) => void;
  onSetSellingPrice: (product: StockItem, value: number) => void;
  onSetCost: (product: StockItem) => void;
  onSetArchived: (product: StockItem, archived: boolean) => void;
}) {
  if (!items.length) return <EmptyState text={archived ? "No archived products found." : "No products found. Add a product to get started."} />;
  return <div className="table-scroll"><table className="inventory-table"><thead><tr><th>PRODUCT</th><th>LOCATION</th><th>QUANTITY</th><th>SELLING PRICE</th><th>AVERAGE COST</th><th>WATCH AT</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{items.map((item) => <InventoryTableRow key={`${item.id}-${item.reorderLevel}-${item.unitPrice}-${archived}`} item={item} archived={archived} busy={busy} onSetThreshold={onSetThreshold} onSetSellingPrice={onSetSellingPrice} onSetCost={onSetCost} onSetArchived={onSetArchived} />)}</tbody></table></div>;
}

function InventoryTableRow({
  item,
  archived,
  busy,
  onSetThreshold,
  onSetSellingPrice,
  onSetCost,
  onSetArchived,
}: {
  item: StockItem;
  archived: boolean;
  busy: boolean;
  onSetThreshold: (productId: string, value: number) => void;
  onSetSellingPrice: (product: StockItem, value: number) => void;
  onSetCost: (product: StockItem) => void;
  onSetArchived: (product: StockItem, archived: boolean) => void;
}) {
  const [reorderLevel, setReorderLevel] = useState(String(item.reorderLevel));
  const [sellingPrice, setSellingPrice] = useState(String(item.unitPrice));
  const threshold = Number(reorderLevel);
  const parsedSellingPrice = Number(sellingPrice);
  const isLow = item.stock <= item.reorderLevel;
  return <tr>
    <td><div className="product-cell"><div className="product-initial">{item.name.charAt(0)}</div><span><strong>{item.name}</strong><small>{item.category}</small></span></div></td>
    <td>{item.branch}</td>
    <td><strong>{item.stock}</strong> units</td>
    <td>{archived ? formatNaira(item.unitPrice) : <div className="stock-threshold-control"><input aria-label={`Selling price for ${item.name}`} type="number" min={item.averageCost ?? 0} step="1" value={sellingPrice} onChange={(event) => setSellingPrice(event.target.value)} /><button className="text-button" type="button" disabled={busy || sellingPrice.trim() === "" || !Number.isSafeInteger(parsedSellingPrice) || parsedSellingPrice < 0 || parsedSellingPrice === item.unitPrice} onClick={() => onSetSellingPrice(item, parsedSellingPrice)}>Save</button></div>}</td>
    <td>{archived ? item.averageCost === null ? "Not set" : formatNaira(item.averageCost) : <button className="text-button" type="button" onClick={() => onSetCost(item)}>{item.averageCost === null ? "Set cost" : `Edit ${formatNaira(item.averageCost)}`}</button>}</td>
    <td>{archived ? item.reorderLevel : <div className="stock-threshold-control"><input aria-label={`Watch ${item.name} at quantity`} type="number" min="0" max="1000000" step="1" value={reorderLevel} onChange={(event) => setReorderLevel(event.target.value)} /><button className="text-button" type="button" disabled={busy || reorderLevel.trim() === "" || !Number.isSafeInteger(threshold) || threshold < 0 || threshold > 1000000 || threshold === item.reorderLevel} onClick={() => onSetThreshold(item.id, threshold)}>Save</button></div>}</td>
    <td>{archived ? <span className="status-pill status-neutral"><span />Archived</span> : <span className={`status-pill ${isLow ? item.stock === 0 ? "status-danger" : "status-warning" : "status-good"}`}><span />{isLow ? item.stock === 0 ? "Out of stock" : "Restock soon" : "In stock"}</span>}</td>
    <td><button className="text-button" type="button" disabled={busy || (!archived && item.stock > 0)} title={!archived && item.stock > 0 ? "Clear remaining stock before archiving" : undefined} onClick={() => onSetArchived(item, !archived)}>{archived ? "Restore" : item.stock > 0 ? "Clear stock first" : "Archive"}</button></td>
  </tr>;
}

function CreditTable({ entries, onRecordPayment, onReminder }: { entries: LedgerEntry[]; onRecordPayment: (entry: LedgerEntry) => void; onReminder: (entry: LedgerEntry) => void }) {
  if (!entries.length) return <EmptyState text="No open balances in this view." />;
  return <div className="table-scroll"><table><thead><tr><th>CUSTOMER</th><th>LOCATION</th><th>ITEM / SERVICE</th><th>PAYMENT</th><th>BALANCE</th><th>DUE DATE</th><th>ACTIONS</th></tr></thead><tbody>{entries.map((entry) => {
    const balance = entry.total - entry.paid;
    const status = entry.paid === 0 ? "Unpaid" : "Part-paid";
    const whatsappNumber = getWhatsAppNumber(entry.customerPhone);
    const smsNumber = getSmsNumber(entry.customerPhone);
    const reminderMessage = getCreditReminderMessage(entry);
    return <tr key={`${entry.source}-${entry.id}`}>
      <td><div className="customer-cell"><div className="customer-avatar">{entry.customer.split(" ").map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase()}</div><span><strong>{entry.customer}</strong>{entry.customerPhone && <a className="service-phone-link" href={`tel:${smsNumber ?? entry.customerPhone}`}><Phone size={12} />{entry.customerPhone}</a>}</span></div></td>
      <td>{entry.branch}</td>
      <td>{entry.item}</td>
      <td><span className={`payment-tag ${status === "Unpaid" ? "unpaid-tag" : "partpaid-tag"}`}>{status}</span><small className="payment-detail">{formatNaira(entry.paid)} of {formatNaira(entry.total)}</small>{entry.payments.length > 0 && <details className="repayment-details"><summary>Payment history ({entry.payments.length})</summary><ul>{entry.payments.map((payment) => <li key={payment.id}><span>{formatNaira(payment.amount)}</span><time dateTime={payment.createdAt}>{new Date(payment.createdAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</time></li>)}</ul></details>}</td>
      <td><strong className="balance-value">{formatNaira(balance)}</strong></td>
      <td>{entry.dueDate ? formatDate(entry.dueDate) : "—"}</td>
      <td><div className="row-actions service-actions">
        <button className="action-button" type="button" onClick={() => onRecordPayment(entry)} title="Record a full or partial repayment"><CircleDollarSign size={14} />Record payment</button>
        {whatsappNumber
          ? <a className="action-button" href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(reminderMessage)}`} target="_blank" rel="noreferrer" aria-label={`Open WhatsApp balance reminder for ${entry.customer}`}><MessageCircle size={13} />WhatsApp</a>
          : <button className="action-button" type="button" disabled title="Add a valid Nigerian or international phone number to this customer profile"><MessageCircle size={13} />WhatsApp</button>}
        {smsNumber
          ? <a className="action-button" href={`sms:${smsNumber}?body=${encodeURIComponent(reminderMessage)}`} aria-label={`Open SMS balance reminder for ${entry.customer}`}><Smartphone size={13} />SMS</a>
          : <button className="action-button" type="button" disabled title="Add a phone number to this customer profile"><Smartphone size={13} />SMS</button>}
        <button className="icon-button reminder-button" type="button" onClick={() => onReminder(entry)} title="Copy reminder draft"><Send size={15} /></button>
      </div></td>
    </tr>;
  })}</tbody></table></div>;
}

function RepaymentHistoryTable({ entries }: { entries: RepaymentRecord[] }) {
  if (!entries.length) return <EmptyState text="No repayments recorded yet." />;
  return <div className="table-scroll"><table><thead><tr><th>DATE</th><th>CUSTOMER</th><th>LOCATION</th><th>SALE / SERVICE</th><th>PAYMENT RECEIVED</th><th>TYPE</th></tr></thead><tbody>{entries.map((entry) => <tr key={`${entry.source}-${entry.id}`}><td>{new Date(entry.createdAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</td><td>{entry.customer}</td><td>{entry.branch}</td><td>{entry.item}</td><td><strong>{formatNaira(entry.amount)}</strong></td><td>{entry.source === "service" ? "Service job" : "Product sale"}</td></tr>)}</tbody></table></div>;
}

function ServiceJobsTable({ jobs, onRecordPayment }: { jobs: ServiceJob[]; onRecordPayment: (job: ServiceJob) => void }) {
  if (!jobs.length) return <EmptyState text="No service jobs in this location view yet. Record completed work here or use Smart Log on Overview." />;
  return <div className="table-scroll"><table><thead><tr><th>CUSTOMER</th><th>LOCATION</th><th>SERVICE PROVIDED</th><th>DATE</th><th>FEE</th><th>PAID</th><th>BALANCE</th><th>PAYMENT DUE</th><th>ACTIONS</th></tr></thead><tbody>{jobs.map((job) => {
    const balance = job.totalAmount - job.amountPaid;
    return <tr key={job.id}>
      <td><div className="customer-cell"><div className="customer-avatar">{job.customerName.split(" ").map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase()}</div><span><strong>{job.customerName}</strong>{job.customerPhone && <a className="service-phone-link" href={`tel:${getSmsNumber(job.customerPhone) ?? job.customerPhone}`}><Phone size={12} />{job.customerPhone}</a>}</span></div></td>
      <td>{job.branch}</td>
      <td><strong>{job.title}</strong>{job.description && <small className="payment-detail service-description">{job.description}</small>}</td>
      <td>{formatDate(job.serviceDate)}</td>
      <td>{formatNaira(job.totalAmount)}</td>
      <td><strong>{formatNaira(job.amountPaid)}</strong>{job.payments.length > 0 && <details className="repayment-details"><summary>{job.payments.length} payment{job.payments.length === 1 ? "" : "s"}</summary><ul>{job.payments.map((payment) => <li key={payment.id}><span>{formatNaira(payment.amount)}</span><time dateTime={payment.createdAt}>{new Date(payment.createdAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</time></li>)}</ul></details>}</td>
      <td><strong className={balance > 0 ? "balance-value" : ""}>{formatNaira(balance)}</strong></td>
      <td>{job.dueDate ? formatDate(job.dueDate) : "—"}</td>
      <td>{balance > 0 ? <button className="action-button" type="button" onClick={() => onRecordPayment(job)}><CircleDollarSign size={14} />Record payment</button> : <span className="payment-tag paid-tag">Paid in full</span>}</td>
    </tr>;
  })}</tbody></table></div>;
}

function CustomerTable({
  customers,
  sales,
  serviceJobs,
  businessById,
  onEdit,
}: {
  customers: Customer[];
  sales: Transaction[];
  serviceJobs: ServiceJob[];
  businessById: Map<string, Business>;
  onEdit: (customer: Customer) => void;
}) {
  if (!customers.length) return <EmptyState text="No customer profiles in this view yet. Add one or record a sale." />;
  const salesByCustomer = new Map<string, { amount: number; records: Set<string> }>();
  for (const sale of sales) {
    if (sale.kind !== "Sale" || !sale.customerId) continue;
    const stats = salesByCustomer.get(sale.customerId) ?? { amount: 0, records: new Set<string>() };
    stats.amount += sale.amount;
    stats.records.add(sale.transactionId);
    salesByCustomer.set(sale.customerId, stats);
  }
  for (const job of serviceJobs) {
    const stats = salesByCustomer.get(job.customerId) ?? { amount: 0, records: new Set<string>() };
    stats.amount += job.totalAmount;
    stats.records.add(job.id);
    salesByCustomer.set(job.customerId, stats);
  }
  return <div className="table-scroll"><table><thead><tr><th>CUSTOMER</th><th>BUSINESS</th><th>CONTACT</th><th>NOTES</th><th>RECORDS</th><th>SALES + SERVICE</th><th>ACTIONS</th></tr></thead><tbody>{customers.map((customer) => {
    const stats = salesByCustomer.get(customer.id);
    return <tr key={customer.id}>
      <td><div className="customer-cell"><div className="customer-avatar">{customer.fullName.split(" ").map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase()}</div><strong>{customer.fullName}</strong></div></td>
      <td>{businessById.get(customer.businessId)?.name ?? "Business"}</td>
      <td>{customer.phone || "Not provided"}</td>
      <td className="customer-notes-cell">{customer.notes || "—"}</td>
      <td>{stats?.records.size ?? 0}</td>
      <td><strong>{formatNaira(stats?.amount ?? 0)}</strong></td>
      <td><button className="action-button" type="button" onClick={() => onEdit(customer)}><Pencil size={14} />Edit</button></td>
    </tr>;
  })}</tbody></table></div>;
}

function ServiceTable({
  entries,
  today,
  onComplete,
  onReminder,
}: {
  entries: ServiceRecord[];
  today: string;
  onComplete: (entry: ServiceRecord) => void;
  onReminder: (entry: ServiceRecord) => void;
}) {
  if (!entries.length) return <EmptyState text="No service follow-ups in this view yet. Schedule one above to see its reminder actions here." />;
  return <div className="table-scroll"><table><thead><tr><th>CUSTOMER</th><th>LOCATION</th><th>FOLLOW-UP</th><th>DUE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{entries.map((entry) => {
    const overdue = entry.status === "pending" && entry.dueDate < today;
    const dueToday = entry.status === "pending" && entry.dueDate === today;
    const statusText = entry.status === "completed" ? "Completed" : overdue ? "Overdue" : dueToday ? "Due today" : "Scheduled";
    const whatsappNumber = getWhatsAppNumber(entry.customerPhone);
    const smsNumber = getSmsNumber(entry.customerPhone);
    const reminderMessage = getServiceReminderMessage(entry);
    return <tr key={entry.id}>
      <td><div className="customer-cell"><div className="customer-avatar">{entry.customerName.split(" ").map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase()}</div><span><strong>{entry.customerName}</strong>{entry.customerPhone && <a className="service-phone-link" href={`tel:${getSmsNumber(entry.customerPhone) ?? entry.customerPhone}`}><Phone size={12} />{entry.customerPhone}</a>}{!entry.customerPhone && <small className="payment-detail">No phone on profile</small>}</span></div></td>
      <td>{entry.branch}</td>
      <td><strong>{entry.title}</strong>{entry.description && <small className="payment-detail service-description">{entry.description}</small>}</td>
      <td>{formatDate(entry.dueDate)}</td>
      <td><span className={`service-status${entry.status === "completed" ? " service-completed" : overdue ? " service-overdue" : dueToday ? " service-due-today" : ""}`}>{statusText}</span></td>
      <td><div className="row-actions service-actions">{entry.status === "pending" ? <><button className="action-button" onClick={() => onComplete(entry)} title="Mark follow-up complete"><Check size={14} />Done</button>{whatsappNumber ? <a className="action-button" href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(reminderMessage)}`} target="_blank" rel="noreferrer" aria-label={`Open WhatsApp reminder for ${entry.customerName}`}><MessageCircle size={13} />WhatsApp</a> : <button className="action-button" type="button" disabled title="Add a valid Nigerian or international phone number to this customer profile"><MessageCircle size={13} />WhatsApp</button>}{smsNumber ? <a className="action-button" href={`sms:${smsNumber}?body=${encodeURIComponent(reminderMessage)}`} aria-label={`Open SMS reminder for ${entry.customerName}`}><Smartphone size={13} />SMS</a> : <button className="action-button" type="button" disabled title="Add a phone number to this customer profile"><Smartphone size={13} />SMS</button>}<button className="icon-button reminder-button" onClick={() => onReminder(entry)} title="Copy reminder draft"><Send size={15} /></button></> : <button className="action-button" onClick={() => onComplete(entry)} title="Undo completion and reopen this follow-up"><Undo2 size={14} />Undo</button>}</div></td>
    </tr>;
  })}</tbody></table></div>;
}

function SalesChart({ transactions }: { transactions: Transaction[] }) {
  const totals = transactions.filter((item) => item.kind === "Sale").reduce<Record<string, number>>((result, item) => {
    result[item.item] = (result[item.item] ?? 0) + item.amount;
    return result;
  }, {});
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maximum = Math.max(1, ...rows.map(([, amount]) => amount));
  if (!rows.length) return <EmptyState text="Record a sale to see product insights." />;
  return <div className="bar-chart">{rows.map(([name, amount], index) => <div className="bar-row" key={name}><span className="bar-label">{name}</span><div className="bar-track"><div className={`bar-fill bar-${index + 1}`} style={{ width: `${Math.max(amount / maximum * 100, 5)}%` }} /></div><strong>{formatNaira(amount)}</strong></div>)}</div>;
}
