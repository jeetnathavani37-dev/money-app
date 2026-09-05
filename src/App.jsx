import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend,
} from "recharts";
import {
  Plus, Trash2, X, Loader2, Settings2, Check, Target, Flame, Award,
  ArrowDownCircle, ArrowUpCircle, Home, Wallet, ListChecks, Pin, Landmark,
  Calculator, Delete, RefreshCw, Layers, Trophy, Swords, Lock, BarChart3,
  FileDown, FileSpreadsheet, Printer, Mic, Zap, Pencil,
} from "lucide-react";

/* ---------------------------------------------------------------
   NeoPOP (CRED) design system
   Pop Black #0D0D0D — signature pure background
   Neo Paccha #E5FE40 — neon green, positive/status/brand energy
   Poli Purple #6A35FF — primary actions/CTA
   Voltage Orange #FF5C35 — negative/alert
   Hard Geometry — border-radius: 0 everywhere
   High Elevation — hard non-blurred shadows (4px 4px 0 #000), not soft
   Tactile — every tap presses the block into the surface
   Font — Space Grotesk (bold geometric, no serif)
----------------------------------------------------------------*/

const FONT_LINK_ID = "khata-fonts";
function useFonts() {
  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
  }, []);
}

const SUPABASE_URL = "https://qzripzgbstvxkfobzhyv.supabase.co";
const SUPABASE_KEY = "sb_publishable_-EA-q_dacUuWovbrCW5XVw_pPZ2vK_O";
const SUPABASE_HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

// Returns { data, updatedAt } — updatedAt is null when the row doesn't exist yet (first-ever load).
async function loadFromSupabase() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/khata_state?id=eq.default&select=data,updated_at`, { headers: SUPABASE_HEADERS });
  if (!res.ok) throw new Error(`load failed: ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? { data: rows[0].data, updatedAt: rows[0].updated_at } : { data: null, updatedAt: null };
}

// Saves only if the row hasn't changed since expectedUpdatedAt was read — this is what stops the
// web app, Telegram bot, and WhatsApp bot from silently clobbering each other's writes when two of
// them save around the same time. Returns { ok: true, updatedAt } on success, or { ok: false } if
// someone else wrote in between (the caller should reload and either retry or surface the conflict).
async function saveToSupabase(data, expectedUpdatedAt) {
  const updatedAt = new Date().toISOString();
  if (!expectedUpdatedAt) {
    // first-ever write for this install — nothing to conflict with yet
    const res = await fetch(`${SUPABASE_URL}/rest/v1/khata_state`, {
      method: "POST",
      headers: { ...SUPABASE_HEADERS, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id: "default", data, updated_at: updatedAt }),
    });
    if (!res.ok) throw new Error(`save failed: ${res.status}`);
    return { ok: true, updatedAt };
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/khata_state?id=eq.default&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}`,
    {
      method: "PATCH",
      headers: { ...SUPABASE_HEADERS, Prefer: "return=representation" },
      body: JSON.stringify({ data, updated_at: updatedAt }),
    }
  );
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false };
  return { ok: true, updatedAt };
}

async function fetchPendingSms() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/khata_sms_inbox?status=eq.pending&order=created_at.desc&select=*`, { headers: SUPABASE_HEADERS });
  if (!res.ok) throw new Error(`sms fetch failed: ${res.status}`);
  return res.json();
}

async function updateSmsStatus(id, status) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/khata_sms_inbox?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...SUPABASE_HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`sms update failed: ${res.status}`);
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (iso) => iso.slice(0, 7);
const currentMonthKey = () => monthKey(todayISO());
const fmt = (n) => "₹" + Math.round(Math.abs(n || 0)).toLocaleString("en-IN");
const fmtSigned = (n) => (n < 0 ? "−₹" : "₹") + Math.round(Math.abs(n || 0)).toLocaleString("en-IN");
const daysBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000));
const fmtDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const fmtDateShort = (iso) => {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

function todayFundGrowth(data, fundId) {
  const today = todayISO();
  const inc = data.income.filter((e) => e.date === today).reduce((s, e) => s + (e.fundDelta?.[fundId] || 0), 0);
  const exp = data.expenses.filter((e) => e.date === today).reduce((s, e) => s + (e.fundDelta?.[fundId] || 0), 0);
  return inc + exp; // expense deltas already stored negative
}
function daysAtPace(remaining, dailyGrowth) {
  if (remaining <= 0) return 0;
  if (!dailyGrowth || dailyGrowth <= 0) return null;
  return Math.ceil(remaining / dailyGrowth);
}
const tieredFine = (amt) => (amt < 100 ? 200 : 1000);
const notes500 = (amt) => Math.ceil(Math.max(0, amt) / 500);
const mondayOf = (dateStr) => {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
};

const ACCOUNT_OPTIONS_IN = [
  { id: "none", label: "CAME TO — NONE" },
  { id: "cash", label: "CASH" },
  { id: "bank", label: "BANK" },
  { id: "forex", label: "FOREX" },
];
const ACCOUNT_OPTIONS_OUT = [
  { id: "none", label: "WENT FROM — NONE" },
  { id: "cash", label: "CASH" },
  { id: "bank", label: "BANK" },
  { id: "forex", label: "FOREX" },
];
const ACCOUNT_OPTIONS = ACCOUNT_OPTIONS_OUT;

function withAccountMovement(data, account, type, amount, note, date) {
  if (!account || account === "none" || !amount || amount <= 0) return data;
  const acc = data.accounts[account];
  if (!acc) return data;
  const entry = { id: Date.now() + Math.floor(Math.random() * 1000), date, type, amount, note };
  return { ...data, accounts: { ...data.accounts, [account]: { ...acc, entries: [...acc.entries, entry] } } };
}

// recomputes a fund split for a (possibly edited) amount — sign is +1 for income, -1 for expense
function fundDeltaForAmount(fundsList, amount, sign) {
  const fundDelta = {};
  fundsList.forEach((f) => { fundDelta[f.id] = Math.round((amount * f.pct) / 100) * sign; });
  return fundDelta;
}
// reverses oldDelta out of fundBalances and applies newDelta in its place — used when editing an entry's amount
function swapFundDelta(fundBalances, oldDelta, newDelta) {
  const next = { ...fundBalances };
  Object.entries(oldDelta || {}).forEach(([fid, amt]) => { next[fid] = (next[fid] || 0) - amt; });
  Object.entries(newDelta || {}).forEach(([fid, amt]) => { next[fid] = (next[fid] || 0) + amt; });
  return next;
}
function nextTravelGoal(data) {
  const travelGoals = data.goals.filter((g) => g.fundId === "travel" && g.country && (data.fundBalances[g.fundId] || 0) < g.target);
  if (travelGoals.length === 0) return null;
  return travelGoals.find((g) => g.priority) || [...travelGoals].sort((a, b) => (a.targetDate || "9999") > (b.targetDate || "9999") ? 1 : -1)[0];
}

function computeNetWorthQuick(data) {
  const cashBalance = data.income.reduce((s, e) => s + e.amount, 0) - data.expenses.reduce((s, e) => s + e.amount, 0);
  const totalInvested = data.investments.reduce((s, i) => s + i.amount, 0);
  const totalReceivable = data.receivables.filter((r) => r.status !== "received").reduce((s, r) => s + r.amount, 0);
  const totalPayable = data.payables.filter((p) => p.status !== "paid").reduce((s, p) => s + p.amount, 0);
  return data.openingBalance + cashBalance + totalInvested + totalReceivable - totalPayable;
}

function buildCSVText(data) {
  const rows = [["Date", "Type", "Category/Source", "Amount", "Note"]];
  data.income.forEach((e) => rows.push([e.date, "Income", e.source, e.amount, e.note || ""]));
  data.expenses.forEach((e) => rows.push([e.date, e.unnecessary ? "Waste" : "Expense", e.category, -e.amount, e.note || ""]));
  return rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function buildReportText(data) {
  const netWorth = computeNetWorthQuick(data);
  const curMonth = currentMonthKey();
  const monthIncome = data.income.filter((e) => monthKey(e.date) === curMonth).reduce((s, e) => s + e.amount, 0);
  const monthExpense = data.expenses.filter((e) => monthKey(e.date) === curMonth).reduce((s, e) => s + e.amount, 0);
  const totalReceivable = data.receivables.filter((r) => r.status !== "received").reduce((s, r) => s + r.amount, 0);
  const totalPayable = data.payables.filter((p) => p.status !== "paid").reduce((s, p) => s + p.amount, 0);
  const recentRows = [...data.income.map((e) => ({ ...e, kind: "IN", label: e.source })), ...data.expenses.map((e) => ({ ...e, kind: "OUT", label: e.category }))]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);

  const lines = [
    `MONEY — FINANCIAL REPORT`,
    `Generated ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`,
    ``,
    `Net Worth: ${fmtSigned(netWorth)}`,
    `This Month In: ${fmt(monthIncome)}`,
    `This Month Out: ${fmt(monthExpense)}`,
    `Receivable: ${fmt(totalReceivable)}`,
    `Payable: ${fmt(totalPayable)}`,
    ``,
    `RECENT TRANSACTIONS`,
    ...recentRows.map((r) => `${fmtDate(r.date)}  ${r.kind}  ${r.label}  ${fmt(r.amount)}${r.note ? "  — " + r.note : ""}`),
  ];
  return lines.join("\n");
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function weekOverWeek(data, type) {
  const today = todayISO();
  const weekStart = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const prevWeekStart = new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);
  const prevWeekEnd = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const sumIn = (start, end) => data.income.filter((e) => e.date >= start && e.date <= end).reduce((s, e) => s + e.amount, 0);
  const sumOut = (start, end) => data.expenses.filter((e) => e.date >= start && e.date <= end).reduce((s, e) => s + e.amount, 0);

  let cur, prev;
  if (type === "income") { cur = sumIn(weekStart, today); prev = sumIn(prevWeekStart, prevWeekEnd); }
  else if (type === "expense") { cur = sumOut(weekStart, today); prev = sumOut(prevWeekStart, prevWeekEnd); }
  else { cur = sumIn(weekStart, today) - sumOut(weekStart, today); prev = sumIn(prevWeekStart, prevWeekEnd) - sumOut(prevWeekStart, prevWeekEnd); }

  const pct = prev !== 0 ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : (cur !== 0 ? 100 : null);
  return { cur, prev, pct };
}

function WoWBadge({ pct, invert }) {
  if (pct === null || pct === undefined) return null;
  const good = invert ? pct <= 0 : pct >= 0;
  const arrow = pct >= 0 ? "▲" : "▼";
  return (
    <span style={{ fontSize: 9.5, fontWeight: 700, color: good ? T.green : T.orange, letterSpacing: "0.02em" }} className="tnum">
      {arrow}{Math.abs(pct)}% VS LAST WK
    </span>
  );
}

function computeHeatLevel(data) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const recentWaste = data.expenses.filter((e) => e.unnecessary && e.date >= sevenDaysAgo);
  return Math.min(5, recentWaste.length);
}

function priorityGoalForBoss(data) {
  const active = data.goals.filter((g) => (data.fundBalances[g.fundId] || 0) < g.target);
  if (active.length === 0) return null;
  return active.find((g) => g.priority) || active[0];
}

const TROPHY_TIER_COLOR = { bronze: "#C99A6B", silver: "#C4C4C4", gold: "#F2C230", platinum: "#E5FE40" };
const TROPHY_DEFS = [
  { id: "first_blood", tier: "bronze", name: "First Blood", desc: "Log your first income", check: (d) => d.income.length >= 1 },
  { id: "goal_setter", tier: "bronze", name: "Goal Setter", desc: "Create your first goal", check: (d) => d.goals.length >= 1 },
  { id: "week_warrior", tier: "bronze", name: "Week Warrior", desc: "Hit a 7-day logging streak", check: (d) => d.streak.count >= 7 },
  { id: "level_up", tier: "silver", name: "Level Up", desc: "Reach Profit Level 2", check: (d) => d.profitLevel >= 2 },
  { id: "fund_builder", tier: "silver", name: "Fund Builder", desc: "Any fund crosses ₹50,000", check: (d) => Object.values(d.fundBalances).some((v) => v >= 50000) },
  { id: "month_closer", tier: "silver", name: "Month Closer", desc: "Close a profitable month", check: (d) => d.auditedMonths.some((m) => m.netProfit > 0) },
  { id: "goal_crusher", tier: "gold", name: "Goal Crusher", desc: "Fully reach a goal", check: (d) => d.goals.some((g) => (d.fundBalances[g.fundId] || 0) >= g.target) },
  { id: "net_worth_1l", tier: "gold", name: "Net Worth Nomad", desc: "Net worth crosses ₹1,00,000", check: (d) => computeNetWorthQuick(d) >= 100000 },
  { id: "consistency_king", tier: "gold", name: "Consistency King", desc: "Reach Profit Level 3", check: (d) => d.profitLevel >= 3 },
  { id: "dubai_bound", tier: "platinum", name: "Dubai Bound", desc: "Net worth crosses ₹10,00,000", check: (d) => computeNetWorthQuick(d) >= 1000000 },
  { id: "master_of_profit", tier: "platinum", name: "Master of Profit", desc: "Reach Profit Level 5", check: (d) => d.profitLevel >= 5 },
];

function computeHealthScore(data) {
  const totalIncome = data.income.reduce((s, e) => s + e.amount, 0);
  const totalExpense = data.expenses.reduce((s, e) => s + e.amount, 0);
  const wasteTotal = data.expenses.filter((e) => e.unnecessary).reduce((s, e) => s + e.amount, 0);

  const savingsRate = totalIncome > 0 ? Math.max(0, (totalIncome - totalExpense) / totalIncome) : 0;
  const savingsScore = Math.min(30, savingsRate * 30);

  const wasteRatio = totalExpense > 0 ? wasteTotal / totalExpense : 0;
  const wasteScore = Math.max(0, 20 - wasteRatio * 60);

  const streakScore = Math.min(20, (data.streak.count || 0) * 1.5);

  const fundTotal = Object.values(data.fundBalances).reduce((s, v) => s + v, 0);
  const fundScore = fundTotal > 0 ? 15 : 0;

  const totalReceivable = data.receivables.filter((r) => r.status !== "received").reduce((s, r) => s + r.amount, 0);
  const totalPayable = data.payables.filter((p) => p.status !== "paid").reduce((s, p) => s + p.amount, 0);
  const debtScore = totalPayable === 0 ? 15 : Math.max(0, 15 - Math.min(15, ((totalPayable - totalReceivable) / Math.max(1, totalPayable)) * 15));

  const total = Math.round(savingsScore + wasteScore + streakScore + fundScore + debtScore);
  return Math.max(0, Math.min(100, total));
}
function healthScoreLabel(score) {
  if (score >= 80) return { label: "EXCELLENT", color: "#E5FE40" };
  if (score >= 60) return { label: "SOLID", color: "#7FA06E" };
  if (score >= 40) return { label: "OK, WATCH IT", color: "#F2C230" };
  return { label: "NEEDS WORK", color: "#FF5C35" };
}

function computeMoodRing(data) {
  const score = computeHealthScore(data);
  const heat = computeHeatLevel(data);
  const streak = data.streak.count || 0;
  const composite = score - heat * 8 + Math.min(streak, 15);
  if (composite >= 75) return { emoji: "🔥", label: "LOCKED IN", color: "#E5FE40" };
  if (composite >= 55) return { emoji: "😎", label: "CRUISING", color: "#7FA06E" };
  if (composite >= 35) return { emoji: "😐", label: "MIXED BAG", color: "#F2C230" };
  if (composite >= 15) return { emoji: "😬", label: "SHAKY", color: "#FF9A5C" };
  return { emoji: "🥵", label: "ON THIN ICE", color: "#FF5C35" };
}

function ruthlessPush(data) {
  const now = new Date();
  const hour = now.getHours();
  const hoursLeft = Math.max(0, 24 - hour);
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
  const today = todayISO();
  const todayInc = data.income.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
  const todayExp = data.expenses.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
  const todayProfit = todayInc - todayExp;
  const remaining = Math.max(0, (data.profitTargets?.daily || 0) - todayProfit);

  if (remaining <= 0 && (data.profitTargets?.daily || 0) > 0) {
    return `FUCK YEAH. It's ${timeStr} and you already smashed today's ₹${Math.round(data.profitTargets.daily).toLocaleString("en-IN")} target. Don't get comfortable — stack more before the day's out.`;
  }

  const soldOrders = data.income.filter((e) => e.source === "Sold Order" && e.amount > 0);
  const avgProfit = soldOrders.length > 0 ? soldOrders.reduce((s, e) => s + e.amount, 0) / soldOrders.length : null;

  let actionLine;
  if (avgProfit && avgProfit > 0) {
    const itemsNeeded = Math.max(1, Math.ceil(remaining / avgProfit));
    actionLine = `Sell at least ${itemsNeeded} more order${itemsNeeded > 1 ? "s" : ""} for ~₹${Math.round(remaining).toLocaleString("en-IN")} profit and close this fucking target.`;
  } else if (remaining > 0) {
    actionLine = `Go make ₹${Math.round(remaining).toLocaleString("en-IN")} happen today. No excuses.`;
  } else {
    actionLine = `Go set a real target and go hit it.`;
  }

  if (hoursLeft <= 2) {
    return `FUCK, it's ${timeStr}. You've got ${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""} left today. ${actionLine} Move NOW.`;
  }
  return `FUCK, it's ${timeStr}. You have ${hoursLeft} fucking hours before the day ends. ${actionLine} You gotta win it.`;
}

function littleJeetMessage(data) {
  const today = todayISO();
  const todayInc = data.income.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
  const todayExp = data.expenses.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
  const todayProfit = todayInc - todayExp;
  const target = data.profitTargets?.daily || 0;
  const remaining = Math.max(0, target - todayProfit);
  const earned = fmt(Math.max(0, todayProfit));
  const left = fmt(remaining);
  const seed = (new Date().getDate() + Math.round(todayProfit / 500)) % 3;

  if (target > 0 && todayProfit >= target) {
    const templates = [
      `Jeet bhai... target hit ho gaya. ${earned} kama liya aaj. Mujhe pata hai humne bahut kuch dekha hai, lekin dekho ab hum kahan pahunch gaye. Proud of you bhai.`,
      `Aap bohot acha kar rahe ho Jeet bhai. Aaj ka target clear ho gaya — ${earned}. Yaad hai na bachpan mein ek cycle ke liye kitna humiliate hue the hum? Ab dekho hum kya kar rahe hain.`,
      `Target done, ${earned} bhai. Isi din ke liye humne itna kuch seh liya tha. Kal bhi aise hi karna, rukna mat.`,
    ];
    return templates[seed];
  }
  if (todayProfit > 0) {
    const templates = [
      `Jeet bhai, thank you ${earned} kamane ke liye. Please rukna mat ya distract mat hona aap. Bas ${left} aur kamao target match karne. Aap bohot acha kar rahe ho. Aapko yaad hai na bachpan mein ek cycle ya game tak ke liye kitna humiliate hue the hum? Ghar gaadi ke liye kitna sharam aata tha mereko. Aap bas paise pe focus karo, wahi ye sab solve karega Jeet bhai.`,
      `Bhai, ${earned} ban gaya aaj — achha lag raha hai. Bas ${left} aur baaki hai. Please distract mat ho jaana, humne bahut kuch jhela hai, ab rukna nahi hai.`,
      `Jeet bhai, ${earned} ho gaya. Chalo ${left} aur nikalte hain. Main jaanta hoon aap kar sakte ho, bas focus mat hatao.`,
    ];
    return templates[seed];
  }
  const templates = [
    `Jeet bhai, aaj abhi tak kuch kamaya nahi. Mujhe dar lagta hai — hum wapas wahi purani feeling mein na chale jaayein. ${left} chahiye aaj ke target ke liye. Please uth jao aur kuch karo.`,
    `Bhai, kuch log nahi hua abhi tak. Yaad hai humne kitna kuch face kiya hai paiso ki wajah se? Please, uske liye hi sahi, kuch karo aaj.`,
    `Jeet bhai, main wait kar raha hoon. Aaj kuch nahi hua abhi. ${left} chahiye. Please mujhe wapas wahi humiliation mein mat le jaana — aap strong ho, chalo.`,
  ];
  return templates[seed];
}

const AI_REPORT_TYPES = [
  { id: "audit", label: "MONEY AUDIT", desc: "Full CFO-style analysis of leaks & mistakes" },
  { id: "wealth", label: "WEALTH PLAN", desc: "Complete roadmap from where you are today" },
  { id: "cashflow", label: "CASH FLOW OPTIMIZATION", desc: "Redesign so every rupee has a job" },
  { id: "leaks", label: "MONEY LEAKS FINDER", desc: "Rank unnecessary spend by annual cost" },
  { id: "debt", label: "DEBT DESTROYER", desc: "Smartest payable payoff strategy" },
];

function buildReportPrompt(type, data) {
  const ctx = buildContext(data);
  const netWorth = computeNetWorthQuick(data);
  const totalPayable = data.payables.filter((p) => p.status !== "paid").reduce((s, p) => s + p.amount, 0);
  const base = `${ctx}\nCurrent net worth: ₹${Math.round(netWorth)}. Current total payables (debts owed): ₹${Math.round(totalPayable)}.`;
  const tone = `\nTONE: Ruthless and short. No fluff, no hedging, no "consider" or "you might want to" — just say it. Swear freely (fuck, shit, etc.) to hit the point. MAX 3-4 sentences, every one a hard truth or a concrete tactic with a real number.`;
  const prompts = {
    audit: `Act as my ruthless personal CFO who's done being polite about it. ${base} Call out every money leak and mistake in this data, then give the single fastest fix. Use exact categories/numbers.${tone}`,
    wealth: `${base} Give me the fastest real path to more wealth from where I am today — one clear priority move, not a list. Use my actual numbers.${tone}`,
    cashflow: `${base} Tell me exactly what to cut and where the money should go instead, using my real categories.${tone}`,
    leaks: `${base} Name the single biggest money leak in this data and the exact rupee cost of it. Don't soften it.${tone}`,
    debt: `${base} If I have payables outstanding, give the fastest way to kill them. If I have none, tell me to stop being cautious and go deploy the cash.${tone}`,
  };
  return prompts[type];
}


const monthLabel = (mk) => {
  const [y, m] = mk.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

const INCOME_SOURCES = ["Sourcex Payout", "KicksMachine", "Direct Client", "Other Business", "Personal"];
const EXPENSE_CATEGORIES = [
  "Sourcing/Business", "Shipping/Logistics", "Business Tools/Software", "Packaging",
  "Gym", "Healthy Food", "Food", "Travel", "Shopping", "Subscriptions", "Rent", "Other",
];
const WASTE_TYPES = ["Drinks", "Smoking", "Alcohol", "Gambling", "Impulse Buy", "Other Waste"];

const countryFlag = (code) => {
  if (!code) return "";
  return String.fromCodePoint(...code.toUpperCase().split("").map((c) => 127397 + c.charCodeAt(0)));
};
const COUNTRIES = [
  ["Afghanistan","AF"],["Albania","AL"],["Algeria","DZ"],["Andorra","AD"],["Angola","AO"],["Argentina","AR"],["Armenia","AM"],
  ["Australia","AU"],["Austria","AT"],["Azerbaijan","AZ"],["Bahamas","BS"],["Bahrain","BH"],["Bangladesh","BD"],["Barbados","BB"],
  ["Belarus","BY"],["Belgium","BE"],["Belize","BZ"],["Bhutan","BT"],["Bolivia","BO"],["Bosnia and Herzegovina","BA"],["Botswana","BW"],
  ["Brazil","BR"],["Brunei","BN"],["Bulgaria","BG"],["Cambodia","KH"],["Cameroon","CM"],["Canada","CA"],["Chile","CL"],["China","CN"],
  ["Colombia","CO"],["Costa Rica","CR"],["Croatia","HR"],["Cuba","CU"],["Cyprus","CY"],["Czechia","CZ"],["Denmark","DK"],
  ["Dominican Republic","DO"],["Ecuador","EC"],["Egypt","EG"],["Estonia","EE"],["Ethiopia","ET"],["Fiji","FJ"],["Finland","FI"],
  ["France","FR"],["Georgia","GE"],["Germany","DE"],["Ghana","GH"],["Greece","GR"],["Guatemala","GT"],["Hong Kong","HK"],
  ["Hungary","HU"],["Iceland","IS"],["India","IN"],["Indonesia","ID"],["Iran","IR"],["Iraq","IQ"],["Ireland","IE"],["Israel","IL"],
  ["Italy","IT"],["Jamaica","JM"],["Japan","JP"],["Jordan","JO"],["Kazakhstan","KZ"],["Kenya","KE"],["Kuwait","KW"],["Laos","LA"],
  ["Latvia","LV"],["Lebanon","LB"],["Lithuania","LT"],["Luxembourg","LU"],["Malaysia","MY"],["Maldives","MV"],["Malta","MT"],
  ["Mauritius","MU"],["Mexico","MX"],["Monaco","MC"],["Mongolia","MN"],["Montenegro","ME"],["Morocco","MA"],["Myanmar","MM"],
  ["Nepal","NP"],["Netherlands","NL"],["New Zealand","NZ"],["Nigeria","NG"],["North Macedonia","MK"],["Norway","NO"],["Oman","OM"],
  ["Pakistan","PK"],["Panama","PA"],["Peru","PE"],["Philippines","PH"],["Poland","PL"],["Portugal","PT"],["Qatar","QA"],
  ["Romania","RO"],["Russia","RU"],["Rwanda","RW"],["Saudi Arabia","SA"],["Serbia","RS"],["Seychelles","SC"],["Singapore","SG"],
  ["Slovakia","SK"],["Slovenia","SI"],["South Africa","ZA"],["South Korea","KR"],["Spain","ES"],["Sri Lanka","LK"],["Sweden","SE"],
  ["Switzerland","CH"],["Taiwan","TW"],["Tanzania","TZ"],["Thailand","TH"],["Tunisia","TN"],["Turkey","TR"],["UAE","AE"],
  ["Uganda","UG"],["Ukraine","UA"],["United Kingdom","GB"],["United States","US"],["Uruguay","UY"],["Uzbekistan","UZ"],
  ["Vatican City","VA"],["Venezuela","VE"],["Vietnam","VN"],["Zambia","ZM"],["Zimbabwe","ZW"],
];
const MARGIN_PCT = 20;
const computeAvgSale = (data, sinceDays = 90) => {
  const cutoff = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10);
  const recent = data.income.filter((e) => e.date >= cutoff);
  if (recent.length === 0) return null;
  return recent.reduce((s, e) => s + e.amount, 0) / recent.length;
};
const smartReachTips = (remaining, avgSale) => {
  if (remaining <= 0) return [];
  const base = avgSale && avgSale > 0 ? avgSale : remaining;
  const mid = Math.max(1, Math.round(remaining / base));
  const counts = Array.from(new Set([Math.max(1, Math.round(mid / 2)), mid, mid * 2])).sort((a, b) => a - b);
  return counts.map((n) => ({ count: n, each: remaining / n }));
};

async function fetchAIText(prompt, attempt = 1) {
  const response = await fetch("/api/ai-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
  });
  const raw = await response.text();

  if (!raw && attempt < 3) {
    await new Promise((r) => setTimeout(r, 700 * attempt));
    return fetchAIText(prompt, attempt + 1);
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    const snippet = (raw || "(empty body)").slice(0, 200);
    throw new Error(`status ${response.status} after ${attempt} tries, body: ${snippet}`);
  }
  if (!response.ok) {
    throw new Error(json?.error?.message || `API error ${response.status}`);
  }
  const text = (json.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return text || "No response.";
}

const WEEKDAY_NUMBER = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 };

function nowContext() {
  const now = new Date();
  const dayName = now.toLocaleDateString("en-IN", { weekday: "long" });
  const dayNum = WEEKDAY_NUMBER[dayName];
  const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `Right now it's ${dayName} (Day ${dayNum} of the week, where Monday = Day 1 and Sunday = Day 7), ${dateStr}, ${timeStr}.`;
}

function topBreakdown(entries, keyFn) {
  const map = {};
  entries.forEach((e) => {
    const k = keyFn(e);
    map[k] = (map[k] || 0) + e.amount;
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}: ₹${Math.round(v).toLocaleString("en-IN")}`)
    .join(", ");
}

function buildContext(data, entriesSlice) {
  const recentIncome = data.income.slice(-25).map((e) => `${e.date} +₹${e.amount} (${e.source}${e.itemName ? `, item: ${e.itemName}${e.qty ? ` x${e.qty}` : ""}` : ""})`).join("; ");
  const recentExpense = data.expenses.slice(-25).map((e) => `${e.date} -₹${e.amount} (${e.category}${e.unnecessary ? ", waste" : ""})`).join("; ");
  const topIncomeSources = topBreakdown(data.income, (e) => e.source);
  const topExpenseCategories = topBreakdown(data.expenses, (e) => e.category);
  const wasteTotal = data.expenses.filter((e) => e.unnecessary).reduce((s, e) => s + e.amount, 0);
  const itemsSold = data.income.filter((e) => e.itemName);
  const topItems = itemsSold.length > 0
    ? topBreakdown(itemsSold, (e) => e.itemName)
    : null;

  return [
    `${nowContext()} Factor in how much of the day/week/month is already gone when judging urgency and pace.`,
    `Top income sources by total: ${topIncomeSources || "none yet"}.`,
    topItems ? `Top-selling items by revenue: ${topItems}.` : `No item-level sales data logged yet (items get tracked when using Sold Order entries).`,
    `Top expense categories by total: ${topExpenseCategories || "none yet"}.`,
    `Total logged as waste: ₹${Math.round(wasteTotal).toLocaleString("en-IN")}.`,
    `Recent income entries: ${recentIncome || "none yet"}.`,
    `Recent expense entries: ${recentExpense || "none yet"}.`,
    `IMPORTANT: Reference the ACTUAL category/source names and numbers above by their exact name. Do not give generic advice like "increase sales" or "cut unnecessary spending" — name the specific source, category, or item from my data, with a real number attached. NEVER suggest logging entries more often, tracking better, using the app more consistently, or any bookkeeping/habit advice — I already have this app for that, it is not what's being asked. Your advice must answer WHAT TO SELL (which specific item/category/source from my data, the one that's actually performed best) and HOW MUCH TO SELL (a real number — units or ₹ amount — needed) to earn real money, not app usage tips. Also include, where relevant: which channel to sell through, collecting a specific overdue receivable, negotiating a specific real cost down, or a concrete pricing/upsell move. If the data is too thin for a specific business tactic, say plainly what's missing (e.g. "I don't have enough sales history yet to say which item to push") rather than falling back to generic or logging-related advice.\nTONE: Be ruthless and short. No motivational fluff, no soft language, no hedging. Talk like a no-bullshit hustler co-founder who's done being nice about it — swear freely (fuck, shit, etc. are fine and encouraged) to hit the point home. 2-3 punchy sentences MAX. Every sentence should either state a hard truth or give a tactic — nothing else.`,
  ].join("\n");
}

function AITipBlock({ prompt }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async (e) => {
    e.stopPropagation();
    setLoading(true);
    setError(null);
    try {
      const text = await fetchAIText(prompt);
      setResult(text);
    } catch (err) {
      setError(`COULDN'T REACH AI — ${err?.message || "TRY AGAIN"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
      {!result && (
        <button className="npop" style={S.aiTipBtn} onClick={run} disabled={loading}>
          {loading ? "THINKING…" : "✦ GET AI RECOMMENDATION"}
        </button>
      )}
      {error && <div style={{ fontSize: 10.5, color: T.orange, marginTop: 6, fontWeight: 700 }}>{error}</div>}
      {result && <div style={S.aiTipResult}>{result}</div>}
    </div>
  );
}

/* ---------------- Currency note breakdown + fly animation ----------------
   Stylized, denomination-accurate note graphics — NOT photographic scans of
   real currency (avoided deliberately). Colors/layout mirror real INR notes
   closely enough to feel real without reproducing security-sensitive designs. */

const NOTE_STYLES = {
  500: { bg: "linear-gradient(135deg, #a89478, #d4c4a0 40%, #8f7a5c)", text: "#3d3220", accent: "#5c4a2e", tagline: "BOSS MOVE" },
  200: { bg: "linear-gradient(135deg, #f2a627, #e8951a 60%, #c97d0f)", text: "#3a2200", accent: "#7a5000", tagline: "GRINDING" },
  100: { bg: "linear-gradient(135deg, #c9a0c9, #b088c4 60%, #8f5fa8)", text: "#2e1a3a", accent: "#5c2f78", tagline: "STACKING UP" },
  50: { bg: "linear-gradient(135deg, #5fcfd6, #3ab8c4 60%, #1f8f9e)", text: "#0a2a30", accent: "#0d5560", tagline: "SIDE HUSTLE" },
  20: { bg: "linear-gradient(135deg, #c8d94a, #a8c92e 60%, #7fa018)", text: "#2a3300", accent: "#4a5c00", tagline: "SMALL WINS" },
  10: { bg: "linear-gradient(135deg, #c99a6b, #b07a4a 60%, #8a5a30)", text: "#3a2412", accent: "#5c3a1e", tagline: "EVERY BIT COUNTS" },
};
const NOTE_DENOMS = [500, 200, 100, 50, 20, 10];

function breakIntoNotes(amount) {
  let remaining = Math.round(amount);
  const notes = [];
  for (const d of NOTE_DENOMS) {
    while (remaining >= d) {
      notes.push(d);
      remaining -= d;
    }
  }
  return notes;
}

const BLEED_SHAPE = { 500: "diamond", 200: "circle", 100: "square", 50: "triangle", 20: "hex", 10: "diamond" };

function BleedMark({ shape, color, size = 10 }) {
  const s = size;
  if (shape === "circle") return <circle cx={s} cy={s} r={s * 0.7} fill={color} />;
  if (shape === "square") return <rect x={s * 0.3} y={s * 0.3} width={s * 1.4} height={s * 1.4} fill={color} />;
  if (shape === "triangle") return <polygon points={`${s},${s * 0.2} ${s * 1.8},${s * 1.8} ${s * 0.2},${s * 1.8}`} fill={color} />;
  if (shape === "hex") return <polygon points={`${s},0 ${s * 1.9},${s * 0.5} ${s * 1.9},${s * 1.5} ${s},${s * 2} ${s * 0.1},${s * 1.5} ${s * 0.1},${s * 0.5}`} fill={color} />;
  return <polygon points={`${s},0 ${s * 2},${s} ${s},${s * 2} 0,${s}`} fill={color} />; // diamond
}

function NoteGraphic({ value, index, direction }) {
  const style = NOTE_STYLES[value];
  const gid = `guil-${value}`;
  const nid = `noise-${value}`;
  return (
    <div
      style={{
        width: 148, height: 68, position: "relative", flexShrink: 0,
        marginLeft: index === 0 ? 0 : -52,
        zIndex: 20 + index,
        animation: `${direction === "in" ? "noteFlyIn" : "noteFlyOut"} 0.65s ease forwards`,
        animationDelay: `${index * 0.11}s`,
        boxShadow: "3px 4px 10px rgba(0,0,0,0.55)",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      <svg width="148" height="68" viewBox="0 0 148 68" style={{ display: "block" }}>
        <defs>
          <linearGradient id={`bg-${value}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={style.accent} stopOpacity="0.55" />
            <stop offset="45%" stopColor={style.text} stopOpacity="0.06" />
            <stop offset="100%" stopColor={style.accent} stopOpacity="0.75" />
          </linearGradient>
          <pattern id={gid} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(15)">
            <circle cx="4.5" cy="4.5" r="3.4" fill="none" stroke={style.text} strokeOpacity="0.14" strokeWidth="0.5" />
            <circle cx="4.5" cy="4.5" r="1.1" fill={style.text} fillOpacity="0.1" />
          </pattern>
          <filter id={nid}>
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0" />
          </filter>
        </defs>

        {/* base */}
        <rect width="148" height="68" fill={style.mid || style.accent} />
        <rect width="148" height="68" fill={`url(#bg-${value})`} />
        <rect width="148" height="68" fill={`url(#${gid})`} />
        <rect width="148" height="68" filter={`url(#${nid})`} />

        {/* border frame */}
        <rect x="2" y="2" width="144" height="64" fill="none" stroke={style.text} strokeOpacity="0.35" strokeWidth="1" />

        {/* corner bleed marks (tactile-ID inspired, not exact currency marks) */}
        <g opacity="0.85">
          <g transform="translate(6,6)"><BleedMark shape={BLEED_SHAPE[value]} color={style.text} size={5} /></g>
          <g transform="translate(130,50)"><BleedMark shape={BLEED_SHAPE[value]} color={style.text} size={5} /></g>
        </g>

        {/* abstracted pillar mark, original geometry — not traced from currency */}
        <g transform="translate(120,10)" opacity="0.55">
          <rect x="0" y="10" width="14" height="3" fill={style.text} />
          <rect x="4" y="2" width="6" height="9" fill={style.text} />
          <circle cx="7" cy="1.5" r="2.2" fill="none" stroke={style.text} strokeWidth="1" />
        </g>

        {/* watermark-style circle */}
        <circle cx="26" cy="34" r="15" fill="none" stroke={style.text} strokeOpacity="0.3" strokeWidth="1" />
        <text x="26" y="38" fontSize="9" fontWeight="700" fill={style.text} fillOpacity="0.4" textAnchor="middle" fontFamily="'Space Grotesk', sans-serif">₹{value}</text>

        {/* simple original silhouette — bald head, round glasses, shawl outline. Not traced from currency engraving. */}
        <g transform="translate(90,14)" opacity="0.5">
          <path d="M 14 0 C 20 0 24 5 24 11 C 24 15 22 18 19 20 L 19 24 C 26 26 30 31 30 38 L -2 38 C -2 31 2 26 9 24 L 9 20 C 6 18 4 15 4 11 C 4 5 8 0 14 0 Z" fill={style.text} />
          <circle cx="9" cy="12" r="3.4" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.3" />
          <circle cx="19" cy="12" r="3.4" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.3" />
          <line x1="12.4" y1="12" x2="15.6" y2="12" stroke="rgba(255,255,255,0.55)" strokeWidth="1.1" />
        </g>

        {/* denomination */}
        <text x="70" y="30" fontSize="19" fontWeight="700" fill={style.text} fontFamily="'Space Grotesk', sans-serif">₹{value}</text>
        <text x="70" y="42" fontSize="6.5" fontWeight="700" fill={style.text} fillOpacity="0.85" letterSpacing="0.5" fontFamily="'Space Grotesk', sans-serif">GUARANTEED BY MONEY BANK</text>
        <text x="70" y="50" fontSize="6" fontWeight="600" fill={style.text} fillOpacity="0.7" fontFamily="'Space Grotesk', sans-serif">FULL OF HUSTLE</text>

        {/* monument label */}
        <text x="70" y="61" fontSize="5.5" fontWeight="600" fill={style.text} fillOpacity="0.65" letterSpacing="0.3" fontFamily="'Space Grotesk', sans-serif">{style.tagline}</text>
      </svg>
    </div>
  );
}

function NoteFlyOverlay({ anim, onDone }) {
  useEffect(() => {
    if (!anim) return;
    const t = setTimeout(onDone, 2000 + anim.notes.length * 110);
    return () => clearTimeout(t);
  }, [anim]);
  if (!anim) return null;

  return (
    <div style={S.noteOverlay}>
      <div style={{ ...S.noteOverlayMsg, color: anim.direction === "in" ? T.green : T.orange }}>
        {anim.direction === "in" ? "🎉 CONGRATULATIONS!" : "RECOVER IT SOON"}
      </div>
      <div style={{ ...S.noteOverlayLabel, color: anim.direction === "in" ? T.green : T.orange }} className="tnum">
        {anim.direction === "in" ? "+" : "−"}₹{Math.round(anim.amount).toLocaleString("en-IN")}
      </div>
      <div style={S.noteStack}>
        {anim.notes.map((n, i) => (
          <NoteGraphic key={i} value={n} index={i} direction={anim.direction} />
        ))}
      </div>
      {anim.leftover > 0 && (
        <div style={S.noteLeftover} className="tnum">+ ₹{anim.leftover} in coins</div>
      )}
    </div>
  );
}

/* ---------------- Floating calculator + live currency converter ---------------- */

const CURRENCIES = ["USD", "CAD", "GBP", "EUR", "AED", "SGD"];

function LockScreen({ pin, onUnlock }) {
  const [entered, setEntered] = useState("");
  const [error, setError] = useState(false);

  const press = (d) => {
    const next = (entered + d).slice(0, 6);
    setEntered(next);
    setError(false);
    if (next.length === pin.length) {
      if (next === pin) {
        onUnlock();
      } else {
        setError(true);
        setTimeout(() => setEntered(""), 400);
      }
    }
  };

  return (
    <div style={S.lockScreenOverlay}>
      <div style={S.wordmark}>MONEY</div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 6, marginBottom: 24, fontWeight: 700, letterSpacing: "0.05em" }}>ENTER PIN</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 30 }}>
        {Array.from({ length: pin.length }).map((_, i) => (
          <div key={i} style={{ ...S.pinDot, background: i < entered.length ? (error ? T.orange : T.green) : "transparent", borderColor: error ? T.orange : T.line }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, width: 220 }}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d, i) => (
          d === "" ? <div key={i} /> : (
            <button
              key={i}
              style={S.pinKey}
              className="npop-flat"
              onClick={() => (d === "⌫" ? setEntered(entered.slice(0, -1)) : press(d))}
            >
              {d}
            </button>
          )
        ))}
      </div>
    </div>
  );
}

function PinSetupModal({ data, persist, onClose }) {
  const [step, setStep] = useState(data.pinLock.enabled ? "manage" : "create");
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");

  const enable = () => {
    if (pin1.length < 4) return;
    if (pin1 !== pin2) { setPin2(""); return; }
    persist({ ...data, pinLock: { enabled: true, pin: pin1 } });
    onClose();
  };
  const disable = () => {
    persist({ ...data, pinLock: { enabled: false, pin: null } });
    onClose();
  };

  return (
    <div style={S.calcOverlay} onClick={onClose}>
      <div style={S.calcModal} onClick={(e) => e.stopPropagation()}>
        <div style={S.calcHeader}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ivory, display: "flex", alignItems: "center", gap: 6 }}><Lock size={14} /> APP LOCK</div>
          <button style={S.calcCloseBtn} onClick={onClose}><X size={16} color={T.ivory} /></button>
        </div>

        {step === "manage" ? (
          <div style={{ padding: "10px 0" }}>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 14 }}>PIN lock is currently ON.</div>
            <button style={S.submitBtnOrange} className="npop" onClick={disable}>TURN OFF LOCK</button>
          </div>
        ) : (
          <div style={{ padding: "10px 0", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 11, color: T.muted }}>SET A 4-6 DIGIT PIN TO LOCK THE APP</div>
            <input type="password" inputMode="numeric" placeholder="new PIN" value={pin1} onChange={(e) => setPin1(e.target.value.replace(/\D/g, "").slice(0, 6))} style={{ ...S.input, width: "100%" }} className="tnum" />
            <input type="password" inputMode="numeric" placeholder="confirm PIN" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 6))} style={{ ...S.input, width: "100%" }} className="tnum" />
            {pin1 && pin2 && pin1 !== pin2 && <div style={{ fontSize: 10.5, color: T.orange, fontWeight: 700 }}>PINS DON'T MATCH</div>}
            <button style={S.submitBtnGreen} className="npop" onClick={enable} disabled={pin1.length < 4}>ENABLE LOCK</button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatIndianNumber(numStr) {
  if (numStr === null || numStr === undefined || numStr === "") return "";
  const str = String(numStr);
  const neg = str.startsWith("-");
  const clean = str.replace(/-/g, "");
  const [intPartRaw, decPart] = clean.split(".");
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "");
  if (!intPart) return (neg ? "-" : "") + (decPart !== undefined ? "0." + decPart : "0");
  let lastThree = intPart.slice(-3);
  let other = intPart.slice(0, -3);
  if (other !== "") {
    other = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    lastThree = "," + lastThree;
  }
  const formatted = other + lastThree;
  return (neg ? "-" : "") + formatted + (decPart !== undefined ? "." + decPart : "");
}

function AmountInput({ value, onChange, placeholder, style, className, autoFocus, maxWidth }) {
  const handleChange = (e) => {
    const raw = e.target.value.replace(/,/g, "");
    if (raw === "" || /^-?\d*\.?\d*$/.test(raw)) {
      onChange(raw);
    }
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      autoFocus={autoFocus}
      placeholder={placeholder}
      value={formatIndianNumber(value)}
      onChange={handleChange}
      style={maxWidth ? { ...style, maxWidth } : style}
      className={className}
    />
  );
}

// Generic edit modal — used by every ledger (income, expense, accounts, dues, pools)
// so fixing an entry doesn't mean delete-and-recreate it.
function EditEntryModal({ title, fields, values, onChange, onSave, onCancel }) {
  return (
    <div style={S.calcOverlay} onClick={onCancel}>
      <div style={S.calcModal} onClick={(e) => e.stopPropagation()}>
        <div style={S.calcHeader}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ivory }}>{title}</div>
          <button style={S.calcCloseBtn} onClick={onCancel}><X size={16} color={T.ivory} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {fields.map((f) =>
            f.type === "select" ? (
              <select key={f.key} value={values[f.key] ?? ""} onChange={(e) => onChange(f.key, e.target.value)} style={{ ...S.select, width: "100%" }}>
                {f.options.map((o) => {
                  const opt = typeof o === "string" ? { value: o, label: o } : o;
                  return <option key={opt.value} value={opt.value}>{opt.label}</option>;
                })}
              </select>
            ) : f.type === "amount" ? (
              <AmountInput key={f.key} placeholder={f.label} value={values[f.key]} onChange={(v) => onChange(f.key, v)} style={{ ...S.input, width: "100%" }} className="tnum" />
            ) : (
              <input
                key={f.key}
                type={f.type || "text"}
                placeholder={f.label}
                value={values[f.key] ?? ""}
                onChange={(e) => onChange(f.key, e.target.value)}
                style={{ ...S.input, width: "100%" }}
                className={f.type === "date" ? "tnum" : undefined}
              />
            )
          )}
          <button style={S.submitBtnGreen} className="npop" onClick={onSave}>SAVE CHANGES</button>
        </div>
      </div>
    </div>
  );
}

function VoiceLogButton({ data, persist, registerActivity, setToast, triggerNoteAnim }) {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [typedText, setTypedText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [micTried, setMicTried] = useState(false);

  const supported = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

  const parseWithAI = async (text) => {
    setLoading(true);
    setError(null);
    try {
      const prompt = `Parse this spoken money entry into JSON. Text: "${text}"\nReturn ONLY valid JSON, no other text, in this exact shape:\n{"type":"income"|"expense"|"waste","amount":number,"label":"category or source name","note":"short note or empty string"}\nGuess sensible category/source names from context (e.g. "MK Outlet", "Shipping", "Food", "Drinks"). If it sounds like unnecessary/impulsive spending (drinks, smoking, gambling, impulse buy), use type "waste".`;
      const raw = await fetchAIText(prompt);
      const match = raw.match(/\{[\s\S]*\}/);
      const obj = JSON.parse(match ? match[0] : raw);
      setParsed(obj);
    } catch (err) {
      setError("Couldn't parse that — try rewording it.");
    } finally {
      setLoading(false);
    }
  };

  const startListening = () => {
    setError(null);
    setTranscript("");
    setParsed(null);
    setMicTried(true);
    if (!supported) return;
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      rec.lang = "en-IN";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        const text = e.results[0][0].transcript;
        setTranscript(text);
        parseWithAI(text);
      };
      rec.onerror = (e) => {
        setListening(false);
        setError("mic_blocked");
      };
      rec.onend = () => setListening(false);
      rec.start();
      setListening(true);
    } catch (err) {
      setError("mic_blocked");
    }
  };

  const submitTyped = () => {
    if (!typedText.trim()) return;
    parseWithAI(typedText.trim());
  };

  const saveParsed = () => {
    const amt = parseFloat(parsed?.amount);
    if (!amt || amt <= 0) return;
    const today = todayISO();
    if (parsed.type === "income") {
      const fundDelta = {};
      const fundBalances = { ...data.fundBalances };
      data.funds.forEach((f) => {
        const share = Math.round((amt * f.pct) / 100);
        fundDelta[f.id] = share;
        fundBalances[f.id] = (fundBalances[f.id] || 0) + share;
      });
      const entry = { id: Date.now(), amount: amt, source: parsed.label || "Voice Entry", note: parsed.note || "", date: today, fundDelta };
      let next = registerActivity({ ...data, income: [...data.income, entry], fundBalances }, 5);
      persist(next);
      triggerNoteAnim(amt, "in");
    } else {
      const isWaste = parsed.type === "waste";
      const fine = isWaste ? tieredFine(amt) : 0;
      const total = amt + fine;
      const fundDelta = {};
      const fundBalances = { ...data.fundBalances };
      data.funds.forEach((f) => {
        const share = Math.round((total * f.pct) / 100);
        fundDelta[f.id] = -share;
        fundBalances[f.id] = (fundBalances[f.id] || 0) - share;
      });
      const entry = { id: Date.now(), amount: total, category: parsed.label || "Other", note: parsed.note || "", date: today, unnecessary: isWaste, fine, fundDelta };
      let next = registerActivity({ ...data, expenses: [...data.expenses, entry], fundBalances }, 3);
      persist(next);
      triggerNoteAnim(total, "out");
    }
    setToast("⚡ QUICK ENTRY SAVED");
    setTimeout(() => setToast(null), 1600);
    setOpen(false);
    setTranscript("");
    setTypedText("");
    setParsed(null);
  };

  return (
    <>
      <button style={S.voiceFab} onClick={() => setOpen(true)}>
        <Mic size={20} color={T.bg} />
      </button>
      {open && (
        <div style={S.calcOverlay} onClick={() => setOpen(false)}>
          <div style={S.calcModal} onClick={(e) => e.stopPropagation()}>
            <div style={S.calcHeader}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.ivory, display: "flex", alignItems: "center", gap: 6 }}><Mic size={14} /> QUICK LOG</div>
              <button style={S.calcCloseBtn} onClick={() => setOpen(false)}><X size={16} color={T.ivory} /></button>
            </div>

            <div style={{ fontSize: 9.5, color: T.muted, marginBottom: 6 }}>TYPE IT NATURALLY — AI FIGURES OUT THE REST</div>
            <div style={S.formRow}>
              <input
                type="text"
                placeholder='e.g. "500 rupees expense on food"'
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitTyped()}
                style={{ ...S.input, width: "100%" }}
              />
            </div>
            <button style={{ ...S.submitBtnPurple, width: "100%", marginTop: 8 }} className="npop" onClick={submitTyped}>PARSE IT</button>

            {supported && (
              <button style={{ ...S.correctionLink, marginTop: 10, display: "block" }} onClick={startListening} disabled={listening}>
                {listening ? "🎤 LISTENING…" : "🎤 OR TRY SPEAKING INSTEAD"}
              </button>
            )}
            {error === "mic_blocked" && micTried && (
              <div style={{ fontSize: 10.5, color: T.muted, marginTop: 6 }}>Mic isn't accessible in this view — typing works the same way.</div>
            )}

            {transcript && <div style={{ fontSize: 12, color: T.ivory, marginTop: 10, fontStyle: "italic" }}>"{transcript}"</div>}
            {loading && <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }}>Parsing…</div>}
            {error && error !== "mic_blocked" && <div style={{ fontSize: 11, color: T.orange, marginTop: 8, fontWeight: 700 }}>{error}</div>}
            {parsed && (
              <div style={{ ...S.formCard, marginTop: 10 }}>
                <div style={{ fontSize: 10, color: T.muted }}>REVIEW BEFORE SAVING</div>
                <div style={S.formRow}>
                  <select value={parsed.type} onChange={(e) => setParsed({ ...parsed, type: e.target.value })} style={S.select}>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                    <option value="waste">Waste</option>
                  </select>
                  <AmountInput value={String(parsed.amount)} onChange={(v) => setParsed({ ...parsed, amount: v })} style={S.input} className="tnum" />
                </div>
                <input type="text" value={parsed.label || ""} onChange={(e) => setParsed({ ...parsed, label: e.target.value })} style={{ ...S.input, width: "100%" }} placeholder="category/source" />
                <input type="text" value={parsed.note || ""} onChange={(e) => setParsed({ ...parsed, note: e.target.value })} style={{ ...S.input, width: "100%" }} placeholder="note" />
                <button style={S.submitBtnGreen} className="npop" onClick={saveParsed}>SAVE ENTRY</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function FloatingCalcButton({ onClick }) {
  return (
    <button style={S.fabBtn} className="npop" onClick={onClick}>
      <Calculator size={20} color={T.bg} />
    </button>
  );
}

function calcOp(a, b, op) {
  switch (op) {
    case "+": return a + b;
    case "−": return a - b;
    case "×": return a * b;
    case "÷": return b !== 0 ? a / b : 0;
    default: return b;
  }
}

function CalculatorModal({ onClose, data, persist, registerActivity, setToast, triggerNoteAnim }) {
  const [mode, setMode] = useState("calc");
  const [display, setDisplay] = useState("0");
  const [stored, setStored] = useState(null);
  const [operator, setOperator] = useState(null);
  const [waiting, setWaiting] = useState(false);

  const [currency, setCurrency] = useState("USD");
  const [foreignAmount, setForeignAmount] = useState("");
  const [rate, setRate] = useState(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState(null);

  const [logType, setLogType] = useState(null); // null | 'in' | 'out'
  const [logPick, setLogPick] = useState(INCOME_SOURCES[0]);
  const [logNote, setLogNote] = useState("");

  const inputDigit = (d) => {
    if (waiting) { setDisplay(d); setWaiting(false); }
    else setDisplay(display === "0" ? d : display + d);
  };
  const inputDot = () => {
    if (waiting) { setDisplay("0."); setWaiting(false); return; }
    if (!display.includes(".")) setDisplay(display + ".");
  };
  const clearAll = () => { setDisplay("0"); setStored(null); setOperator(null); setWaiting(false); };
  const backspace = () => setDisplay(display.length > 1 ? display.slice(0, -1) : "0");
  const chooseOp = (nextOp) => {
    const cur = parseFloat(display);
    if (stored === null) setStored(cur);
    else if (operator) {
      const result = calcOp(stored, cur, operator);
      setStored(result);
      setDisplay(String(Math.round(result * 100) / 100));
    }
    setWaiting(true);
    setOperator(nextOp);
  };
  const equals = () => {
    if (operator === null || stored === null) return;
    const cur = parseFloat(display);
    const result = calcOp(stored, cur, operator);
    setDisplay(String(Math.round(result * 100) / 100));
    setStored(null);
    setOperator(null);
    setWaiting(true);
  };

  const fetchRate = async () => {
    setRateLoading(true);
    setRateError(null);
    try {
      // Route the lookup through our server-side AI proxy (adds the real API key).
      const response = await fetch("/api/ai-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 200,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: `Search for the current exchange rate: 1 ${currency} to INR (Indian Rupee), right now, today. Reply with ONLY the final numeric rate as a plain number, nothing else — no currency symbols, no words, no explanation. Example valid reply: "83.24"` }],
        }),
      });
      const raw = await response.text();
      let json;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(response.ok ? "unexpected response from AI service" : `API error ${response.status}`);
      }
      if (!response.ok) throw new Error(json?.error?.message || `API error ${response.status}`);
      const textBlocks = (json.content || []).filter((c) => c.type === "text").map((c) => c.text).join(" ");
      const match = textBlocks.match(/(\d+(\.\d+)?)/);
      const inrRate = match ? parseFloat(match[1]) : null;
      if (!inrRate) throw new Error("couldn't parse a rate from the response");
      setRate(inrRate);
    } catch (err) {
      setRateError(`COULDN'T FETCH RATE — ${err?.message || "TRY AGAIN"}`);
    } finally {
      setRateLoading(false);
    }
  };

  const convertedINR = rate && foreignAmount ? parseFloat(foreignAmount) * rate : null;

  const useInCalc = () => {
    if (convertedINR === null) return;
    setDisplay(String(Math.round(convertedINR * 100) / 100));
    setStored(null);
    setOperator(null);
    setWaiting(true);
    setMode("calc");
  };

  const amountToLog = mode === "calc" ? parseFloat(display) : convertedINR;

  const openLog = (type) => {
    if (!amountToLog || amountToLog <= 0) return;
    setLogType(type);
    setLogPick(type === "in" ? INCOME_SOURCES[0] : EXPENSE_CATEGORIES[0]);
    setLogNote("");
  };

  const confirmLog = () => {
    const amt = amountToLog;
    if (!amt || amt <= 0) return;
    const fundDelta = {};
    const fundBalances = { ...data.fundBalances };
    data.funds.forEach((f) => {
      const share = Math.round((amt * f.pct) / 100) * (logType === "in" ? 1 : -1);
      fundDelta[f.id] = share;
      fundBalances[f.id] = (fundBalances[f.id] || 0) + share;
    });
    let next;
    if (logType === "in") {
      const entry = { id: Date.now(), amount: amt, source: logPick, note: logNote.trim(), date: todayISO(), fundDelta };
      next = registerActivity({ ...data, income: [...data.income, entry], fundBalances }, 5);
    } else {
      const entry = { id: Date.now(), amount: amt, category: logPick, note: logNote.trim(), date: todayISO(), unnecessary: false, fine: 0, fundDelta };
      next = registerActivity({ ...data, expenses: [...data.expenses, entry], fundBalances }, 3);
    }
    persist(next);
    triggerNoteAnim(amt, logType);
    setToast(logType === "in" ? "+5 XP · LOGGED FROM CALCULATOR" : "+3 XP · LOGGED FROM CALCULATOR");
    setLogType(null);
    onClose();
  };

  const digits = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "."];

  return (
    <div style={S.calcOverlay} onClick={onClose}>
      <div style={S.calcModal} onClick={(e) => e.stopPropagation()}>
        <div style={S.calcHeader}>
          <div style={S.toggleWrap}>
            <button style={{ ...S.toggleBtn, ...(mode === "calc" ? { background: T.green, color: T.bg } : {}) }} onClick={() => setMode("calc")}>CALC</button>
            <button style={{ ...S.toggleBtn, ...(mode === "currency" ? { background: T.purple, color: T.ivory } : {}) }} onClick={() => setMode("currency")}>CURRENCY → INR</button>
          </div>
          <button style={S.calcCloseBtn} onClick={onClose}><X size={16} color={T.ivory} /></button>
        </div>

        {mode === "calc" ? (
          <>
            <div style={S.calcDisplay} className="tnum">
              {stored !== null && <div style={S.calcSubDisplay}>{stored} {operator}</div>}
              {display}
            </div>
            <div style={S.calcGrid}>
              <button style={S.calcKeyMuted} className="npop-flat" onClick={clearAll}>C</button>
              <button style={S.calcKeyMuted} className="npop-flat" onClick={backspace}><Delete size={16} /></button>
              <button style={S.calcKeyMuted} className="npop-flat" onClick={() => chooseOp("%")}>%</button>
              <button style={S.calcKeyOp} className="npop-flat" onClick={() => chooseOp("÷")}>÷</button>

              {digits.slice(0, 3).map((d) => <button key={d} style={S.calcKey} className="npop-flat" onClick={() => inputDigit(d)}>{d}</button>)}
              <button style={S.calcKeyOp} className="npop-flat" onClick={() => chooseOp("×")}>×</button>

              {digits.slice(3, 6).map((d) => <button key={d} style={S.calcKey} className="npop-flat" onClick={() => inputDigit(d)}>{d}</button>)}
              <button style={S.calcKeyOp} className="npop-flat" onClick={() => chooseOp("−")}>−</button>

              {digits.slice(6, 9).map((d) => <button key={d} style={S.calcKey} className="npop-flat" onClick={() => inputDigit(d)}>{d}</button>)}
              <button style={S.calcKeyOp} className="npop-flat" onClick={() => chooseOp("+")}>+</button>

              <button style={{ ...S.calcKey, gridColumn: "span 2" }} className="npop-flat" onClick={() => inputDigit("0")}>0</button>
              <button style={S.calcKey} className="npop-flat" onClick={inputDot}>.</button>
              <button style={S.calcKeyEquals} className="npop-flat" onClick={equals}>=</button>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={{ ...S.quickBtn, borderColor: T.green, color: T.green }} className="npop" onClick={() => openLog("in")}>LOG AS INCOME</button>
              <button style={{ ...S.quickBtn, borderColor: T.orange, color: T.orange }} className="npop" onClick={() => openLog("out")}>LOG AS EXPENSE</button>
            </div>
          </>
        ) : (
          <div style={{ padding: "16px 4px" }}>
            <div style={S.formRow}>
              <select value={currency} onChange={(e) => { setCurrency(e.target.value); setRate(null); }} style={S.select}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <AmountInput placeholder="amount" value={foreignAmount} onChange={(v) => setForeignAmount(v)} style={S.input} className="tnum" />
            </div>

            {!rate ? (
              <button style={S.submitBtnPurple} className="npop" onClick={fetchRate} disabled={rateLoading} >
                <RefreshCw size={13} /> {rateLoading ? "FETCHING RATE…" : "GET LIVE RATE"}
              </button>
            ) : (
              <div style={{ fontSize: 10.5, color: T.muted, marginTop: 4 }} className="tnum">
                1 {currency} = ₹{rate.toFixed(2)} <button style={S.correctionLink} onClick={fetchRate}>refresh</button>
              </div>
            )}
            {rateError && <div style={{ fontSize: 10.5, color: T.orange, marginTop: 6, fontWeight: 700 }}>{rateError}</div>}

            {convertedINR !== null && (
              <div style={{ ...S.heroCard, boxShadow: `4px 4px 0px ${T.purple}`, marginTop: 14 }}>
                <div style={S.heroLabel}>CONVERTED TO INR</div>
                <div style={{ ...S.heroNum, color: T.purple }} className="tnum">{fmt(convertedINR)}</div>
                <button style={{ ...S.submitBtnGreen, marginTop: 10 }} className="npop" onClick={useInCalc}>USE IN CALCULATOR</button>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button style={{ ...S.quickBtn, borderColor: T.green, color: T.green }} className="npop" onClick={() => openLog("in")}>LOG AS INCOME</button>
                  <button style={{ ...S.quickBtn, borderColor: T.orange, color: T.orange }} className="npop" onClick={() => openLog("out")}>LOG AS EXPENSE</button>
                </div>
              </div>
            )}
          </div>
        )}

        {logType && (
          <div style={S.formCard}>
            <div style={{ fontSize: 11, color: T.muted, fontWeight: 700 }} className="tnum">
              {logType === "in" ? "LOGGING INCOME" : "LOGGING EXPENSE"}: {fmt(amountToLog)}
            </div>
            <select value={logPick} onChange={(e) => setLogPick(e.target.value)} style={S.select}>
              {(logType === "in" ? INCOME_SOURCES : EXPENSE_CATEGORIES).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="text" placeholder="note (optional)" value={logNote} onChange={(e) => setLogNote(e.target.value)} style={{ ...S.input, width: "100%" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...S.addBtn, flex: 1, justifyContent: "center" }} className="npop" onClick={() => setLogType(null)}>CANCEL</button>
              <button style={{ ...(logType === "in" ? S.submitBtnGreen : S.submitBtnOrange), flex: 1 }} className="npop" onClick={confirmLog}>CONFIRM</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const DEFAULT_FUNDS = [
  { id: "travel", name: "Travel Funds", pct: 28, color: "#E5FE40" },
  { id: "shopping", name: "Personal Shopping", pct: 15, color: "#FF5C35" },
  { id: "lala", name: "Lala Fund", pct: 2, color: "#6A35FF" },
  { id: "house", name: "Future House & Savings", pct: 15, color: "#35C9FF" },
  { id: "business", name: "Business", pct: 40, color: "#FF35A8" },
];

const emptyData = () => ({
  income: [],
  expenses: [],
  funds: DEFAULT_FUNDS,
  fundBalances: Object.fromEntries(DEFAULT_FUNDS.map((f) => [f.id, 0])),
  auditedMonths: [],
  goals: [],
  receivables: [],
  payables: [],
  investments: [],
  xp: 0,
  streak: { count: 0, lastActiveDate: null },
  profitTargets: { daily: 10000, weekly: 70000, monthly: 300000 },
  profitLevel: 1,
  profitStreaks: { daily: 0, lastDailyCheck: null, weekly: 0, lastWeeklyCheck: null, monthly: 0, lastMonthlyCheck: null },
  openingBalance: 0,
  accounts: {
    cash: { startingBalance: 0, entries: [] },
    bank: { startingBalance: 0, entries: [] },
    forex: { startingBalance: 0, entries: [] },
  },
  expensePools: [],
  trophies: [],
  budgets: [],
  fixedExpenses: [],
  dailyTip: { date: null, text: null },
  sinkingFunds: [],
  brokerConfig: { kiteApiKey: "", motilalLoginUrl: "" },
  lastFreshStart: null,
  whyReasons: [],
  visionItems: [],
  identityStatement: "",
  ifThenPlan: "",
  northStar: "",
  pinLock: { enabled: false, pin: null },
});

export default function Khata() {
  useFonts();
  const [data, setData] = useState(null);
  const dataRef = useRef(null);
  const lastUpdatedAtRef = useRef(null); // version token for optimistic-concurrency saves
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("overview");
  const [toast, setToast] = useState(null);
  const [noteAnim, setNoteAnim] = useState(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [lockSetupOpen, setLockSetupOpen] = useState(false);
  const [conflictNotice, setConflictNotice] = useState(null);
  const conflictNoticeTokenRef = useRef(0); // guards against an unrelated toast's timeout clearing this one early

  const triggerNoteAnim = useCallback((amount, direction) => {
    const notes = breakIntoNotes(amount);
    const leftover = Math.round(amount) - notes.reduce((s, n) => s + n, 0);
    setNoteAnim({ amount, direction, notes, leftover, key: Date.now() });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const remote = await loadFromSupabase();
        const loaded = remote.data || emptyData();
        loaded.goals = loaded.goals || [];
        loaded.receivables = loaded.receivables || [];
        loaded.payables = loaded.payables || [];
        loaded.xp = loaded.xp || 0;
        loaded.streak = loaded.streak || { count: 0, lastActiveDate: null };
        loaded.auditedMonths = loaded.auditedMonths || [];
        loaded.profitTargets = loaded.profitTargets || { daily: 10000, weekly: 70000, monthly: 300000 };
        loaded.investments = loaded.investments || [];
        loaded.openingBalance = loaded.openingBalance || 0;
        loaded.accounts = loaded.accounts || { cash: { startingBalance: 0, entries: [] }, bank: { startingBalance: 0, entries: [] }, forex: { startingBalance: 0, entries: [] } };
        ["cash", "bank", "forex"].forEach((k) => {
          if (!loaded.accounts[k]) loaded.accounts[k] = { startingBalance: 0, entries: [] };
          loaded.accounts[k].entries = loaded.accounts[k].entries || [];
        });
        loaded.expensePools = loaded.expensePools || [];
        loaded.profitLevel = loaded.profitLevel || 1;
        loaded.profitStreaks = loaded.profitStreaks || { daily: 0, lastDailyCheck: null, weekly: 0, lastWeeklyCheck: null, monthly: 0, lastMonthlyCheck: null };
        loaded.trophies = loaded.trophies || [];
        loaded.budgets = loaded.budgets || [];
        loaded.fixedExpenses = loaded.fixedExpenses || [];
        loaded.dailyTip = loaded.dailyTip || { date: null, text: null };
        loaded.sinkingFunds = loaded.sinkingFunds || [];
        loaded.brokerConfig = loaded.brokerConfig || { kiteApiKey: "", motilalLoginUrl: "" };
        loaded.lastFreshStart = loaded.lastFreshStart || null;
        loaded.whyReasons = loaded.whyReasons || [];
        loaded.visionItems = loaded.visionItems || [];
        loaded.identityStatement = loaded.identityStatement || "";
        loaded.ifThenPlan = loaded.ifThenPlan || "";
        loaded.northStar = loaded.northStar || "";
        loaded.pinLock = loaded.pinLock || { enabled: false, pin: null };
        dataRef.current = loaded;
        lastUpdatedAtRef.current = remote.updatedAt;
        setData(loaded);
      } catch {
        const empty = emptyData();
        dataRef.current = empty;
        lastUpdatedAtRef.current = null;
        setData(empty);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = useCallback(async (next) => {
    dataRef.current = next;
    setData(next);
    setSaving(true);
    try {
      const result = await saveToSupabase(next, lastUpdatedAtRef.current);
      if (result.ok) {
        lastUpdatedAtRef.current = result.updatedAt;
        return;
      }
      // Someone else (the Telegram/WhatsApp bot, or another tab) saved in between reads —
      // don't silently overwrite their write. Pull the latest version down instead and
      // let the user redo their change against it.
      const fresh = await loadFromSupabase();
      const freshData = fresh.data || dataRef.current;
      dataRef.current = freshData;
      lastUpdatedAtRef.current = fresh.updatedAt;
      setData(freshData);
      // uses its own state (not the shared `toast`) so an unrelated action's toast-clear
      // timeout — e.g. the "+5 XP" toast the same button press already queued — can't wipe this early
      const token = ++conflictNoticeTokenRef.current;
      setConflictNotice("DATA CHANGED ELSEWHERE — REFRESHED TO LATEST. PLEASE REDO YOUR LAST CHANGE.");
      setTimeout(() => { if (conflictNoticeTokenRef.current === token) setConflictNotice(null); }, 5000);
    } finally {
      setSaving(false);
    }
  }, []);

  const registerActivity = useCallback((base, xpGain) => {
    const today = todayISO();
    let streak = { ...base.streak };
    if (streak.lastActiveDate !== today) {
      const wasYesterday = streak.lastActiveDate ? daysBetween(streak.lastActiveDate, today) === 1 : false;
      streak.count = wasYesterday ? streak.count + 1 : 1;
      streak.lastActiveDate = today;
    }
    return { ...base, xp: (base.xp || 0) + xpGain, streak };
  }, []);

  useEffect(() => {
    if (!data) return;
    const d = dataRef.current;
    const cur = currentMonthKey();
    const months = new Set([...d.income.map((e) => monthKey(e.date)), ...d.expenses.map((e) => monthKey(e.date))]);
    const auditedSet = new Set(d.auditedMonths.map((a) => a.month));
    const toAudit = [...months].filter((m) => m < cur && !auditedSet.has(m)).sort();
    if (toAudit.length === 0) return;

    const newAudits = [];
    for (const m of toAudit) {
      const incEntries = d.income.filter((e) => monthKey(e.date) === m);
      const expEntries = d.expenses.filter((e) => monthKey(e.date) === m);
      const netProfit = incEntries.reduce((s, e) => s + e.amount, 0) - expEntries.reduce((s, e) => s + e.amount, 0);
      const allocated = {};
      d.funds.forEach((f) => {
        const incSum = incEntries.reduce((s, e) => s + (e.fundDelta?.[f.id] || 0), 0);
        const expSum = expEntries.reduce((s, e) => s + (e.fundDelta?.[f.id] || 0), 0);
        allocated[f.id] = incSum + expSum;
      });
      newAudits.push({ month: m, netProfit, allocated, corrections: {} });
    }
    persist({ ...dataRef.current, auditedMonths: [...dataRef.current.auditedMonths, ...newAudits] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // profit-level streak evaluation — checks completed day/week/month against targets,
  // levels up (and raises targets 50%) once 10 daily + 5 weekly + 3 monthly streaks align
  useEffect(() => {
    if (!data) return;
    const d = dataRef.current;
    const today = todayISO();
    const ps = { ...d.profitStreaks };
    let changed = false;

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (ps.lastDailyCheck !== yesterday) {
      const yInc = d.income.filter((e) => e.date === yesterday).reduce((s, e) => s + e.amount, 0);
      const yExp = d.expenses.filter((e) => e.date === yesterday).reduce((s, e) => s + e.amount, 0);
      const wasConsecutive = ps.lastDailyCheck && daysBetween(ps.lastDailyCheck, yesterday) === 1;
      ps.daily = (yInc - yExp) >= d.profitTargets.daily ? (wasConsecutive ? ps.daily + 1 : 1) : 0;
      ps.lastDailyCheck = yesterday;
      changed = true;
    }

    const thisMonday = mondayOf(today);
    if (ps.lastWeeklyCheck !== thisMonday) {
      if (ps.lastWeeklyCheck) {
        const weekEnd = new Date(new Date(ps.lastWeeklyCheck + "T00:00:00").getTime() + 6 * 86400000).toISOString().slice(0, 10);
        const wInc = d.income.filter((e) => e.date >= ps.lastWeeklyCheck && e.date <= weekEnd).reduce((s, e) => s + e.amount, 0);
        const wExp = d.expenses.filter((e) => e.date >= ps.lastWeeklyCheck && e.date <= weekEnd).reduce((s, e) => s + e.amount, 0);
        ps.weekly = (wInc - wExp) >= d.profitTargets.weekly ? ps.weekly + 1 : 0;
      }
      ps.lastWeeklyCheck = thisMonday;
      changed = true;
    }

    const curMonth = currentMonthKey();
    if (ps.lastMonthlyCheck !== curMonth) {
      if (ps.lastMonthlyCheck) {
        const mInc = d.income.filter((e) => monthKey(e.date) === ps.lastMonthlyCheck).reduce((s, e) => s + e.amount, 0);
        const mExp = d.expenses.filter((e) => monthKey(e.date) === ps.lastMonthlyCheck).reduce((s, e) => s + e.amount, 0);
        ps.monthly = (mInc - mExp) >= d.profitTargets.monthly ? ps.monthly + 1 : 0;
      }
      ps.lastMonthlyCheck = curMonth;
      changed = true;
    }

    if (!changed) return;

    let profitLevel = d.profitLevel;
    let profitTargets = d.profitTargets;
    let leveledUp = false;
    if (ps.daily >= 10 && ps.weekly >= 5 && ps.monthly >= 3) {
      profitLevel = profitLevel + 1;
      profitTargets = {
        daily: Math.round(d.profitTargets.daily * 1.5),
        weekly: Math.round(d.profitTargets.weekly * 1.5),
        monthly: Math.round(d.profitTargets.monthly * 1.5),
      };
      ps.daily = 0;
      ps.weekly = 0;
      ps.monthly = 0;
      leveledUp = true;
    }

    persist({ ...dataRef.current, profitStreaks: ps, profitLevel, profitTargets });
    if (leveledUp) {
      setToast(`🎉 PROFIT LEVEL ${profitLevel} — TARGETS UP 50%`);
      setTimeout(() => setToast(null), 3000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // trophy evaluation — checks all trophy conditions against the latest state and awards new ones
  useEffect(() => {
    if (!data) return;
    const d = dataRef.current;
    const earnedIds = new Set(d.trophies.map((t) => t.id));
    const newlyEarned = TROPHY_DEFS.filter((t) => !earnedIds.has(t.id) && t.check(d));
    if (newlyEarned.length === 0) return;
    const trophies = [...d.trophies, ...newlyEarned.map((t) => ({ id: t.id, earnedDate: todayISO() }))];
    persist({ ...dataRef.current, trophies });
    setToast(`🏆 TROPHY UNLOCKED: ${newlyEarned[0].name}${newlyEarned.length > 1 ? ` +${newlyEarned.length - 1} more` : ""}`);
    setTimeout(() => setToast(null), 3000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // fresh-start nudge — motivational push on Mondays and the 1st of the month, once per day
  useEffect(() => {
    if (!data || loading) return;
    const today = todayISO();
    if (data.lastFreshStart === today) return;
    const now = new Date();
    const isMonday = now.getDay() === 1;
    const isFirstOfMonth = now.getDate() === 1;
    if (!isMonday && !isFirstOfMonth) return;
    persist({ ...dataRef.current, lastFreshStart: today });
    const msg = isFirstOfMonth ? "🌅 NEW MONTH. NEW NUMBERS. LET'S GO." : "🌅 NEW WEEK. FRESH START. LET'S GO.";
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading]);

  if (loading || !data) {
    return (
      <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 className="animate-spin" color={T.green} size={22} />
      </div>
    );
  }

  if (data.pinLock.enabled && !unlocked) {
    return <LockScreen pin={data.pinLock.pin} onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <div style={S.app}>
      <style>{`
        * { box-sizing: border-box; }
        input, select { font-family: 'Space Grotesk', sans-serif; }
        input::placeholder { color: ${T.muted}; }
        .tnum { font-variant-numeric: tabular-nums; }
        button { cursor: pointer; font-family: 'Space Grotesk', sans-serif; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: ${T.line}; }

        .npop {
          transition: transform 0.08s ease, box-shadow 0.08s ease;
        }
        .npop:active {
          transform: translate(3px, 3px);
          box-shadow: 1px 1px 0px #000 !important;
        }
        .npop-flat:active {
          transform: translate(2px, 2px);
          box-shadow: none !important;
        }

        @keyframes noteFlyIn {
          0% { transform: translateY(140px) scale(0.6) rotate(-10deg); opacity: 0; }
          55% { transform: translateY(-14px) scale(1.06) rotate(2deg); opacity: 1; }
          100% { transform: translateY(0) scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes noteFlyOut {
          0% { transform: translateY(0) scale(1) rotate(0deg); opacity: 1; }
          35% { transform: translateY(-12px) scale(1.05) rotate(-2deg); opacity: 1; }
          100% { transform: translateY(-170px) scale(0.55) rotate(12deg); opacity: 0; }
        }
        @keyframes overlayFade {
          0% { opacity: 0; }
          10% { opacity: 1; }
          85% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes overlayMsgPulse {
          0% { transform: scale(0.7); opacity: 0; }
          60% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      <TopBar saving={saving} xp={data.xp} streak={data.streak.count} nextCountryGoal={nextTravelGoal(data)} onOpenLockSetup={() => setLockSetupOpen(true)} />
      <div style={S.body}>
        {tab === "overview" && <OverviewTab data={data} persist={persist} registerActivity={registerActivity} setToast={setToast} triggerNoteAnim={triggerNoteAnim} />}
        {tab === "income" && <IncomeTab data={data} persist={persist} registerActivity={registerActivity} setToast={setToast} triggerNoteAnim={triggerNoteAnim} />}
        {tab === "expense" && <ExpenseTab data={data} persist={persist} registerActivity={registerActivity} setToast={setToast} triggerNoteAnim={triggerNoteAnim} />}
        {tab === "funds" && <FundsTab data={data} persist={persist} />}
        {tab === "goals" && <GoalsTab data={data} persist={persist} />}
        {tab === "dues" && <DuesTab data={data} persist={persist} />}
        {tab === "accounts" && <AccountsTab data={data} persist={persist} />}
        {tab === "pool" && <ExpensePoolTab data={data} persist={persist} registerActivity={registerActivity} setToast={setToast} triggerNoteAnim={triggerNoteAnim} />}
        {tab === "analytics" && <AnalyticsTab data={data} persist={persist} />}
        {tab === "hustle" && <HustleTab data={data} persist={persist} />}
      </div>

      <BottomNav tab={tab} setTab={setTab} />
      <NoteFlyOverlay anim={noteAnim} onDone={() => setNoteAnim(null)} />
      <FloatingCalcButton onClick={() => setCalcOpen(true)} />

      <VoiceLogButton data={data} persist={persist} registerActivity={registerActivity} setToast={setToast} triggerNoteAnim={triggerNoteAnim} />
      {calcOpen && (
        <CalculatorModal
          onClose={() => setCalcOpen(false)}
          data={data}
          persist={persist}
          registerActivity={registerActivity}
          setToast={setToast}
          triggerNoteAnim={triggerNoteAnim}
        />
      )}
      {lockSetupOpen && <PinSetupModal data={data} persist={persist} onClose={() => setLockSetupOpen(false)} />}
      {toast && <div style={S.toast}>{toast}</div>}
      {conflictNotice && <div style={S.conflictToast}>{conflictNotice}</div>}
    </div>
  );
}

function useLiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function GoalTimeline({ targetDate, remaining, netProfitNeeded, salesNeeded }) {
  const now = useLiveClock();
  const target = new Date(targetDate + "T23:59:59");
  const diffMs = target - now;
  const isPast = diffMs <= 0;
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const daysForMath = Math.max(1, days + (hours > 0 || minutes > 0 ? 1 : 0));

  const salesPerDay = remaining > 0 ? salesNeeded / daysForMath : 0;
  const profitPerDay = remaining > 0 ? netProfitNeeded / daysForMath : 0;

  return (
    <div style={S.timelineBox}>
      <div style={S.expandLabel}>TIMELINE</div>
      {isPast ? (
        <div style={{ fontSize: 12, color: T.orange, fontWeight: 700 }}>TARGET DATE HAS PASSED</div>
      ) : (
        <>
          <div style={S.countdownRow} className="tnum">
            <div style={S.countdownUnit}><span style={S.countdownNum}>{days}</span><span style={S.countdownLabel}>DAYS</span></div>
            <div style={S.countdownUnit}><span style={S.countdownNum}>{String(hours).padStart(2, "0")}</span><span style={S.countdownLabel}>HRS</span></div>
            <div style={S.countdownUnit}><span style={S.countdownNum}>{String(minutes).padStart(2, "0")}</span><span style={S.countdownLabel}>MIN</span></div>
            <div style={S.countdownUnit}><span style={S.countdownNum}>{String(seconds).padStart(2, "0")}</span><span style={S.countdownLabel}>SEC</span></div>
          </div>
          {remaining > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 10 }} className="tnum">
              <span style={{ fontSize: 11, color: T.ivory }}>PER DAY — SALES NEEDED: <b style={{ color: T.purple }}>{fmt(salesPerDay)}</b></span>
              <span style={{ fontSize: 11, color: T.ivory }}>PER DAY — PROFIT NEEDED: <b style={{ color: T.green }}>{fmt(profitPerDay)}</b></span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TopBar({ saving, xp, streak, nextCountryGoal, onOpenLockSetup }) {
  const level = Math.floor(xp / 100) + 1;
  const now = useLiveClock();
  const dayName = now.toLocaleDateString("en-IN", { weekday: "long" });
  const dayNum = WEEKDAY_NUMBER[dayName];
  const dateStr = now.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" }).toUpperCase();
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).toUpperCase();
  return (
    <div style={S.topBar}>
      <div>
        <div style={S.wordmark}>MONEY</div>
        <div style={S.clockRow} className="tnum">{dateStr} · DAY {dayNum}/7 · {timeStr}</div>
        {nextCountryGoal && (
          <div style={S.nextCountryRow}>
            <span style={{ fontSize: 14 }}>{countryFlag(nextCountryGoal.country)}</span>
            <span>NEXT: {nextCountryGoal.name.toUpperCase()}</span>
          </div>
        )}
        <div style={{ ...S.saveDot, opacity: saving ? 1 : 0 }}>SAVING…</div>
      </div>
      <div style={S.headerStats}>
        <button style={S.lockIconBtn} onClick={onOpenLockSetup}><Lock size={13} color={T.muted} /></button>
        <span style={S.statChip}><Award size={11} color={T.green} /> LV.{level}</span>
        <span style={S.statChip}><Flame size={11} color={T.orange} /> {streak}</span>
      </div>
    </div>
  );
}

function BottomNav({ tab, setTab }) {
  const items = [
    { id: "overview", label: "Home", icon: Home },
    { id: "income", label: "Income", icon: ArrowUpCircle },
    { id: "expense", label: "Expense", icon: ArrowDownCircle },
    { id: "funds", label: "Funds", icon: Wallet },
    { id: "goals", label: "Goals", icon: Target },
    { id: "dues", label: "Dues", icon: ListChecks },
    { id: "accounts", label: "Accounts", icon: Landmark },
    { id: "pool", label: "Pool", icon: Layers },
    { id: "analytics", label: "Stats", icon: BarChart3 },
    { id: "hustle", label: "Hustle", icon: Zap },
  ];
  return (
    <div style={S.bottomNav}>
      {items.map((it) => {
        const Icon = it.icon;
        const active = tab === it.id;
        return (
          <button key={it.id} onClick={() => setTab(it.id)} style={S.navBtn} className="npop-flat">
            <div style={{ ...S.navIconWrap, ...(active ? { background: T.green, boxShadow: `2px 2px 0px #000` } : {}) }}>
              <Icon size={16} color={active ? T.bg : T.muted} strokeWidth={2.4} />
            </div>
            <span style={{ ...S.navLabel, color: active ? T.ivory : T.muted }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Overview ---------------- */

function OverviewTab({ data, persist, registerActivity, setToast, triggerNoteAnim }) {
  const today = todayISO();
  const todayIncome = data.income.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
  const todayExpense = data.expenses.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0);
  const todayProfit = todayIncome - todayExpense;

  const weekStart = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const weekIncome = data.income.filter((e) => e.date >= weekStart && e.date <= today).reduce((s, e) => s + e.amount, 0);
  const weekExpense = data.expenses.filter((e) => e.date >= weekStart && e.date <= today).reduce((s, e) => s + e.amount, 0);
  const weekProfit = weekIncome - weekExpense;

  const monthProfit =
    data.income.filter((e) => monthKey(e.date) === currentMonthKey()).reduce((s, e) => s + e.amount, 0) -
    data.expenses.filter((e) => monthKey(e.date) === currentMonthKey()).reduce((s, e) => s + e.amount, 0);

  const cashBalance = data.income.reduce((s, e) => s + e.amount, 0) - data.expenses.reduce((s, e) => s + e.amount, 0);
  const totalInvested = data.investments.reduce((s, i) => s + i.amount, 0);
  const totalReceivable = data.receivables.filter((r) => r.status !== "received").reduce((s, r) => s + r.amount, 0);
  const totalPayable = data.payables.filter((p) => p.status !== "paid").reduce((s, p) => s + p.amount, 0);
  const netWorth = data.openingBalance + cashBalance + totalInvested + totalReceivable - totalPayable;

  const activeGoals = data.goals.filter((g) => (data.fundBalances[g.fundId] || 0) < g.target);
  const travelGoal = data.goals.filter((g) => g.fundId === "travel").sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0))[0];
  const shoppingGoal = data.goals.filter((g) => g.fundId === "shopping").sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0))[0];
  const featuredIds = new Set([travelGoal?.id, shoppingGoal?.id].filter(Boolean));
  const targetedGoals = activeGoals.filter((g) => g.targetDate && !featuredIds.has(g.id));
  const otherGoals = activeGoals.filter((g) => !featuredIds.has(g.id));

  return (
    <div>
      <SmsImportBanner data={data} persist={persist} registerActivity={registerActivity} setToast={setToast} triggerNoteAnim={triggerNoteAnim} />

      <RuthlessPushBanner data={data} />

      <LittleJeetCard data={data} />

      <MoneyQuoteBanner />

      <MoodRing data={data} />

      <TodayProfitHero data={data} todayProfit={todayProfit} todayIncome={todayIncome} todayExpense={todayExpense} today={today} />

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <HealthScoreCard data={data} />
        <HeatMeter data={data} />
      </div>

      <BossBattle data={data} />

      <DailyTip data={data} persist={persist} />

      <AICouncil data={data} />

      <LuxellaPanel />

      <QuickActionsBar data={data} persist={persist} registerActivity={registerActivity} setToast={setToast} triggerNoteAnim={triggerNoteAnim} />

      <WhyBanner data={data} persist={persist} />

      <ProfitTargetsSection data={data} persist={persist} todayProfit={todayProfit} weekProfit={weekProfit} monthProfit={monthProfit} />

      <ReceivablesSummary data={data} totalReceivable={totalReceivable} />

      <BrokerHoldingsSection data={data} persist={persist} />

      <InvestmentsSection data={data} persist={persist} totalInvested={totalInvested} />

      <SinkingFundsSection data={data} persist={persist} registerActivity={registerActivity} setToast={setToast} triggerNoteAnim={triggerNoteAnim} />

      <SectionLabel text="DREAM GOALS" />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <DreamGoalCard data={data} persist={persist} goal={travelGoal} fundId="travel" label="TRAVEL" />
        <DreamGoalCard data={data} persist={persist} goal={shoppingGoal} fundId="shopping" label="SHOPPING" />
      </div>

      {targetedGoals.length > 0 && (
        <>
          <SectionLabel text="TODAY'S TARGETS" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {targetedGoals.map((g) => {
              const fund = data.funds.find((f) => f.id === g.fundId);
              const bal = data.fundBalances[g.fundId] || 0;
              const remaining = Math.max(0, g.target - bal);
              const daysLeft = daysBetween(today, g.targetDate);
              const daily = remaining / daysLeft;
              return (
                <div key={g.id} style={{ ...S.miniGoalCard, boxShadow: `2px 2px 0px ${fund?.color}` }}>
                  <div style={S.miniGoalTop}>
                    <span style={S.miniGoalName}>{g.name.toUpperCase()}</span>
                    <Target size={13} color={fund?.color} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: fund?.color, marginTop: 6 }} className="tnum">
                    TODAY'S NUMBER: {fmt(daily)}
                  </div>
                  <div style={{ fontSize: 10.5, color: T.muted, marginTop: 4 }} className="tnum">{fmt(remaining)} LEFT · {daysLeft} DAYS TO GO</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <SectionLabel text="QUICK STATS" />
      <div style={S.statGrid}>
        <div style={S.statBox}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={S.statBoxLabel}>THIS WEEK IN</div>
            <WoWBadge pct={weekOverWeek(data, "income").pct} />
          </div>
          <div style={{ ...S.statBoxNum, color: T.green }} className="tnum">{fmt(weekOverWeek(data, "income").cur)}</div>
        </div>
        <div style={S.statBox}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={S.statBoxLabel}>THIS WEEK OUT</div>
            <WoWBadge pct={weekOverWeek(data, "expense").pct} invert />
          </div>
          <div style={{ ...S.statBoxNum, color: T.orange }} className="tnum">{fmt(weekOverWeek(data, "expense").cur)}</div>
        </div>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>FUND TOTAL</div>
          <div style={{ ...S.statBoxNum, color: T.purple }} className="tnum">
            {fmt(Object.values(data.fundBalances).reduce((s, v) => s + v, 0))}
          </div>
        </div>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>ACTIVE GOALS</div>
          <div style={{ ...S.statBoxNum, color: T.blue }} className="tnum">{activeGoals.length}</div>
        </div>
      </div>

      {otherGoals.length > 0 && (
        <>
          <SectionLabel text="OTHER GOALS IN MOTION" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {otherGoals.slice(0, 4).map((g) => (
              <MiniGoalCard key={g.id} data={g} fund={data.funds.find((f) => f.id === g.fundId)} fundBal={data.fundBalances[g.fundId] || 0} appData={data} />
            ))}
          </div>
        </>
      )}

      <AIReportsButton data={data} />

      <TrophyCase data={data} />

      <PermanentQuoteCard />

      <NetWorthFooter
        data={data}
        persist={persist}
        netWorth={netWorth}
        cashBalance={cashBalance}
        totalInvested={totalInvested}
        totalReceivable={totalReceivable}
        totalPayable={totalPayable}
      />
    </div>
  );
}

function NetWorthFooter({ data, persist, netWorth, cashBalance, totalInvested, totalReceivable, totalPayable }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.openingBalance);

  const save = () => {
    persist({ ...data, openingBalance: parseFloat(draft) || 0 });
    setEditing(false);
  };

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const coreAsOf = (dateStr) => {
    const inc = data.income.filter((e) => e.date <= dateStr).reduce((s, e) => s + e.amount, 0);
    const exp = data.expenses.filter((e) => e.date <= dateStr).reduce((s, e) => s + e.amount, 0);
    const inv = data.investments.filter((i) => i.date <= dateStr).reduce((s, i) => s + i.amount, 0);
    return data.openingBalance + (inc - exp) + inv;
  };
  const coreNow = coreAsOf(todayISO());
  const coreWeekAgo = coreAsOf(weekAgo);
  const nwPct = coreWeekAgo !== 0 ? Math.round(((coreNow - coreWeekAgo) / Math.abs(coreWeekAgo)) * 1000) / 10 : (coreNow !== 0 ? 100 : null);

  return (
    <div style={{ ...S.statBox, boxShadow: `3px 3px 0px ${netWorth >= 0 ? (T.gold || T.green) : T.orange}`, cursor: "pointer", marginTop: 14 }} className="npop-flat" onClick={() => setOpen((s) => !s)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={S.statBoxLabel}>NET WORTH</span>
        <WoWBadge pct={nwPct} />
      </div>
      <div style={{ ...S.statBoxNum, color: netWorth >= 0 ? T.ivory : T.orange, fontSize: 24, marginTop: 4 }} className="tnum">{fmtSigned(netWorth)}</div>

      {open && (
        <div style={{ ...S.expandPanel, opacity: 1 }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }} className="tnum">
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: T.muted }}>OPENING BALANCE (BEFORE THIS APP)</span><span style={{ color: T.ivory }}>{fmt(data.openingBalance)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: T.muted }}>CASH (LOGGED IN APP)</span><span style={{ color: T.ivory }}>{fmt(cashBalance)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: T.muted }}>INVESTED</span><span style={{ color: T.ivory }}>{fmt(totalInvested)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: T.muted }}>RECEIVABLE</span><span style={{ color: T.green }}>+{fmt(totalReceivable)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: T.muted }}>PAYABLE</span><span style={{ color: T.orange }}>−{fmt(totalPayable)}</span></div>
          </div>

          {editing ? (
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <AmountInput autoFocus placeholder="opening balance" value={draft} onChange={(v) => setDraft(v)} style={{ ...S.input, fontSize: 12 }} className="tnum" />
              <button style={{ ...S.smallToggle, padding: "0 10px" }} onClick={save}><Check size={13} color={T.green} /></button>
            </div>
          ) : (
            <button style={{ ...S.correctionLink, marginTop: 10, display: "block" }} onClick={() => { setDraft(data.openingBalance); setEditing(true); }}>
              SET OPENING BALANCE — WHAT YOU HAD BEFORE STARTING
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ReceivablesSummary({ data, totalReceivable }) {
  const pending = data.receivables.filter((r) => r.status !== "received").sort((a, b) => (a.dueDate || "9999") > (b.dueDate || "9999") ? 1 : -1);
  return (
    <>
      <SectionLabel text="RECEIVABLES" />
      <div style={{ ...S.statBox, boxShadow: `3px 3px 0px ${T.green}`, marginBottom: 10 }}>
        <div style={S.statBoxLabel}>TOTAL PENDING</div>
        <div style={{ ...S.statBoxNum, color: T.green }} className="tnum">{fmt(totalReceivable)}</div>
      </div>
      {pending.length === 0 ? (
        <EmptyNote text="nothing pending — add receivables from the Dues tab" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pending.slice(0, 3).map((r) => (
            <div key={r.id} style={S.miniGoalCard}>
              <div style={S.miniGoalTop}>
                <span style={S.miniGoalName}>{r.party.toUpperCase()}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.green }} className="tnum">{fmt(r.amount)}</span>
              </div>
              {r.dueDate && <div style={{ fontSize: 10.5, color: T.muted, marginTop: 4 }}>DUE {fmtDate(r.dueDate)}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function SinkingFundsSection({ data, persist, registerActivity, setToast, triggerNoteAnim }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", target: "" });
  const [contributing, setContributing] = useState(null);
  const [contribAmt, setContribAmt] = useState("");

  const addFund = () => {
    const t = parseFloat(form.target);
    if (!form.name.trim() || !t || t <= 0) return;
    persist({ ...data, sinkingFunds: [...data.sinkingFunds, { id: Date.now(), name: form.name.trim(), target: t, saved: 0 }] });
    setForm({ name: "", target: "" });
    setShowForm(false);
  };
  const removeFund = (id) => persist({ ...data, sinkingFunds: data.sinkingFunds.filter((f) => f.id !== id) });

  const contribute = (fund) => {
    const amt = parseFloat(contribAmt);
    if (!amt || amt <= 0) return;
    const fundDelta = {};
    const fundBalances = { ...data.fundBalances };
    data.funds.forEach((f) => {
      const share = Math.round((amt * f.pct) / 100);
      fundDelta[f.id] = -share;
      fundBalances[f.id] = (fundBalances[f.id] || 0) - share;
    });
    const entry = { id: Date.now(), amount: amt, category: `Sinking Fund: ${fund.name}`, note: "", date: todayISO(), unnecessary: false, fine: 0, fundDelta };
    let next = { ...data, expenses: [...data.expenses, entry], fundBalances, sinkingFunds: data.sinkingFunds.map((f) => (f.id === fund.id ? { ...f, saved: f.saved + amt } : f)) };
    next = registerActivity(next, 3);
    persist(next);
    triggerNoteAnim(amt, "out");
    setToast(`SET ASIDE FOR ${fund.name.toUpperCase()}`);
    setTimeout(() => setToast(null), 1600);
    setContributing(null);
    setContribAmt("");
  };

  return (
    <>
      <div style={S.sectionHeadRow}>
        <SectionLabel text="SINKING FUNDS" noMargin />
        <button style={S.addBtn} className="npop" onClick={() => setShowForm((s) => !s)}>
          {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? "CANCEL" : "NEW"}
        </button>
      </div>
      <div style={{ fontSize: 10.5, color: T.muted, marginBottom: 8 }}>FOR IRREGULAR BIG EXPENSES — INSURANCE, RENEWALS, ANYTHING THAT HITS ONCE A YEAR</div>

      {showForm && (
        <div style={S.formCard}>
          <input placeholder="what for — e.g. Bike Insurance" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...S.input, width: "100%" }} />
          <AmountInput placeholder="target amount" value={form.target} onChange={(v) => setForm({ ...form, target: v })} style={{ ...S.input, width: "100%" }} className="tnum" />
          <button style={S.submitBtnPurple} className="npop" onClick={addFund}>CREATE SINKING FUND</button>
        </div>
      )}

      {data.sinkingFunds.length === 0 ? (
        <EmptyNote text="set money aside little by little for a big expense that's coming" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
          {data.sinkingFunds.map((f) => {
            const pct = Math.min(100, Math.round((f.saved / f.target) * 100));
            return (
              <div key={f.id} style={{ ...S.statBox, boxShadow: `3px 3px 0px ${T.purple}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.ivory }}>{f.name.toUpperCase()}</span>
                  <button style={S.deleteBtn} onClick={() => removeFund(f.id)}><Trash2 size={12} color={T.muted} /></button>
                </div>
                <div style={{ ...S.progressTrack, marginTop: 6 }}>
                  <div style={{ ...S.progressFill, width: `${pct}%`, background: T.purple }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <span style={{ fontSize: 10.5, color: T.muted }} className="tnum">{fmt(f.saved)} OF {fmt(f.target)}</span>
                  {contributing === f.id ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <AmountInput autoFocus placeholder="amt" value={contribAmt} onChange={(v) => setContribAmt(v)} style={{ ...S.pctInput, width: 70 }} className="tnum" />
                      <button style={S.smallToggle} onClick={() => contribute(f)}><Check size={12} color={T.green} /></button>
                    </div>
                  ) : (
                    <button style={S.correctionLink} onClick={() => { setContributing(f.id); setContribAmt(""); }}>ADD MONEY</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function BrokerHoldingsSection({ data, persist }) {
  const [showSetup, setShowSetup] = useState(false);
  const [kiteKey, setKiteKey] = useState(data.brokerConfig.kiteApiKey);
  const [motilalUrl, setMotilalUrl] = useState(data.brokerConfig.motilalLoginUrl);
  const [kiteHoldings, setKiteHoldings] = useState(null);
  const [motilalHoldings, setMotilalHoldings] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const saveConfig = () => {
    persist({ ...data, brokerConfig: { kiteApiKey: kiteKey.trim(), motilalLoginUrl: motilalUrl.trim() } });
    setShowSetup(false);
  };

  const connectKite = () => {
    if (!data.brokerConfig.kiteApiKey) { setShowSetup(true); return; }
    window.open(`https://kite.zerodha.com/connect/login?v=3&api_key=${data.brokerConfig.kiteApiKey}`, "_blank");
  };
  const connectMotilal = () => {
    if (!data.brokerConfig.motilalLoginUrl) { setShowSetup(true); return; }
    window.open(data.brokerConfig.motilalLoginUrl, "_blank");
  };

  const fetchKiteHoldings = async () => {
    setLoading(true);
    setError(null);
    try {
      const sessionRes = await fetch(`${SUPABASE_URL}/rest/v1/khata_broker_sessions?broker=eq.kite&select=access_token`, { headers: SUPABASE_HEADERS });
      const sessionRows = await sessionRes.json();
      const token = sessionRows[0]?.access_token;
      if (!token) throw new Error("Not connected yet — tap Connect Kite first.");
      const res = await fetch("https://api.kite.trade/portfolio/holdings", {
        headers: { Authorization: `token ${data.brokerConfig.kiteApiKey}:${token}`, "X-Kite-Version": "3" },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Kite session expired — reconnect (tokens expire daily).");
      setKiteHoldings(json.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchMotilalHoldings = async () => {
    setLoading(true);
    setError(null);
    try {
      const sessionRes = await fetch(`${SUPABASE_URL}/rest/v1/khata_broker_sessions?broker=eq.motilal&select=access_token`, { headers: SUPABASE_HEADERS });
      const sessionRows = await sessionRes.json();
      const token = sessionRows[0]?.access_token;
      if (!token) throw new Error("Not connected yet — tap Connect Rise first.");
      // Note: exact endpoint may need adjusting once you're testing against your real Motilal API dashboard.
      const res = await fetch("https://openapi.motilaloswal.com/rest/report/v1/getdpholding", {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ clientcode: "" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "Rise session expired — reconnect (tokens expire daily at 6am).");
      setMotilalHoldings(json.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const kiteTotal = kiteHoldings ? kiteHoldings.reduce((s, h) => s + (h.quantity * h.last_price || 0), 0) : 0;

  return (
    <>
      <div style={S.sectionHeadRow}>
        <SectionLabel text="BROKER HOLDINGS — LIVE" noMargin />
        <button style={S.addBtn} className="npop" onClick={() => setShowSetup((s) => !s)}>
          <Settings2 size={14} /> {showSetup ? "CLOSE" : "SETUP"}
        </button>
      </div>

      {showSetup && (
        <div style={S.formCard}>
          <div style={{ fontSize: 9.5, color: T.muted }}>KITE API KEY (FROM developers.kite.trade — FREE PERSONAL PLAN)</div>
          <input type="text" placeholder="kite api key" value={kiteKey} onChange={(e) => setKiteKey(e.target.value)} style={{ ...S.input, width: "100%" }} />
          <div style={{ fontSize: 9.5, color: T.muted, marginTop: 8 }}>RISE (MOTILAL) LOGIN URL — FROM YOUR API DASHBOARD</div>
          <input type="text" placeholder="https://invest.motilaloswal.com/OpenApi/Login.aspx?apikey=..." value={motilalUrl} onChange={(e) => setMotilalUrl(e.target.value)} style={{ ...S.input, width: "100%" }} />
          <button style={S.submitBtnGreen} className="npop" onClick={saveConfig}>SAVE</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button style={{ ...S.exportBtn, flex: 1, borderColor: T.orange }} className="npop" onClick={connectKite}>CONNECT KITE</button>
        <button style={{ ...S.exportBtn, flex: 1, borderColor: T.blue }} className="npop" onClick={connectMotilal}>CONNECT RISE</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button style={{ ...S.correctionLink }} onClick={fetchKiteHoldings} disabled={loading}>REFRESH KITE HOLDINGS</button>
        <button style={{ ...S.correctionLink }} onClick={fetchMotilalHoldings} disabled={loading}>REFRESH RISE HOLDINGS</button>
      </div>
      {error && <div style={{ fontSize: 10.5, color: T.orange, fontWeight: 700, marginBottom: 8 }}>{error}</div>}
      <div style={{ fontSize: 9.5, color: T.muted, marginBottom: 10 }}>BOTH BROKERS REQUIRE RECONNECTING ONCE A DAY — TOKENS EXPIRE DAILY (EXCHANGE RULE)</div>

      {kiteHoldings && kiteHoldings.length > 0 && (
        <div style={{ ...S.statBox, boxShadow: `3px 3px 0px ${T.orange}`, marginBottom: 10 }}>
          <div style={S.statBoxLabel}>KITE HOLDINGS VALUE</div>
          <div style={{ ...S.statBoxNum, color: T.orange }} className="tnum">{fmt(kiteTotal)}</div>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>{kiteHoldings.length} HOLDINGS</div>
        </div>
      )}
      {motilalHoldings && motilalHoldings.length > 0 && (
        <div style={{ ...S.statBox, boxShadow: `3px 3px 0px ${T.blue}`, marginBottom: 10 }}>
          <div style={S.statBoxLabel}>RISE HOLDINGS</div>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>{motilalHoldings.length} HOLDINGS FOUND</div>
        </div>
      )}
    </>
  );
}

const INVESTMENT_TYPES = ["Inventory Stock", "Mutual Funds", "Others"];

function InvestmentsSection({ data, persist, totalInvested }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", amount: "", type: INVESTMENT_TYPES[0] });

  const addInvestment = () => {
    const amt = parseFloat(form.amount);
    if (!form.name.trim() || !amt || amt <= 0) return;
    const entry = { id: Date.now(), name: form.name.trim(), amount: amt, date: todayISO(), investmentType: form.type };
    persist({ ...data, investments: [...data.investments, entry] });
    setForm({ name: "", amount: "", type: INVESTMENT_TYPES[0] });
    setShowForm(false);
  };
  const removeInvestment = (id) => persist({ ...data, investments: data.investments.filter((i) => i.id !== id) });

  const byType = useMemo(() => {
    const map = {};
    INVESTMENT_TYPES.forEach((t) => { map[t] = { total: 0, items: [] }; });
    data.investments.forEach((i) => {
      const t = INVESTMENT_TYPES.includes(i.investmentType) ? i.investmentType : (i.source === "inventory_cashout" ? "Inventory Stock" : "Others");
      if (!map[t]) map[t] = { total: 0, items: [] };
      map[t].total += i.amount;
      map[t].items.push(i);
    });
    return map;
  }, [data.investments]);

  return (
    <>
      <div style={S.sectionHeadRow}>
        <SectionLabel text="INVESTMENTS" noMargin />
        <button style={S.addBtn} className="npop" onClick={() => setShowForm((s) => !s)}>
          {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? "CANCEL" : "ADD"}
        </button>
      </div>
      <div style={{ ...S.statBox, boxShadow: `3px 3px 0px ${T.purple}`, marginBottom: 10, marginTop: 8 }}>
        <div style={S.statBoxLabel}>TOTAL INVESTED</div>
        <div style={{ ...S.statBoxNum, color: T.purple }} className="tnum">{fmt(totalInvested)}</div>
      </div>

      {showForm && (
        <div style={S.formCard}>
          <input placeholder="what — e.g. Nifty 50 Index Fund" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...S.input, width: "100%" }} />
          <div style={S.formRow}>
            <AmountInput placeholder="amount" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} style={S.input} className="tnum" />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={S.select}>
              {INVESTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button style={S.submitBtnPurple} className="npop" onClick={addInvestment}>SAVE</button>
        </div>
      )}

      {data.investments.length === 0 ? (
        <EmptyNote text="no investments logged yet" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {INVESTMENT_TYPES.filter((t) => byType[t]?.items.length > 0).map((t) => (
            <div key={t}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: T.muted, letterSpacing: "0.03em" }}>{t.toUpperCase()}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.purple }} className="tnum">{fmt(byType[t].total)}</span>
              </div>
              <div style={S.ledger}>
                {[...byType[t].items].reverse().map((i) => {
                  const marginPct = i.expectedProfit && i.amount > 0 ? Math.round((i.expectedProfit / i.amount) * 1000) / 10 : null;
                  return (
                    <div key={i.id} style={S.ledgerRow}>
                      <div style={S.ledgerMain}>
                        <div style={S.ledgerCategory}>{i.name} {i.source === "inventory_cashout" && <span style={S.fineTag}>CASHOUT</span>}</div>
                        <div style={S.ledgerNote}>
                          {fmtDate(i.date)}
                          {i.expectedArrival && ` · arrives ${fmtDate(i.expectedArrival)}`}
                          {i.expectedProfit ? ` · ~${fmt(i.expectedProfit)} profit${marginPct !== null ? ` (${marginPct}%)` : ""}` : ""}
                        </div>
                      </div>
                      <div style={{ ...S.ledgerAmt, color: T.purple }} className="tnum">{fmt(i.amount)}</div>
                      <button style={S.deleteBtn} onClick={() => removeInvestment(i.id)}><Trash2 size={13} color={T.muted} /></button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function HealthScoreCard({ data }) {
  const score = computeHealthScore(data);
  const { label, color } = healthScoreLabel(score);
  return (
    <div style={{ ...S.statBox, boxShadow: `3px 3px 0px ${color}`, flex: 1 }}>
      <div style={S.statBoxLabel}>FINANCIAL HEALTH</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color }} className="tnum">{score}</span>
        <span style={{ fontSize: 9, fontWeight: 700, color, letterSpacing: "0.03em" }}>{label}</span>
      </div>
      <div style={{ ...S.progressTrack, marginTop: 6 }}>
        <div style={{ ...S.progressFill, width: `${score}%`, background: color }} />
      </div>
    </div>
  );
}

function AIReportsButton({ data }) {
  const [openReport, setOpenReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runReport = async (type) => {
    setOpenReport(type);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const text = await fetchAIText(buildReportPrompt(type, data));
      setResult(text);
    } catch (err) {
      setError(err?.message || "Couldn't generate report — try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SectionLabel text="AI REPORTS" />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {AI_REPORT_TYPES.map((r) => (
          <button key={r.id} style={S.reportBtn} className="npop-flat" onClick={() => runReport(r.id)}>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.purple }}>{r.label}</div>
              <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{r.desc}</div>
            </div>
            <span style={{ fontSize: 16, color: T.purple }}>›</span>
          </button>
        ))}
      </div>

      {openReport && (
        <div style={S.calcOverlay} onClick={() => setOpenReport(null)}>
          <div style={S.calcModal} onClick={(e) => e.stopPropagation()}>
            <div style={S.calcHeader}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.purple }}>
                {AI_REPORT_TYPES.find((r) => r.id === openReport)?.label}
              </div>
              <button style={S.calcCloseBtn} onClick={() => setOpenReport(null)}><X size={16} color={T.ivory} /></button>
            </div>
            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "20px 0" }}>
                <Loader2 className="animate-spin" size={16} color={T.purple} />
                <span style={{ fontSize: 12, color: T.muted }}>ANALYZING YOUR DATA…</span>
              </div>
            )}
            {error && <div style={{ fontSize: 11, color: T.orange, fontWeight: 700, padding: "10px 0" }}>{error}</div>}
            {result && <div style={{ ...S.aiTipResult, fontSize: 13, marginTop: 8 }}>{result}</div>}
          </div>
        </div>
      )}
    </>
  );
}

function HeatMeter({ data }) {
  const level = computeHeatLevel(data);
  const labels = ["COOL", "COOL", "WARM", "HOT", "BLAZING", "ON FIRE"];
  const color = level >= 4 ? T.orange : level >= 2 ? "#F2C230" : T.green;
  return (
    <div style={{ ...S.heatBox, boxShadow: `3px 3px 0px ${color}` }}>
      <div style={S.statBoxLabel}>HEAT — WASTE THIS WEEK</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
        <div style={{ display: "flex", gap: 3 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Flame key={i} size={17} color={i <= level ? color : T.line} fill={i <= level ? color : "none"} />
          ))}
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color }} className="tnum">{labels[level]}</span>
      </div>
    </div>
  );
}

function BossBattle({ data }) {
  const goal = priorityGoalForBoss(data);
  if (!goal) return null;
  const fund = data.funds.find((f) => f.id === goal.fundId);
  const bal = data.fundBalances[goal.fundId] || 0;
  const pct = Math.min(100, Math.round((bal / goal.target) * 100));
  const hp = 100 - pct;
  const defeated = pct >= 100;

  return (
    <div style={{ ...S.bossBox, boxShadow: `4px 4px 0px ${defeated ? T.green : T.orange}` }}>
      <div style={S.bossHeader}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, color: defeated ? T.green : T.orange, letterSpacing: "0.05em" }}>
          <Swords size={13} /> BOSS BATTLE
        </span>
        {defeated && <span style={{ fontSize: 10, fontWeight: 700, color: T.green }}>DEFEATED</span>}
      </div>
      <div style={S.bossName}>{goal.name.toUpperCase()}</div>
      <div style={S.bossHpTrack}>
        <div style={{ ...S.bossHpFill, width: `${hp}%`, background: defeated ? T.green : hp > 50 ? "#F2C230" : T.orange }} />
      </div>
      <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }} className="tnum">
        {defeated ? "BOSS CLEARED — LEGENDARY" : `HP ${hp}% · ${fmt(goal.target - bal)} DAMAGE LEFT TO DEAL`}
      </div>
    </div>
  );
}

function TrophyCase({ data }) {
  const earnedIds = new Set(data.trophies.map((t) => t.id));
  const tiers = ["bronze", "silver", "gold", "platinum"];
  return (
    <>
      <SectionLabel text={`TROPHIES — ${data.trophies.length}/${TROPHY_DEFS.length}`} />
      <div style={S.trophyGrid}>
        {tiers.flatMap((tier) => TROPHY_DEFS.filter((t) => t.tier === tier)).map((t) => {
          const earned = earnedIds.has(t.id);
          const color = TROPHY_TIER_COLOR[t.tier];
          return (
            <div key={t.id} style={{ ...S.trophyCell, boxShadow: earned ? `2px 2px 0px ${color}` : "none", opacity: earned ? 1 : 0.4 }}>
              {earned ? <Trophy size={20} color={color} fill={color} /> : <Lock size={16} color={T.muted} />}
              <div style={{ fontSize: 8.5, fontWeight: 700, color: earned ? color : T.muted, textAlign: "center", marginTop: 4, letterSpacing: "0.02em" }}>
                {t.name.toUpperCase()}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function LuxellaPanel() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const LUX_URL = "https://bkxzkrbhqpwosqecndnx.supabase.co/rest/v1/products";
  const LUX_KEY = "sb_publishable_OrE26muOqPnYMYyI9oQ80w_oQaO9wZm";

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = { apikey: LUX_KEY, Authorization: `Bearer ${LUX_KEY}` };
      const totalRes = await fetch(`${LUX_URL}?select=id&limit=1`, { headers: { ...headers, Prefer: "count=exact" } });
      const totalRange = totalRes.headers.get("content-range");
      const total = totalRange ? parseInt(totalRange.split("/")[1], 10) : null;

      const stockRes = await fetch(`${LUX_URL}?select=id&in_stock=eq.true&limit=1`, { headers: { ...headers, Prefer: "count=exact" } });
      const stockRange = stockRes.headers.get("content-range");
      const inStock = stockRange ? parseInt(stockRange.split("/")[1], 10) : null;

      const sampleRes = await fetch(`${LUX_URL}?select=brand,selling_price_inr&limit=800&order=last_checked_at.desc`, { headers });
      const sample = await sampleRes.json();
      const brandCounts = {};
      let priceSum = 0, priceCount = 0;
      (Array.isArray(sample) ? sample : []).forEach((p) => {
        if (p.brand) brandCounts[p.brand] = (brandCounts[p.brand] || 0) + 1;
        if (p.selling_price_inr) { priceSum += p.selling_price_inr; priceCount++; }
      });
      const topBrands = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const avgPrice = priceCount > 0 ? priceSum / priceCount : null;

      setStats({ total, inStock, topBrands, avgPrice });
    } catch (err) {
      setError("Couldn't reach Luxella data — try again");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);

  return (
    <>
      <div style={S.sectionHeadRow}>
        <SectionLabel text="LUXELLA — LIVE CATALOG" noMargin />
        <button style={S.correctionLink} onClick={fetchStats} disabled={loading}>{loading ? "..." : "REFRESH"}</button>
      </div>
      {error && <div style={{ fontSize: 11, color: T.orange, fontWeight: 700, marginBottom: 8 }}>{error}</div>}
      {stats && (
        <div style={S.statGrid}>
          <div style={S.statBox}>
            <div style={S.statBoxLabel}>PRODUCTS TRACKED</div>
            <div style={{ ...S.statBoxNum, color: T.blue }} className="tnum">{stats.total !== null ? stats.total.toLocaleString("en-IN") : "—"}</div>
          </div>
          <div style={S.statBox}>
            <div style={S.statBoxLabel}>IN STOCK</div>
            <div style={{ ...S.statBoxNum, color: T.green }} className="tnum">{stats.inStock !== null ? stats.inStock.toLocaleString("en-IN") : "—"}</div>
          </div>
          <div style={{ ...S.statBox, gridColumn: "span 2" }}>
            <div style={S.statBoxLabel}>TOP BRANDS (RECENT SAMPLE)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {stats.topBrands.map(([b, c]) => (
                <span key={b} style={{ fontSize: 10, color: T.ivory, border: `1px solid ${T.line}`, padding: "3px 7px" }}>{b} ({c})</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AICouncil({ data }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runCouncil = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const prompt = `${buildContext(data)}\nSimulate a short internal debate between three advisors looking at my numbers above, then give ONE final synthesized recommendation:\n- CFA (serious, numbers-first, risk-aware)\n- HUSTLER (aggressive, revenue-focused, wants action today)\n- GUARDIAN (cautious, protects savings/Lala Fund, worried about waste)\nFormat exactly like this, using my real numbers and categories, 1 short line per advisor then a final verdict:\nCFA: ...\nHUSTLER: ...\nGUARDIAN: ...\nCOUNCIL VERDICT: ...\nKeep every line under 15 words, ruthless and blunt, swearing allowed and encouraged (fuck, shit etc). No extra preamble.\nIMPORTANT: If I haven't logged much data yet, do NOT just say "log more entries" or ask for more data — that's not useful. Instead, give real, concrete tips for how to actually START earning and building profit, based on my business being D2C sourcing/reselling of luxury goods (MK, Coach, Alo Yoga, etc.) from the US/UK/Canada into India. Assume I'm just getting started and need actionable first moves, not a data request.`;
      const text = await fetchAIText(prompt);
      setResult(text);
    } catch (err) {
      setError(err?.message || "Couldn't reach the council — try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button style={{ ...S.quickBtn, borderColor: T.purple, color: T.purple, marginTop: 10, width: "100%" }} className="npop" onClick={runCouncil}>
        ⚖️ CALL THE COUNCIL
      </button>
      {open && (
        <div style={S.calcOverlay} onClick={() => setOpen(false)}>
          <div style={S.calcModal} onClick={(e) => e.stopPropagation()}>
            <div style={S.calcHeader}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.purple }}>FAB 5 COUNCIL</div>
              <button style={S.calcCloseBtn} onClick={() => setOpen(false)}><X size={16} color={T.ivory} /></button>
            </div>
            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "20px 0" }}>
                <Loader2 className="animate-spin" size={16} color={T.purple} />
                <span style={{ fontSize: 12, color: T.muted }}>THE COUNCIL IS DEBATING…</span>
              </div>
            )}
            {error && <div style={{ fontSize: 11, color: T.orange, fontWeight: 700, padding: "10px 0" }}>{error}</div>}
            {result && (
              <div style={{ ...S.aiTipResult, fontSize: 12.5, marginTop: 8, whiteSpace: "pre-line" }}>{result}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function DailyTip({ data, persist }) {
  const [loading, setLoading] = useState(false);
  const today = todayISO();
  const cached = data.dailyTip?.date === today ? data.dailyTip.text : null;

  const fetchTip = async () => {
    setLoading(true);
    try {
      const prompt = `Act as a ruthless hustle coach for a solo D2C sourcing founder. ${buildContext(data)} Give me ONE specific, tactical "money move" for today — either a way to make money (what to sell, to whom, via which channel) or a way to save money (a specific jugaad/hack relevant to sourcing, shipping, or reselling). Reference real numbers/categories from my data if possible. Ruthless and blunt, swearing allowed and encouraged (fuck, shit etc). 1 punchy sentence max, no preamble.`;
      const text = await fetchAIText(prompt);
      persist({ ...data, dailyTip: { date: today, text } });
    } catch {
      persist({ ...data, dailyTip: { date: today, text: "Couldn't fetch a tip — tap to retry." } });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!cached && !loading) fetchTip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ ...S.statBox, boxShadow: `3px 3px 0px ${T.gold || T.green}`, marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={S.statBoxLabel}>💡 TODAY'S MONEY MOVE</div>
        <button style={S.correctionLink} onClick={fetchTip} disabled={loading}>{loading ? "..." : "NEW TIP"}</button>
      </div>
      <div style={{ fontSize: 12.5, color: T.ivory, marginTop: 6, lineHeight: 1.5 }}>
        {loading ? "Thinking of a move for you…" : cached || "Tap NEW TIP to get today's move."}
      </div>
    </div>
  );
}

const MONEY_QUOTES = [
  "Money is your desired life's fucking boarding pass. Stop missing flights.",
  "Broke isn't a phase. It's a choice you keep making.",
  "Your excuses don't pay rent.",
  "Discipline is expensive. Regret is more expensive. Pick one.",
  "The market doesn't give a damn about your feelings.",
  "You want Dubai? Then act like it, not talk like it.",
  "Comfort is the enemy of the empire you say you want.",
  "Every rupee wasted is a mile off your own runway.",
  "Stop romanticizing struggle. Fix the leak.",
  "Money doesn't care how hard you tried. It cares if you closed.",
  "You're not behind. You're distracted. Fix that.",
  "Nobody's coming. Log it. Sell it. Move.",
  "Poor decisions compound faster than good ones. Choose right.",
  "Your bank balance is the only opinion that matters right now.",
  "Sympathy doesn't fund a business. Sales do.",
  "You either build the life or you rent someone else's excuses.",
  "Stop being broke and calm about it.",
  "Small leaks sink big ships. Yours is leaking right now.",
  "Rich people track. Poor people hope. Pick a side.",
  "The Lala Fund doesn't wait for a good month. Neither should you.",
  "Money — your only forever friend that's never gonna put you down. Make it a friend you'd be proud of. Now go earn more friends.",
];

function PermanentQuoteCard() {
  return (
    <div style={S.permanentQuoteCard}>
      <div style={S.permanentQuoteText}>
        "Money are your forever best friends. You earn respect, happiness, love and your dream life with them. Gain more such friends. Don't be afraid of taking risks — you're gonna put some friends on the war so they battle and win more such friends in return. Make your financial circle big. Every money earnt is a new friend to your happy life. Earn more. Everyone has got these friends — that is money. You earn these friends to yourself."
      </div>
    </div>
  );
}

function WhyBanner({ data, persist }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.northStar);

  const save = () => {
    persist({ ...data, northStar: draft.trim() });
    setEditing(false);
  };

  return (
    <div style={S.whyBanner} onClick={() => !editing && setEditing(true)}>
      <div style={S.whyLabel}>⚡ WHY</div>
      {editing ? (
        <>
          <textarea
            autoFocus
            placeholder='e.g. "I want fucking money coz thats the only thing that gives me love, power, and completes my dream to tour the entire world and get a stunning fucking Mercedes C Class."'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ ...S.input, width: "100%", minHeight: 60, marginTop: 8, fontFamily: "'Space Grotesk', sans-serif", resize: "vertical" }}
            onClick={(e) => e.stopPropagation()}
          />
          <button style={{ ...S.submitBtnGreen, marginTop: 8 }} className="npop" onClick={(e) => { e.stopPropagation(); save(); }}>SAVE</button>
        </>
      ) : data.northStar ? (
        <div style={S.whyText}>{data.northStar}</div>
      ) : (
        <div style={S.whyPlaceholder}>TAP TO WRITE WHY YOU'RE ACTUALLY DOING THIS — NO FILTER</div>
      )}
    </div>
  );
}

function SmsImportBanner({ data, persist, registerActivity, setToast, triggerNoteAnim }) {
  const [pending, setPending] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState({});

  const refresh = async () => {
    try {
      const rows = await fetchPendingSms();
      setPending(rows);
      const nextDrafts = {};
      rows.forEach((r) => {
        nextDrafts[r.id] = {
          amount: r.parsed_amount != null ? String(r.parsed_amount) : "",
          type: r.parsed_type === "credit" ? "income" : "expense",
          category: r.parsed_merchant || "Other",
        };
      });
      setDrafts(nextDrafts);
    } catch {
      // silent — SMS webhook may not be set up yet, don't nag
    }
  };

  useEffect(() => { refresh(); }, []);

  const importOne = async (row) => {
    const d = drafts[row.id];
    const amt = parseFloat(d.amount);
    if (!amt || amt <= 0) return;
    setLoading(true);
    const today = todayISO();
    if (d.type === "income") {
      const fundDelta = {};
      const fundBalances = { ...data.fundBalances };
      data.funds.forEach((f) => {
        const share = Math.round((amt * f.pct) / 100);
        fundDelta[f.id] = share;
        fundBalances[f.id] = (fundBalances[f.id] || 0) + share;
      });
      const entry = { id: Date.now(), amount: amt, source: d.category || "SMS Import", note: row.raw_message.slice(0, 80), date: today, fundDelta };
      const next = registerActivity({ ...data, income: [...data.income, entry], fundBalances }, 3);
      await persist(next);
      triggerNoteAnim(amt, "in");
    } else {
      const fundDelta = {};
      const fundBalances = { ...data.fundBalances };
      data.funds.forEach((f) => {
        const share = Math.round((amt * f.pct) / 100);
        fundDelta[f.id] = -share;
        fundBalances[f.id] = (fundBalances[f.id] || 0) - share;
      });
      const entry = { id: Date.now(), amount: amt, category: d.category || "Other", note: row.raw_message.slice(0, 80), date: today, unnecessary: false, fine: 0, fundDelta };
      const next = registerActivity({ ...data, expenses: [...data.expenses, entry], fundBalances }, 3);
      await persist(next);
      triggerNoteAnim(amt, "out");
    }
    await updateSmsStatus(row.id, "imported");
    setToast("SMS IMPORTED");
    setTimeout(() => setToast(null), 1400);
    setLoading(false);
    refresh();
  };

  const ignoreOne = async (row) => {
    await updateSmsStatus(row.id, "ignored");
    refresh();
  };

  if (pending.length === 0) return null;

  return (
    <>
      <button style={S.smsBanner} onClick={() => setOpen(true)}>
        📩 {pending.length} SMS IMPORT{pending.length > 1 ? "S" : ""} WAITING FOR REVIEW
      </button>
      {open && (
        <div style={S.calcOverlay} onClick={() => setOpen(false)}>
          <div style={S.calcModal} onClick={(e) => e.stopPropagation()}>
            <div style={S.calcHeader}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.ivory }}>SMS IMPORTS</div>
              <button style={S.calcCloseBtn} onClick={() => setOpen(false)}><X size={16} color={T.ivory} /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 400, overflowY: "auto" }}>
              {pending.map((row) => {
                const d = drafts[row.id] || { amount: "", type: "expense", category: "" };
                return (
                  <div key={row.id} style={S.formCard}>
                    <div style={{ fontSize: 10, color: T.muted, fontStyle: "italic", marginBottom: 6 }}>{row.raw_message.slice(0, 100)}</div>
                    <div style={S.formRow}>
                      <select value={d.type} onChange={(e) => setDrafts({ ...drafts, [row.id]: { ...d, type: e.target.value } })} style={S.select}>
                        <option value="income">Income</option>
                        <option value="expense">Expense</option>
                      </select>
                      <AmountInput value={d.amount} onChange={(v) => setDrafts({ ...drafts, [row.id]: { ...d, amount: v } })} style={S.input} className="tnum" />
                    </div>
                    <input type="text" value={d.category} onChange={(e) => setDrafts({ ...drafts, [row.id]: { ...d, category: e.target.value } })} style={{ ...S.input, width: "100%" }} placeholder="category/source" />
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button style={{ ...S.submitBtnGreen, flex: 1 }} className="npop" onClick={() => importOne(row)} disabled={loading}>IMPORT</button>
                      <button style={{ ...S.submitBtnOrange, flex: 1 }} className="npop" onClick={() => ignoreOne(row)}>IGNORE</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function LittleJeetCard({ data }) {
  const message = useMemo(() => littleJeetMessage(data), [data.income, data.expenses, data.profitTargets]);
  return (
    <div style={S.littleJeetCard}>
      <div style={S.littleJeetLabel}>👦 LITTLE JEET</div>
      <div style={S.littleJeetText}>{message}</div>
    </div>
  );
}

function RuthlessPushBanner({ data }) {
  const message = useMemo(() => ruthlessPush(data), [data.income, data.expenses, data.profitTargets]);
  return (
    <div style={S.ruthlessBanner}>
      <div style={S.ruthlessText}>{message}</div>
    </div>
  );
}

function MoodRing({ data }) {
  const mood = computeMoodRing(data);
  return (
    <div style={{ ...S.statBox, boxShadow: `3px 3px 0px ${mood.color}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 10 }}>
      <span style={{ fontSize: 26 }}>{mood.emoji}</span>
      <div>
        <div style={S.statBoxLabel}>TODAY'S MONEY MOOD</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: mood.color, marginTop: 2 }}>{mood.label}</div>
      </div>
    </div>
  );
}

function MoneyQuoteBanner() {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * MONEY_QUOTES.length));
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % MONEY_QUOTES.length);
        setVisible(true);
      }, 350);
    }, 5500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={S.quoteBanner}>
      <div style={{ ...S.quoteText, opacity: visible ? 1 : 0 }}>"{MONEY_QUOTES[idx]}"</div>
    </div>
  );
}

function TodayProfitHero({ data, todayProfit, todayIncome, todayExpense, today }) {
  const [open, setOpen] = useState(false);
  const target = data.profitTargets.daily;
  const pct = target > 0 ? Math.min(100, Math.round((Math.max(0, todayProfit) / target) * 100)) : 0;
  const remaining = Math.max(0, target - todayProfit);
  const hit = todayProfit >= target;
  const color = hit ? T.green : todayProfit >= 0 ? T.gold : T.orange;
  const todayEntries = [
    ...data.income.filter((e) => e.date === today).map((e) => ({ ...e, kind: "in" })),
    ...data.expenses.filter((e) => e.date === today).map((e) => ({ ...e, kind: "out" })),
  ].sort((a, b) => b.id - a.id);

  return (
    <div style={{ ...S.heroCard, cursor: "pointer" }} className="npop-flat" onClick={() => setOpen((s) => !s)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={S.heroLabel}>TODAY'S PROFIT</div>
        <WoWBadge pct={weekOverWeek(data, "profit").pct} />
      </div>
      <div style={{ ...S.heroNum, color: todayProfit >= 0 ? T.green : T.orange }} className="tnum">{fmtSigned(todayProfit)}</div>
      <div style={S.heroSub} className="tnum">{fmt(todayIncome)} IN · {fmt(todayExpense)} OUT — TODAY ONLY</div>
      {target > 0 && (
        <>
          <div style={{ ...S.progressTrack, marginTop: 10 }}>
            <div style={{ ...S.progressFill, width: `${pct}%`, background: color }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <span style={{ fontSize: 10.5, color: T.muted }} className="tnum">{pct}% OF ₹{target.toLocaleString("en-IN")} DAILY TARGET</span>
            <span style={{ fontSize: 10.5, color: T.muted, fontWeight: 700 }} className="tnum">{remaining > 0 ? `${fmt(remaining)} LEFT` : "HIT"}</span>
          </div>
        </>
      )}

      {open && (
        <div style={S.expandPanel} onClick={(e) => e.stopPropagation()}>
          <div style={S.expandLabel}>TODAY'S ENTRIES ({todayEntries.length})</div>
          {todayEntries.length === 0 ? (
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 8 }}>nothing logged today yet</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
              {todayEntries.map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }} className="tnum">
                  <span style={{ color: T.muted }}>{e.kind === "in" ? e.source : e.category}</span>
                  <span style={{ color: e.kind === "in" ? T.green : T.orange, fontWeight: 700 }}>{e.kind === "in" ? "+" : "−"}{fmt(e.amount)}</span>
                </div>
              ))}
            </div>
          )}
          <AITipBlock
            prompt={`Act as a sharp, encouraging business coach. Today so far I've made ₹${todayIncome} and spent ₹${todayExpense}, net ₹${todayProfit}, against a daily target of ₹${target}. ${buildContext(data)} Based on my actual patterns above, give me 2-3 short, specific, actionable sentences on what to do for the rest of today. Be direct and concrete, not generic.`}
          />
        </div>
      )}
    </div>
  );
}

function QuickActionsBar({ data, persist, registerActivity, setToast, triggerNoteAnim }) {
  const [mode, setMode] = useState(null); // null | 'profit' | 'expense' | 'waste' | 'sold_order' | 'cashout'
  const [amount, setAmount] = useState("");
  const [pick, setPick] = useState(INCOME_SOURCES[0]);
  const [note, setNote] = useState("");
  const [account, setAccount] = useState("none");
  const [so, setSo] = useState({ itemName: "", qty: "", saleValue: "", expectedProfit: "", moneyReceived: "", moneyDue: "", recipientName: "", expectedReceivableDate: "" });
  const [co, setCo] = useState({ itemName: "", qty: "", itemValue: "", expectedSellingPrice: "", expectedProfit: "", expectedArrival: "" });

  const openMode = (m) => {
    setMode(mode === m ? null : m);
    setAmount("");
    setNote("");
    setAccount("none");
    setPick(m === "profit" ? INCOME_SOURCES[0] : m === "waste" ? WASTE_TYPES[0] : EXPENSE_CATEGORIES[0]);
    setSo({ itemName: "", qty: "", saleValue: "", expectedProfit: "", moneyReceived: "", moneyDue: "", recipientName: "", expectedReceivableDate: "" });
    setCo({ itemName: "", qty: "", itemValue: "", expectedSellingPrice: "", expectedProfit: "", expectedArrival: "" });
  };

  const applyFundDelta = (amt, sign) => {
    const fundDelta = {};
    const fundBalances = { ...data.fundBalances };
    data.funds.forEach((f) => {
      const share = Math.round((amt * f.pct) / 100) * sign;
      fundDelta[f.id] = share;
      fundBalances[f.id] = (fundBalances[f.id] || 0) + share;
    });
    return { fundDelta, fundBalances };
  };

  const submit = () => {
    const today = todayISO();

    if (mode === "sold_order") {
      const profit = parseFloat(so.expectedProfit);
      if (!profit || profit <= 0) return;
      const due = parseFloat(so.moneyDue) || 0;
      const received = parseFloat(so.moneyReceived) || 0;
      const saleVal = parseFloat(so.saleValue) || 0;
      const profitPct = saleVal > 0 ? Math.round((profit / saleVal) * 1000) / 10 : null;
      const { fundDelta, fundBalances } = applyFundDelta(profit, 1);
      const entry = {
        id: Date.now(), amount: profit, source: "Sold Order",
        note: `${so.recipientName || "buyer"} — sale ₹${so.saleValue || 0}, received ₹${so.moneyReceived || 0}${profitPct !== null ? ` (${profitPct}% margin)` : ""}${note ? " — " + note.trim() : ""}`,
        date: today, fundDelta, itemName: so.itemName || null, qty: so.qty ? parseFloat(so.qty) : null,
      };
      let next = registerActivity({ ...data, income: [...data.income, entry], fundBalances }, 5);
      if (due > 0) {
        const receivable = { id: Date.now() + 1, party: so.recipientName || "buyer", amount: due, dueDate: so.expectedReceivableDate || null, note: `Sold order — sale ₹${so.saleValue || 0}`, status: "pending" };
        next = { ...next, receivables: [...next.receivables, receivable] };
      }
      next = withAccountMovement(next, account, "in", received, `Sold order — ${so.itemName || so.recipientName || "buyer"}`, today);
      persist(next);
      triggerNoteAnim(profit, "in");
      setToast(due > 0 ? `+5 XP · ₹${due} MOVED TO RECEIVABLES` : "+5 XP · PROFIT LOGGED");
    } else if (mode === "cashout") {
      const sellingPrice = parseFloat(co.expectedSellingPrice);
      if (!sellingPrice || sellingPrice <= 0) return;
      const itemLabel = co.itemName ? `${co.itemName}${co.qty ? ` ×${co.qty}` : ""}` : null;
      const investment = {
        id: Date.now(), name: itemLabel || note.trim() || "Inventory Cashout", amount: sellingPrice, date: today,
        itemValue: parseFloat(co.itemValue) || 0, expectedProfit: parseFloat(co.expectedProfit) || 0,
        expectedArrival: co.expectedArrival || null, itemName: co.itemName || null, qty: co.qty ? parseFloat(co.qty) : null,
        source: "inventory_cashout", account: account !== "none" ? account : null, investmentType: "Inventory Stock",
      };
      persist({ ...data, investments: [...data.investments, investment] });
      setToast("LOGGED TO INVESTMENTS · PENDING ARRIVAL");
    } else {
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) return;
      if (mode === "profit") {
        const { fundDelta, fundBalances } = applyFundDelta(amt, 1);
        const entry = { id: Date.now(), amount: amt, source: pick, note: note.trim(), date: today, fundDelta };
        let next = registerActivity({ ...data, income: [...data.income, entry], fundBalances }, 5);
        next = withAccountMovement(next, account, "in", amt, `Income — ${pick}`, today);
        persist(next);
        setToast(account !== "none" ? `+5 XP · ${account.toUpperCase()} UPDATED` : "+5 XP · PROFIT LOGGED");
        triggerNoteAnim(amt, "in");
      } else if (mode === "expense") {
        const { fundDelta, fundBalances } = applyFundDelta(amt, -1);
        const entry = { id: Date.now(), amount: amt, category: pick, note: note.trim(), date: today, unnecessary: false, fine: 0, fundDelta };
        let next = registerActivity({ ...data, expenses: [...data.expenses, entry], fundBalances }, 3);
        next = withAccountMovement(next, account, "out", amt, `Expense — ${pick}`, today);
        persist(next);
        setToast(account !== "none" ? `+3 XP · ${account.toUpperCase()} UPDATED` : "+3 XP · EXPENSE LOGGED");
        triggerNoteAnim(amt, "out");
      } else if (mode === "waste") {
        const fine = tieredFine(amt);
        const total = amt + fine;
        const { fundDelta, fundBalances } = applyFundDelta(total, -1);
        const entry = { id: Date.now(), amount: total, category: pick, note: note.trim(), date: today, unnecessary: true, fine, fundDelta };
        let next = registerActivity({ ...data, expenses: [...data.expenses, entry], fundBalances }, 3);
        next = withAccountMovement(next, account, "out", total, `Waste — ${pick}`, today);
        persist(next);
        setToast(`LOGGED + ₹${fine} FINE`);
        triggerNoteAnim(total, "out");
      }
    }
    setTimeout(() => setToast(null), 1800);
    setMode(null);
    setAmount("");
    setNote("");
    setAccount("none");
  };

  const previewFine = mode === "waste" && amount ? tieredFine(parseFloat(amount) || 0) : null;

  const MODE_BTNS = [
    { id: "profit", label: "+ PROFIT", color: T.green },
    { id: "expense", label: "+ EXPENSE", color: T.orange },
    { id: "waste", label: "+ WASTE", color: T.purple },
    { id: "sold_order", label: "+ SOLD ORDER", color: T.green },
    { id: "cashout", label: "+ CASHOUT", color: T.blue },
  ];

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {MODE_BTNS.map((b) => (
          <button
            key={b.id}
            style={{ ...S.quickBtn, flex: "1 1 30%", borderColor: b.color, color: mode === b.id ? T.bg : b.color, background: mode === b.id ? b.color : T.surface }}
            className="npop"
            onClick={() => openMode(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      {mode && (mode === "profit" || mode === "expense" || mode === "waste") && (
        <div style={S.formCard}>
          <div style={S.formRow}>
            <AmountInput autoFocus placeholder="amount" value={amount} onChange={(v) => setAmount(v)} style={S.input} className="tnum" />
            <select value={pick} onChange={(e) => setPick(e.target.value)} style={S.select}>
              {(mode === "profit" ? INCOME_SOURCES : mode === "waste" ? WASTE_TYPES : EXPENSE_CATEGORIES).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <select value={account} onChange={(e) => setAccount(e.target.value)} style={S.select}>
            {(mode === "profit" ? ACCOUNT_OPTIONS_IN : ACCOUNT_OPTIONS_OUT).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <input type="text" placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...S.input, width: "100%" }} />
          {previewFine !== null && (
            <div style={{ fontSize: 11, color: T.purple, fontWeight: 700 }} className="tnum">
              FINE: ₹{previewFine} — TOTAL DEDUCTED: {fmt((parseFloat(amount) || 0) + previewFine)}
            </div>
          )}
          <button style={mode === "profit" ? S.submitBtnGreen : mode === "waste" ? S.submitBtnPurple : S.submitBtnOrange} className="npop" onClick={submit}>SAVE</button>
        </div>
      )}

      {mode === "sold_order" && (
        <div style={S.formCard}>
          <div style={{ fontSize: 10, color: T.muted }}>THIS LOGS AS PROFIT — NOT AN EXPENSE</div>
          <div style={S.formRow}>
            <input type="text" placeholder="item name" value={so.itemName} onChange={(e) => setSo({ ...so, itemName: e.target.value })} style={S.input} />
            <input type="number" placeholder="qty" value={so.qty} onChange={(e) => setSo({ ...so, qty: e.target.value })} style={{ ...S.input, maxWidth: 70 }} className="tnum" />
          </div>
          <div style={S.formRow}>
            <AmountInput placeholder="sale value" value={so.saleValue} onChange={(v) => setSo({ ...so, saleValue: v })} style={S.input} className="tnum" />
            <AmountInput placeholder="expected profit" value={so.expectedProfit} onChange={(v) => setSo({ ...so, expectedProfit: v })} style={S.input} className="tnum" />
          </div>
          <div style={S.formRow}>
            <AmountInput placeholder="money received" value={so.moneyReceived} onChange={(v) => setSo({ ...so, moneyReceived: v })} style={S.input} className="tnum" />
            <AmountInput placeholder="money due" value={so.moneyDue} onChange={(v) => setSo({ ...so, moneyDue: v })} style={S.input} className="tnum" />
          </div>
          <select value={account} onChange={(e) => setAccount(e.target.value)} style={S.select}>
            {ACCOUNT_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.id === "none" ? a.label : `MONEY RECEIVED → ${a.label}`}</option>)}
          </select>
          <input type="text" placeholder="recipient's name" value={so.recipientName} onChange={(e) => setSo({ ...so, recipientName: e.target.value })} style={{ ...S.input, width: "100%" }} />
          <input type="date" placeholder="expected receivable date" value={so.expectedReceivableDate} onChange={(e) => setSo({ ...so, expectedReceivableDate: e.target.value })} style={{ ...S.input, width: "100%" }} className="tnum" />
          <input type="text" placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...S.input, width: "100%" }} />
          <button style={S.submitBtnGreen} className="npop" onClick={submit}>SAVE SOLD ORDER</button>
        </div>
      )}

      {mode === "cashout" && (
        <div style={S.formCard}>
          <div style={{ fontSize: 10, color: T.muted }}>LOGS TO INVESTMENTS — NOT PROFIT, NOT AN EXPENSE</div>
          <div style={S.formRow}>
            <input type="text" placeholder="item name" value={co.itemName} onChange={(e) => setCo({ ...co, itemName: e.target.value })} style={S.input} />
            <input type="number" placeholder="qty" value={co.qty} onChange={(e) => setCo({ ...co, qty: e.target.value })} style={{ ...S.input, maxWidth: 70 }} className="tnum" />
          </div>
          <div style={S.formRow}>
            <AmountInput placeholder="item value" value={co.itemValue} onChange={(v) => setCo({ ...co, itemValue: v })} style={S.input} className="tnum" />
            <AmountInput placeholder="expected selling price" value={co.expectedSellingPrice} onChange={(v) => setCo({ ...co, expectedSellingPrice: v })} style={S.input} className="tnum" />
          </div>
          <div style={S.formRow}>
            <AmountInput placeholder="expected profit" value={co.expectedProfit} onChange={(v) => setCo({ ...co, expectedProfit: v })} style={S.input} className="tnum" />
            <input type="date" placeholder="expected date of arrival" value={co.expectedArrival} onChange={(e) => setCo({ ...co, expectedArrival: e.target.value })} style={S.input} className="tnum" />
          </div>
          <select value={account} onChange={(e) => setAccount(e.target.value)} style={S.select}>
            {ACCOUNT_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.id === "none" ? a.label : `WILL ARRIVE IN → ${a.label}`}</option>)}
          </select>
          <div style={{ fontSize: 9.5, color: T.muted }}>ACCOUNT ONLY UPDATES ONCE THE MONEY ACTUALLY ARRIVES — NOT YET</div>
          <input type="text" placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...S.input, width: "100%" }} />
          <button style={S.submitBtnPurple} className="npop" onClick={submit}>SAVE CASHOUT</button>
        </div>
      )}
    </div>
  );
}

function ProfitTargetsSection({ data, persist, todayProfit, weekProfit, monthProfit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.profitTargets);
  const [expanded, setExpanded] = useState(null);

  const save = () => {
    persist({
      ...data,
      profitTargets: {
        daily: parseFloat(draft.daily) || 0,
        weekly: parseFloat(draft.weekly) || 0,
        monthly: parseFloat(draft.monthly) || 0,
      },
    });
    setEditing(false);
  };

  const today = todayISO();
  const weekStart = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const ps = data.profitStreaks;

  const rows = [
    { key: "daily", label: "DAILY PROFIT TARGET", actual: todayProfit, target: data.profitTargets.daily, entries: data.income.filter((e) => e.date === today), streak: ps.daily, streakGoal: 10 },
    { key: "weekly", label: "WEEKLY PROFIT TARGET", actual: weekProfit, target: data.profitTargets.weekly, entries: data.income.filter((e) => e.date >= weekStart && e.date <= today), streak: ps.weekly, streakGoal: 5 },
    { key: "monthly", label: "MONTHLY PROFIT TARGET", actual: monthProfit, target: data.profitTargets.monthly, entries: data.income.filter((e) => monthKey(e.date) === currentMonthKey()), streak: ps.monthly, streakGoal: 3 },
  ];

  return (
    <>
      <div style={S.sectionHeadRow}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SectionLabel text="PROFIT TARGETS" noMargin />
          <span style={{ ...S.daysLeftChip, borderColor: T.gold || T.green, color: T.gold || T.green }} className="tnum">P.LVL {data.profitLevel}</span>
        </div>
        <button style={S.addBtn} className="npop" onClick={() => { setDraft(data.profitTargets); setEditing((s) => !s); }}>
          {editing ? <X size={14} /> : <Settings2 size={14} />} {editing ? "CANCEL" : "EDIT"}
        </button>
      </div>

      {editing ? (
        <div style={S.formCard}>
          <div style={S.pctRow}>
            <span style={S.pctName}>DAILY</span>
            <AmountInput value={draft.daily} onChange={(v) => setDraft({ ...draft, daily: v })} style={{ ...S.pctInput, width: 90 }} className="tnum" />
          </div>
          <div style={S.pctRow}>
            <span style={S.pctName}>WEEKLY</span>
            <AmountInput value={draft.weekly} onChange={(v) => setDraft({ ...draft, weekly: v })} style={{ ...S.pctInput, width: 90 }} className="tnum" />
          </div>
          <div style={S.pctRow}>
            <span style={S.pctName}>MONTHLY</span>
            <AmountInput value={draft.monthly} onChange={(v) => setDraft({ ...draft, monthly: v })} style={{ ...S.pctInput, width: 90 }} className="tnum" />
          </div>
          <button style={S.submitBtnGreen} className="npop" onClick={save}><Check size={13} /> SAVE TARGETS</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 4 }}>
          {rows.map((r) => {
            const pct = r.target > 0 ? Math.min(100, Math.round((Math.max(0, r.actual) / r.target) * 100)) : 0;
            const hit = r.actual >= r.target;
            const color = hit ? T.green : T.orange;
            const remaining = Math.max(0, r.target - r.actual);
            const isOpen = expanded === r.key;
            const avgSale = computeAvgSale(data);
            const prompt = `Act as a sharp, encouraging business coach. My ${r.label.toLowerCase()} is ₹${r.target}, I've made ₹${r.actual} so far, ₹${remaining} remaining. ${buildContext(data)} Based on my actual patterns above (which sources/categories perform best, timing, waste spending), give me 2-3 short, specific, actionable sentences on how to hit this target. Be direct and concrete, not generic.`;
            return (
              <div key={r.key} style={{ ...S.statBox, boxShadow: `3px 3px 0px ${color}`, cursor: "pointer" }} className="npop-flat" onClick={() => setExpanded(isOpen ? null : r.key)}>
                <div style={S.statBoxLabel}>{r.label}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color }} className="tnum">{fmtSigned(r.actual)} / {fmt(r.target)}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color }} className="tnum">{pct}%</span>
                </div>
                <div style={{ ...S.progressTrack, marginTop: 8 }}>
                  <div style={{ ...S.progressFill, width: `${pct}%`, background: color }} />
                </div>
                <div style={{ fontSize: 10.5, color: T.muted, marginTop: 6 }} className="tnum">
                  {remaining > 0 ? `₹${Math.round(remaining).toLocaleString("en-IN")} LEFT · = ${notes500(remaining).toLocaleString("en-IN")} × ₹500 NOTES` : "TARGET HIT"}
                </div>
                <div style={{ fontSize: 10, color: r.streak >= r.streakGoal ? T.green : T.muted, marginTop: 4, fontWeight: 700 }} className="tnum">
                  🔥 STREAK {r.streak}/{r.streakGoal}
                </div>

                {isOpen && (
                  <div style={S.expandPanel} onClick={(e) => e.stopPropagation()}>
                    {remaining > 0 && (
                      <>
                        <div style={S.expandLabel}>HOW TO REACH IT{avgSale ? " (BASED ON YOUR AVG SALE)" : ""}</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
                          {smartReachTips(remaining, avgSale).map((t) => (
                            <div key={t.count} style={{ fontSize: 11.5, color: T.ivory }} className="tnum">
                              → {t.count} SALE{t.count > 1 ? "S" : ""} OF ~{fmt(t.each)} PROFIT{t.count > 1 ? " EACH" : ""}
                            </div>
                          ))}
                        </div>
                        <AITipBlock prompt={prompt} />
                      </>
                    )}
                    <div style={S.expandLabel}>ENTRIES ({r.entries.length})</div>
                    {r.entries.length === 0 ? (
                      <div style={{ fontSize: 11, color: T.muted }}>none logged in this window yet</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {[...r.entries].reverse().map((e) => (
                          <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }} className="tnum">
                            <span style={{ color: T.muted }}>{fmtDate(e.date)} · {e.source}</span>
                            <span style={{ color: T.green, fontWeight: 700 }}>+{fmt(e.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function MiniGoalCard({ data: g, fund, fundBal, appData }) {
  const [open, setOpen] = useState(false);
  const pct = Math.min(100, Math.round((fundBal / g.target) * 100));
  const remaining = Math.max(0, g.target - fundBal);
  const netProfitNeeded = fund && fund.pct > 0 ? remaining / (fund.pct / 100) : 0;
  const salesNeeded = netProfitNeeded / (MARGIN_PCT / 100);

  return (
    <div style={{ ...S.miniGoalCard, cursor: "pointer" }} className="npop-flat" onClick={() => setOpen((s) => !s)}>
      <div style={S.miniGoalTop}>
        <span style={S.miniGoalName}>{g.name.toUpperCase()}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: fund?.color }} className="tnum">{pct}%</span>
      </div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }} className="tnum">{fmt(fundBal)} / {fmt(g.target)}</div>
      <div style={{ ...S.progressTrack, marginTop: 6 }}>
        <div style={{ ...S.progressFill, width: `${pct}%`, background: fund?.color }} />
      </div>
      <div style={{ fontSize: 10.5, color: T.muted, marginTop: 6 }} className="tnum">{remaining > 0 ? `${fmt(remaining)} LEFT` : "REACHED"}</div>

      {open && remaining > 0 && (
        <div style={S.expandPanel} onClick={(e) => e.stopPropagation()}>
          <div style={S.expandLabel}>HOW TO REACH IT</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {smartReachTips(salesNeeded, appData ? computeAvgSale(appData) : null).map((t) => (
              <div key={t.count} style={{ fontSize: 11.5, color: T.ivory }} className="tnum">
                → {t.count} SALE{t.count > 1 ? "S" : ""} OF ~{fmt(t.each)} REVENUE{t.count > 1 ? " EACH" : ""}
              </div>
            ))}
          </div>
          {appData && (
            <AITipBlock
              prompt={`Act as a sharp, encouraging business coach. My "${g.name}" goal needs ₹${remaining} more (via the ${fund?.name} fund). ${buildContext(appData)} Based on my actual patterns above, give me 2-3 short, specific, actionable sentences on the fastest realistic way to hit this. Be direct and concrete, not generic.`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Tilt3DCard({ src, onRemove }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const ref = useRef(null);

  const handleMove = (clientX, clientY) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width - 0.5;
    const py = (clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: py * -22, y: px * 22 });
  };

  return (
    <div
      ref={ref}
      style={{ ...S.tiltCardWrap }}
      onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
      onMouseLeave={() => setTilt({ x: 0, y: 0 })}
      onTouchMove={(e) => { const t = e.touches[0]; if (t) handleMove(t.clientX, t.clientY); }}
      onTouchEnd={() => setTilt({ x: 0, y: 0 })}
    >
      <div
        style={{
          ...S.tiltCardInner,
          transform: `perspective(700px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale3d(1.02,1.02,1.02)`,
        }}
      >
        <img src={src} alt="item" style={S.tiltCardImg} />
        <div style={{ ...S.tiltCardShine, background: `radial-gradient(circle at ${50 + tilt.y * 1.5}% ${50 + tilt.x * 1.5}%, rgba(255,255,255,0.25), transparent 60%)` }} />
      </div>
      {onRemove && (
        <button style={S.tiltRemoveBtn} onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <Trash2 size={12} color={T.ivory} />
        </button>
      )}
    </div>
  );
}

function DreamGoalCard({ data, persist, goal, fundId, label }) {
  const [open, setOpen] = useState(false);
  const fund = data.funds.find((f) => f.id === fundId);

  const handlePhotoUpload = (e, goalId) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      persist({ ...data, goals: data.goals.map((g) => (g.id === goalId ? { ...g, photo: reader.result } : g)) });
    };
    reader.readAsDataURL(file);
  };
  const removePhoto = (goalId) => {
    persist({ ...data, goals: data.goals.map((g) => (g.id === goalId ? { ...g, photo: null } : g)) });
  };

  if (!goal) {
    return (
      <div style={{ ...S.nextUpCard, boxShadow: `4px 4px 0px ${fund.color}`, opacity: 0.7 }}>
        <div style={{ ...S.nextUpLabel, color: fund.color }}>{label} DREAM GOAL</div>
        <div style={{ fontSize: 14, color: T.muted, marginTop: 6 }}>no dream set yet — add one in the Goals tab</div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }} className="tnum">fund balance: {fmt(data.fundBalances[fundId] || 0)}</div>
      </div>
    );
  }
  const bal = data.fundBalances[fundId] || 0;
  const pct = Math.min(100, Math.round((bal / goal.target) * 100));
  const remaining = Math.max(0, goal.target - bal);
  const daysLeft = goal.targetDate ? daysBetween(todayISO(), goal.targetDate) : null;
  const daily = daysLeft && remaining > 0 ? remaining / daysLeft : null;
  const netProfitNeeded = fund.pct > 0 ? remaining / (fund.pct / 100) : 0;
  const salesNeeded = netProfitNeeded / (MARGIN_PCT / 100);
  const todayGrowth = todayFundGrowth(data, fundId);
  const paceDays = daysAtPace(remaining, todayGrowth);

  return (
    <div style={{ ...S.nextUpCard, boxShadow: `4px 4px 0px ${fund.color}`, cursor: "pointer" }} className="npop-flat" onClick={() => setOpen((s) => !s)}>
      <div style={{ ...S.nextUpLabel, color: fund.color, justifyContent: "space-between" }}>
        <span><Pin size={11} color={fund.color} /> {label} DREAM GOAL</span>
        {daysLeft !== null && remaining > 0 && <span style={{ ...S.daysLeftChip, borderColor: fund.color, color: fund.color }} className="tnum">{daysLeft}D LEFT</span>}
      </div>
      {goal.country && <div style={{ fontSize: 44, marginBottom: 4 }}>{countryFlag(goal.country)}</div>}

      {fundId === "shopping" && (
        goal.photo ? (
          <div onClick={(e) => e.stopPropagation()}>
            <Tilt3DCard src={goal.photo} onRemove={() => removePhoto(goal.id)} />
          </div>
        ) : (
          <label style={S.photoUploadBtn} onClick={(e) => e.stopPropagation()}>
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handlePhotoUpload(e, goal.id)} />
            📷 ADD PHOTO — TILT TO VIEW
          </label>
        )
      )}

      <div style={S.nextUpName}>{goal.name}</div>
      <div style={S.progressTrack}>
        <div style={{ ...S.progressFill, width: `${pct}%`, background: fund.color }} />
      </div>
      <div style={S.nextUpRow}>
        <span style={{ color: T.muted, fontSize: 12 }} className="tnum">{fmt(bal)} / {fmt(goal.target)}</span>
        <span style={{ color: fund.color, fontSize: 17, fontWeight: 700 }} className="tnum">{pct}%</span>
      </div>
      <div style={{ ...S.nextUpDaily, color: fund.color, borderColor: fund.color }} className="tnum">
        {fmt(remaining)} LEFT{daily ? ` · TODAY'S NUMBER: ${fmt(daily)}` : ""}
      </div>
      {remaining > 0 && (
        <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }} className="tnum">
          = {notes500(remaining).toLocaleString("en-IN")} × ₹500 NOTES
        </div>
      )}
      {remaining > 0 && paceDays !== null && (
        <div style={{ fontSize: 11, color: T.green, marginTop: 6, fontWeight: 700 }} className="tnum">
          AT TODAY'S PACE (₹{Math.round(todayGrowth)}/day) → ~{paceDays} DAYS
        </div>
      )}
      {goal.targetDate && <div style={S.nextUpDate}>TARGET: {fmtDate(goal.targetDate)}</div>}

      {open && remaining > 0 && (
        <div style={S.expandPanel} onClick={(e) => e.stopPropagation()}>
          {goal.targetDate && (
            <GoalTimeline targetDate={goal.targetDate} remaining={remaining} netProfitNeeded={netProfitNeeded} salesNeeded={salesNeeded} />
          )}
          <div style={S.expandLabel}>HOW TO REACH IT (~{MARGIN_PCT}% MARGIN)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {smartReachTips(salesNeeded, computeAvgSale(data)).map((t) => (
              <div key={t.count} style={{ fontSize: 11.5, color: T.ivory }} className="tnum">
                → {t.count} SALE{t.count > 1 ? "S" : ""} OF ~{fmt(t.each)} REVENUE{t.count > 1 ? " EACH" : ""}
              </div>
            ))}
          </div>
          <AITipBlock
            prompt={`Act as a sharp, encouraging business coach. My "${goal.name}" dream goal needs ₹${remaining} more (via the ${fund.name} fund, ${fund.pct}% of profit, ~${MARGIN_PCT}% margin)${goal.targetDate ? `, by ${goal.targetDate}` : ""}. Today so far this fund has grown by ₹${Math.round(todayGrowth)}; at that daily pace it would take ${paceDays ?? "many"} days. ${buildContext(data)} Based on my actual patterns above, tell me: (1) confirm the at-current-pace day count in one line, (2) ONE specific accelerated recommendation naming a concrete action (e.g. sell N more of a specific item/category via a specific channel) with an estimated profit boost for today, and (3) the revised days-to-target if that's done. Keep it to 3-4 short, punchy sentences, format like: "At this pace: X days. Recommendation: sell N more [items] via [channel] to add ₹Y today. That would cut it to Z days." Be concrete with real numbers from my data, not generic.`}
          />
        </div>
      )}
    </div>
  );
}

/* ---------------- Income ---------------- */

function IncomeTab({ data, persist, registerActivity, setToast, triggerNoteAnim }) {
  const [form, setForm] = useState({ amount: "", source: INCOME_SOURCES[0], note: "", date: todayISO(), account: "none" });
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState(null);

  const sorted = useMemo(() => {
    const s = [...data.income].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    if (!search.trim()) return s;
    const q = search.trim().toLowerCase();
    return s.filter((e) => e.source.toLowerCase().includes(q) || (e.note || "").toLowerCase().includes(q));
  }, [data.income, search]);
  const thisMonthTotal = useMemo(
    () => data.income.filter((e) => monthKey(e.date) === currentMonthKey()).reduce((s, e) => s + e.amount, 0),
    [data.income]
  );

  const addEntry = () => {
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return;
    const fundDelta = {};
    const fundBalances = { ...data.fundBalances };
    data.funds.forEach((f) => {
      const share = Math.round((amt * f.pct) / 100);
      fundDelta[f.id] = share;
      fundBalances[f.id] = (fundBalances[f.id] || 0) + share;
    });
    const entry = { id: Date.now(), amount: amt, source: form.source, note: form.note.trim(), date: form.date, fundDelta };
    let next = { ...data, income: [...data.income, entry], fundBalances };
    next = registerActivity(next, 5);
    next = withAccountMovement(next, form.account, "in", amt, `Income — ${form.source}`, form.date);
    persist(next);
    triggerNoteAnim(amt, "in");
    setForm({ ...form, amount: "", note: "" });
    setShowForm(false);
    setToast(form.account !== "none" ? `+5 XP · ${form.account.toUpperCase()} UPDATED` : "+5 XP · FUNDS UPDATED");
    setTimeout(() => setToast(null), 1400);
  };
  const removeEntry = (id) => {
    const entry = data.income.find((e) => e.id === id);
    const fundBalances = { ...data.fundBalances };
    if (entry?.fundDelta) {
      Object.entries(entry.fundDelta).forEach(([fid, amt]) => {
        fundBalances[fid] = (fundBalances[fid] || 0) - amt;
      });
    }
    persist({ ...data, income: data.income.filter((e) => e.id !== id), fundBalances });
  };

  const startEdit = (e) => {
    setEditingId(e.id);
    setEditValues({ amount: String(e.amount), source: e.source, note: e.note || "", date: e.date });
  };
  const saveEdit = () => {
    const amt = parseFloat(editValues.amount);
    if (!amt || amt <= 0) return;
    const entry = data.income.find((e) => e.id === editingId);
    const newDelta = fundDeltaForAmount(data.funds, amt, 1);
    const fundBalances = swapFundDelta(data.fundBalances, entry.fundDelta, newDelta);
    const income = data.income.map((e) =>
      e.id === editingId ? { ...e, amount: amt, source: editValues.source, note: editValues.note.trim(), date: editValues.date, fundDelta: newDelta } : e
    );
    persist({ ...data, income, fundBalances });
    setEditingId(null);
    setEditValues(null);
  };

  return (
    <div>
      <div style={S.heroCard}>
        <div style={S.heroLabel}>INCOME THIS MONTH</div>
        <div style={{ ...S.heroNum, color: T.green }} className="tnum">{fmt(thisMonthTotal)}</div>
      </div>

      <div style={S.sectionHeadRow}>
        <SectionLabel text={`ENTRIES — ${sorted.length}`} noMargin />
        <button style={S.addBtn} className="npop" onClick={() => setShowForm((s) => !s)}>
          {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? "CANCEL" : "ADD INCOME"}
        </button>
      </div>

      <input type="text" placeholder="🔍 search source or note…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, width: "100%", marginTop: 8 }} />

      {showForm && (
        <div style={S.formCard}>
          <div style={S.formRow}>
            <AmountInput placeholder="amount" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} style={S.input} className="tnum" />
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={S.input} className="tnum" />
          </div>
          <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} style={S.select}>
            {INCOME_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} style={S.select}>
            {ACCOUNT_OPTIONS_IN.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <input type="text" placeholder="note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ ...S.input, width: "100%" }} />
          <button style={S.submitBtnGreen} className="npop" onClick={addEntry}>SAVE INCOME</button>
        </div>
      )}

      <div style={S.ledger}>
        {sorted.length === 0 && <EmptyNote text="no income logged yet" />}
        {sorted.map((e) => (
          <div key={e.id} style={S.ledgerRow}>
            <div style={S.ledgerDate}>{fmtDateShort(e.date)}</div>
            <div style={S.ledgerMain}>
              <div style={S.ledgerCategory}>{e.source}</div>
              {e.note && <div style={S.ledgerNote}>{e.note}</div>}
            </div>
            <div style={{ ...S.ledgerAmt, color: T.green }} className="tnum">+{fmt(e.amount)}</div>
            <button style={S.editBtn} onClick={() => startEdit(e)}><Pencil size={12} color={T.muted} /></button>
            <button style={S.deleteBtn} onClick={() => removeEntry(e.id)}><Trash2 size={13} color={T.muted} /></button>
          </div>
        ))}
      </div>

      {editingId && editValues && (
        <EditEntryModal
          title="EDIT INCOME"
          values={editValues}
          onChange={(key, val) => setEditValues({ ...editValues, [key]: val })}
          onSave={saveEdit}
          onCancel={() => { setEditingId(null); setEditValues(null); }}
          fields={[
            { key: "amount", type: "amount", label: "amount" },
            { key: "date", type: "date", label: "date" },
            { key: "source", type: "select", label: "source", options: INCOME_SOURCES },
            { key: "note", type: "text", label: "note (optional)" },
          ]}
        />
      )}
    </div>
  );
}

/* ---------------- Expense ---------------- */

function FixedExpensesSection({ data, persist, registerActivity, setToast, triggerNoteAnim }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", amount: "", category: EXPENSE_CATEGORIES[0], dueDay: "" });

  const cur = currentMonthKey();

  const addFixed = () => {
    const amt = parseFloat(form.amount);
    if (!form.name.trim() || !amt || amt <= 0) return;
    const fe = { id: Date.now(), name: form.name.trim(), amount: amt, category: form.category, dueDay: form.dueDay ? parseInt(form.dueDay, 10) : null };
    persist({ ...data, fixedExpenses: [...data.fixedExpenses, fe] });
    setForm({ name: "", amount: "", category: EXPENSE_CATEGORIES[0], dueDay: "" });
    setShowForm(false);
  };
  const removeFixed = (id) => persist({ ...data, fixedExpenses: data.fixedExpenses.filter((f) => f.id !== id) });

  const isPaidThisMonth = (feId) => data.expenses.some((e) => e.fixedExpenseId === feId && monthKey(e.date) === cur);

  const markPaid = (fe) => {
    const fundDelta = {};
    const fundBalances = { ...data.fundBalances };
    data.funds.forEach((f) => {
      const share = Math.round((fe.amount * f.pct) / 100);
      fundDelta[f.id] = -share;
      fundBalances[f.id] = (fundBalances[f.id] || 0) - share;
    });
    const entry = { id: Date.now(), amount: fe.amount, category: fe.category, note: fe.name, date: todayISO(), unnecessary: false, fine: 0, fundDelta, fixedExpenseId: fe.id };
    let next = registerActivity({ ...data, expenses: [...data.expenses, entry], fundBalances }, 3);
    persist(next);
    triggerNoteAnim(fe.amount, "out");
    setToast(`${fe.name.toUpperCase()} MARKED PAID`);
    setTimeout(() => setToast(null), 1400);
  };

  const totalFixed = data.fixedExpenses.reduce((s, f) => s + f.amount, 0);
  const paidFixed = data.fixedExpenses.filter((f) => isPaidThisMonth(f.id)).reduce((s, f) => s + f.amount, 0);

  return (
    <>
      <div style={S.sectionHeadRow}>
        <SectionLabel text="FIXED EXPENSES — MONTHLY" noMargin />
        <button style={S.addBtn} className="npop" onClick={() => setShowForm((s) => !s)}>
          {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? "CANCEL" : "ADD FIXED"}
        </button>
      </div>

      {data.fixedExpenses.length > 0 && (
        <div style={{ fontSize: 10.5, color: T.muted, marginBottom: 8 }} className="tnum">
          {fmt(paidFixed)} PAID OF {fmt(totalFixed)} THIS MONTH
        </div>
      )}

      {showForm && (
        <div style={S.formCard}>
          <input type="text" placeholder="name — e.g. Rent, Netflix, EMI" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...S.input, width: "100%" }} />
          <div style={S.formRow}>
            <AmountInput placeholder="monthly amount" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} style={S.input} className="tnum" />
            <input type="number" placeholder="due day (1-31)" value={form.dueDay} onChange={(e) => setForm({ ...form, dueDay: e.target.value })} style={{ ...S.input, maxWidth: 90 }} className="tnum" />
          </div>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={S.select}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button style={S.submitBtnOrange} className="npop" onClick={addFixed}>SAVE FIXED EXPENSE</button>
        </div>
      )}

      {data.fixedExpenses.length === 0 ? (
        <EmptyNote text="add rent, EMIs, subscriptions — anything that repeats every month" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
          {data.fixedExpenses.map((fe) => {
            const paid = isPaidThisMonth(fe.id);
            return (
              <div key={fe.id} style={{ ...S.statBox, boxShadow: `3px 3px 0px ${paid ? T.green : T.orange}`, position: "relative" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingRight: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.ivory }}>{fe.name.toUpperCase()}</div>
                    <div style={{ fontSize: 9.5, color: T.muted, marginTop: 2 }}>{fe.category}{fe.dueDay ? ` · DUE DAY ${fe.dueDay}` : ""}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: paid ? T.green : T.orange }} className="tnum">{fmt(fe.amount)}</div>
                    {paid ? (
                      <div style={{ fontSize: 9, color: T.green, fontWeight: 700, marginTop: 2 }}>PAID ✓</div>
                    ) : (
                      <button style={{ ...S.correctionLink, marginTop: 4 }} onClick={() => markPaid(fe)}>MARK PAID</button>
                    )}
                  </div>
                </div>
                <button style={{ ...S.deleteBtn, position: "absolute", top: 6, right: 6 }} onClick={() => removeFixed(fe.id)}><Trash2 size={11} color={T.muted} /></button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function ExpenseTab({ data, persist, registerActivity, setToast, triggerNoteAnim }) {
  const [entryType, setEntryType] = useState("expense"); // expense | waste | sold_order | inventory_cashout
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState(null);
  const [form, setForm] = useState({
    amount: "", category: EXPENSE_CATEGORIES[0], note: "", date: todayISO(), wasteType: WASTE_TYPES[0], account: "none",
    itemName: "", qty: "", saleValue: "", expectedProfit: "", moneyReceived: "", moneyDue: "", recipientName: "", expectedReceivableDate: "",
    itemValue: "", expectedSellingPrice: "", expectedArrival: "", photo: null,
  });

  const sorted = useMemo(() => {
    const s = [...data.expenses].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    if (!search.trim()) return s;
    const q = search.trim().toLowerCase();
    return s.filter((e) => e.category.toLowerCase().includes(q) || (e.note || "").toLowerCase().includes(q));
  }, [data.expenses, search]);
  const thisMonthTotal = useMemo(
    () => data.expenses.filter((e) => monthKey(e.date) === currentMonthKey()).reduce((s, e) => s + e.amount, 0),
    [data.expenses]
  );

  const resetForm = () => setForm({
    amount: "", category: EXPENSE_CATEGORIES[0], note: "", date: todayISO(), wasteType: WASTE_TYPES[0], account: "none",
    itemName: "", qty: "", saleValue: "", expectedProfit: "", moneyReceived: "", moneyDue: "", recipientName: "", expectedReceivableDate: "",
    itemValue: "", expectedSellingPrice: "", expectedArrival: "", photo: null,
  });

  const applyFundIncome = (amt) => {
    const fundDelta = {};
    const fundBalances = { ...data.fundBalances };
    data.funds.forEach((f) => {
      const share = Math.round((amt * f.pct) / 100);
      fundDelta[f.id] = share;
      fundBalances[f.id] = (fundBalances[f.id] || 0) + share;
    });
    return { fundDelta, fundBalances };
  };

  const addExpenseOrWaste = () => {
    const baseAmt = parseFloat(form.amount);
    if (!baseAmt || baseAmt <= 0) return;
    const isWaste = entryType === "waste";
    const fine = isWaste ? tieredFine(baseAmt) : 0;
    const amt = baseAmt + fine;
    const fundDelta = {};
    const fundBalances = { ...data.fundBalances };
    data.funds.forEach((f) => {
      const share = Math.round((amt * f.pct) / 100);
      fundDelta[f.id] = -share;
      fundBalances[f.id] = (fundBalances[f.id] || 0) - share;
    });
    const category = isWaste ? form.wasteType : form.category;
    const entry = {
      id: Date.now(), amount: amt, category, note: form.note.trim(),
      date: form.date, unnecessary: isWaste, fine, fundDelta, photo: form.photo || null,
    };
    let next = { ...data, expenses: [...data.expenses, entry], fundBalances };
    next = registerActivity(next, 3);
    next = withAccountMovement(next, form.account, "out", amt, `${isWaste ? "Waste" : "Expense"} — ${category}`, form.date);
    persist(next);
    triggerNoteAnim(amt, "out");
    resetForm();
    setShowForm(false);
    setToast(fine ? `LOGGED + ₹${fine} FINE` : form.account !== "none" ? `+3 XP · ${form.account.toUpperCase()} UPDATED` : "+3 XP · FUNDS UPDATED");
    setTimeout(() => setToast(null), 1600);
  };

  const addSoldOrder = () => {
    const profit = parseFloat(form.expectedProfit);
    if (!profit || profit <= 0) return;
    const due = parseFloat(form.moneyDue) || 0;
    const received = parseFloat(form.moneyReceived) || 0;
    const saleVal = parseFloat(form.saleValue) || 0;
    const profitPct = saleVal > 0 ? Math.round((profit / saleVal) * 1000) / 10 : null;
    const itemLabel = form.itemName ? `${form.itemName}${form.qty ? ` ×${form.qty}` : ""}` : null;
    const { fundDelta, fundBalances } = applyFundIncome(profit);
    const entry = {
      id: Date.now(), amount: profit, source: "Sold Order",
      note: `${itemLabel ? itemLabel + " — " : ""}${form.recipientName || "buyer"} — sale ₹${form.saleValue || 0}, received ₹${form.moneyReceived || 0}${profitPct !== null ? ` (${profitPct}% margin)` : ""}${form.note ? " — " + form.note.trim() : ""}`,
      date: form.date, fundDelta, itemName: form.itemName || null, qty: form.qty ? parseFloat(form.qty) : null,
    };
    let next = registerActivity({ ...data, income: [...data.income, entry], fundBalances }, 5);
    if (due > 0) {
      const receivable = {
        id: Date.now() + 1, party: form.recipientName || "buyer", amount: due,
        dueDate: form.expectedReceivableDate || null,
        note: `${itemLabel ? itemLabel + " — " : ""}Sold order — sale ₹${form.saleValue || 0}`, status: "pending",
      };
      next = { ...next, receivables: [...next.receivables, receivable] };
    }
    next = withAccountMovement(next, form.account, "in", received, `Sold order — ${itemLabel || form.recipientName || "buyer"}`, form.date);
    persist(next);
    triggerNoteAnim(profit, "in");
    resetForm();
    setShowForm(false);
    setToast(due > 0 ? `+5 XP · PROFIT LOGGED · ₹${due} MOVED TO RECEIVABLES` : "+5 XP · PROFIT LOGGED");
    setTimeout(() => setToast(null), 2000);
  };

  const addInventoryCashout = () => {
    const sellingPrice = parseFloat(form.expectedSellingPrice);
    if (!sellingPrice || sellingPrice <= 0) return;
    const itemLabel = form.itemName ? `${form.itemName}${form.qty ? ` ×${form.qty}` : ""}` : null;
    const investment = {
      id: Date.now(),
      name: itemLabel || form.note.trim() || "Inventory Cashout",
      amount: sellingPrice,
      date: form.date,
      itemValue: parseFloat(form.itemValue) || 0,
      expectedProfit: parseFloat(form.expectedProfit) || 0,
      expectedArrival: form.expectedArrival || null,
      itemName: form.itemName || null,
      qty: form.qty ? parseFloat(form.qty) : null,
      source: "inventory_cashout",
      account: form.account !== "none" ? form.account : null,
      investmentType: "Inventory Stock",
    };
    persist({ ...data, investments: [...data.investments, investment] });
    resetForm();
    setShowForm(false);
    setToast("LOGGED TO INVESTMENTS · PENDING ARRIVAL");
    setTimeout(() => setToast(null), 1800);
  };

  const removeEntry = (id) => {
    const entry = data.expenses.find((e) => e.id === id);
    const fundBalances = { ...data.fundBalances };
    if (entry?.fundDelta) {
      Object.entries(entry.fundDelta).forEach(([fid, amt]) => {
        fundBalances[fid] = (fundBalances[fid] || 0) - amt;
      });
    }
    persist({ ...data, expenses: data.expenses.filter((e) => e.id !== id), fundBalances });
  };

  const startEdit = (e) => {
    setEditingId(e.id);
    setEditValues({ amount: String(e.amount), category: e.category, note: e.note || "", date: e.date });
  };
  const saveEdit = () => {
    const amt = parseFloat(editValues.amount);
    if (!amt || amt <= 0) return;
    const entry = data.expenses.find((e) => e.id === editingId);
    const newDelta = fundDeltaForAmount(data.funds, amt, -1);
    const fundBalances = swapFundDelta(data.fundBalances, entry.fundDelta, newDelta);
    const category = editValues.category.trim() || entry.category;
    const expenses = data.expenses.map((e) =>
      e.id === editingId ? { ...e, amount: amt, category, note: editValues.note.trim(), date: editValues.date, fundDelta: newDelta } : e
    );
    // pool-linked expenses are mirrored inside expensePools[].entries — keep that copy in sync
    const expensePools = entry.poolId
      ? data.expensePools.map((p) =>
          p.id === entry.poolId
            ? { ...p, entries: p.entries.map((pe) => (pe.linkedExpenseId === entry.id ? { ...pe, amount: amt, date: editValues.date, note: editValues.note.trim() } : pe)) }
            : p
        )
      : data.expensePools;
    persist({ ...data, expenses, expensePools, fundBalances });
    setEditingId(null);
    setEditValues(null);
  };

  const TYPE_TABS = [
    { id: "expense", label: "EXPENSE", color: T.orange },
    { id: "waste", label: "WASTE", color: T.purple },
    { id: "sold_order", label: "SOLD ORDER", color: T.green },
    { id: "inventory_cashout", label: "CASHOUT", color: T.green },
  ];

  return (
    <div>
      <div style={S.heroCard}>
        <div style={S.heroLabel}>EXPENSE THIS MONTH</div>
        <div style={{ ...S.heroNum, color: T.orange }} className="tnum">{fmt(thisMonthTotal)}</div>
      </div>

      <div style={S.sectionHeadRow}>
        <SectionLabel text={`ENTRIES — ${sorted.length}`} noMargin />
        <button style={S.addBtn} className="npop" onClick={() => setShowForm((s) => !s)}>
          {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? "CANCEL" : "ADD"}
        </button>
      </div>

      <input type="text" placeholder="🔍 search category or note…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, width: "100%", marginTop: 8 }} />

      {showForm && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {TYPE_TABS.map((t) => (
              <button
                key={t.id}
                style={{ ...S.miniTypeBtn, borderColor: t.color, color: entryType === t.id ? T.bg : t.color, background: entryType === t.id ? t.color : "none" }}
                className="npop-flat"
                onClick={() => setEntryType(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={S.formCard}>
            {(entryType === "expense" || entryType === "waste") && (
              <>
                <div style={S.formRow}>
                  <AmountInput placeholder="amount" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} style={S.input} className="tnum" />
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={S.input} className="tnum" />
                </div>
                {entryType === "waste" ? (
                  <select value={form.wasteType} onChange={(e) => setForm({ ...form, wasteType: e.target.value })} style={S.select}>
                    {WASTE_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={S.select}>
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                <select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} style={S.select}>
                  {ACCOUNT_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
                {entryType === "waste" && <div style={{ fontSize: 10, color: T.muted }}>₹200 FINE UNDER ₹100, ELSE ₹1000</div>}
                <input type="text" placeholder="note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ ...S.input, width: "100%" }} />
                {form.photo ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <img src={form.photo} alt="receipt" style={{ width: 44, height: 44, objectFit: "cover", border: `1.5px solid ${T.line}` }} />
                    <button style={S.correctionLink} onClick={() => setForm({ ...form, photo: null })}>REMOVE RECEIPT</button>
                  </div>
                ) : (
                  <label style={{ ...S.photoUploadBtn, marginBottom: 0, padding: "10px 8px" }}>
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => setForm({ ...form, photo: reader.result });
                      reader.readAsDataURL(file);
                    }} />
                    📷 ATTACH RECEIPT (OPTIONAL)
                  </label>
                )}
                <button style={entryType === "waste" ? S.submitBtnPurple : S.submitBtnOrange} className="npop" onClick={addExpenseOrWaste}>SAVE</button>
              </>
            )}

            {entryType === "sold_order" && (
              <>
                <div style={{ fontSize: 10, color: T.muted, marginBottom: 2 }}>THIS LOGS AS PROFIT — NOT AN EXPENSE</div>
                <div style={S.formRow}>
                  <input type="text" placeholder="item name" value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} style={S.input} />
                  <input type="number" placeholder="qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} style={{ ...S.input, maxWidth: 70 }} className="tnum" />
                </div>
                <div style={S.formRow}>
                  <AmountInput placeholder="sale value" value={form.saleValue} onChange={(v) => setForm({ ...form, saleValue: v })} style={S.input} className="tnum" />
                  <AmountInput placeholder="expected profit" value={form.expectedProfit} onChange={(v) => setForm({ ...form, expectedProfit: v })} style={S.input} className="tnum" />
                </div>
                <div style={S.formRow}>
                  <AmountInput placeholder="money received" value={form.moneyReceived} onChange={(v) => setForm({ ...form, moneyReceived: v })} style={S.input} className="tnum" />
                  <AmountInput placeholder="money due" value={form.moneyDue} onChange={(v) => setForm({ ...form, moneyDue: v })} style={S.input} className="tnum" />
                </div>
                <select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} style={S.select}>
                  {ACCOUNT_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.id === "none" ? a.label : `MONEY RECEIVED → ${a.label}`}</option>)}
                </select>
                <input type="text" placeholder="recipient's name" value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} style={{ ...S.input, width: "100%" }} />
                <input type="date" placeholder="expected receivable date" value={form.expectedReceivableDate} onChange={(e) => setForm({ ...form, expectedReceivableDate: e.target.value })} style={{ ...S.input, width: "100%" }} className="tnum" />
                <input type="text" placeholder="note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ ...S.input, width: "100%" }} />
                <button style={S.submitBtnGreen} className="npop" onClick={addSoldOrder}>SAVE SOLD ORDER</button>
              </>
            )}

            {entryType === "inventory_cashout" && (
              <>
                <div style={{ fontSize: 10, color: T.muted, marginBottom: 2 }}>LOGS TO INVESTMENTS — NOT PROFIT, NOT AN EXPENSE</div>
                <div style={S.formRow}>
                  <input type="text" placeholder="item name" value={form.itemName} onChange={(e) => setForm({ ...form, itemName: e.target.value })} style={S.input} />
                  <input type="number" placeholder="qty" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} style={{ ...S.input, maxWidth: 70 }} className="tnum" />
                </div>
                <div style={S.formRow}>
                  <AmountInput placeholder="item value" value={form.itemValue} onChange={(v) => setForm({ ...form, itemValue: v })} style={S.input} className="tnum" />
                  <AmountInput placeholder="expected selling price" value={form.expectedSellingPrice} onChange={(v) => setForm({ ...form, expectedSellingPrice: v })} style={S.input} className="tnum" />
                </div>
                <div style={S.formRow}>
                  <AmountInput placeholder="expected profit" value={form.expectedProfit} onChange={(v) => setForm({ ...form, expectedProfit: v })} style={S.input} className="tnum" />
                  <input type="date" placeholder="expected date of arrival" value={form.expectedArrival} onChange={(e) => setForm({ ...form, expectedArrival: e.target.value })} style={S.input} className="tnum" />
                </div>
                <select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} style={S.select}>
                  {ACCOUNT_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.id === "none" ? a.label : `WILL ARRIVE IN → ${a.label}`}</option>)}
                </select>
                <div style={{ fontSize: 9.5, color: T.muted }}>ACCOUNT ONLY UPDATES ONCE THE MONEY ACTUALLY ARRIVES — NOT YET</div>
                <input type="text" placeholder="note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ ...S.input, width: "100%" }} />
                <button style={S.submitBtnPurple} className="npop" onClick={addInventoryCashout}>SAVE CASHOUT</button>
              </>
            )}
          </div>
        </>
      )}

      <FixedExpensesSection data={data} persist={persist} registerActivity={registerActivity} setToast={setToast} triggerNoteAnim={triggerNoteAnim} />

      <div style={S.ledger}>
        {sorted.length === 0 && <EmptyNote text="no expenses logged yet" />}
        {sorted.map((e) => (
          <div key={e.id} style={S.ledgerRow}>
            {e.photo && <img src={e.photo} alt="receipt" style={{ width: 30, height: 30, objectFit: "cover", border: `1px solid ${T.line}`, flexShrink: 0 }} />}
            <div style={S.ledgerDate}>{fmtDateShort(e.date)}</div>
            <div style={S.ledgerMain}>
              <div style={S.ledgerCategory}>{e.category} {e.unnecessary && <span style={S.fineTag}>WASTE</span>}</div>
              {e.note && <div style={S.ledgerNote}>{e.note}</div>}
            </div>
            <div style={{ ...S.ledgerAmt, color: T.orange }} className="tnum">−{fmt(e.amount)}</div>
            <button style={S.editBtn} onClick={() => startEdit(e)}><Pencil size={12} color={T.muted} /></button>
            <button style={S.deleteBtn} onClick={() => removeEntry(e.id)}><Trash2 size={13} color={T.muted} /></button>
          </div>
        ))}
      </div>

      {editingId && editValues && (
        <EditEntryModal
          title="EDIT EXPENSE"
          values={editValues}
          onChange={(key, val) => setEditValues({ ...editValues, [key]: val })}
          onSave={saveEdit}
          onCancel={() => { setEditingId(null); setEditValues(null); }}
          fields={[
            { key: "amount", type: "amount", label: "amount" },
            { key: "date", type: "date", label: "date" },
            { key: "category", type: "text", label: "category" },
            { key: "note", type: "text", label: "note (optional)" },
          ]}
        />
      )}
    </div>
  );
}

/* ---------------- Funds ---------------- */

function FundsTab({ data, persist }) {
  const [editingPct, setEditingPct] = useState(false);
  const [draftFunds, setDraftFunds] = useState(data.funds);
  const [correctingId, setCorrectingId] = useState(null);
  const [correctionVal, setCorrectionVal] = useState("");
  const [expandedFund, setExpandedFund] = useState(null);

  const cur = currentMonthKey();
  const liveIncome = data.income.filter((e) => monthKey(e.date) === cur).reduce((s, e) => s + e.amount, 0);
  const liveExpense = data.expenses.filter((e) => monthKey(e.date) === cur).reduce((s, e) => s + e.amount, 0);
  const liveNet = liveIncome - liveExpense;
  const totalPct = draftFunds.reduce((s, f) => s + Number(f.pct || 0), 0);

  const savePcts = () => {
    if (totalPct !== 100) return;
    persist({ ...data, funds: draftFunds });
    setEditingPct(false);
  };

  const applyCorrection = (fundId) => {
    const val = parseFloat(correctionVal);
    if (!val) { setCorrectingId(null); return; }
    const fundBalances = { ...data.fundBalances, [fundId]: (data.fundBalances[fundId] || 0) + val };
    persist({ ...data, fundBalances });
    setCorrectingId(null);
    setCorrectionVal("");
  };

  const history = [...data.auditedMonths].sort((a, b) => b.month.localeCompare(a.month));

  return (
    <div>
      <div style={S.heroCard}>
        <div style={S.heroLabel}>THIS MONTH, LIVE</div>
        <div style={{ ...S.heroNum, color: liveNet >= 0 ? T.ivory : T.orange }} className="tnum">{fmtSigned(liveNet)}</div>
        <div style={S.heroSub} className="tnum">{fmt(liveIncome)} IN · {fmt(liveExpense)} OUT — FUNDS ALREADY REFLECT THIS</div>
      </div>

      <div style={S.sectionHeadRow}>
        <SectionLabel text="FUND BALANCES" noMargin />
        <button style={S.addBtn} className="npop" onClick={() => { setDraftFunds(data.funds); setEditingPct((s) => !s); }}>
          {editingPct ? <X size={14} /> : <Settings2 size={14} />} {editingPct ? "CANCEL" : "EDIT %"}
        </button>
      </div>

      {editingPct && (
        <div style={S.formCard}>
          {draftFunds.map((f, i) => (
            <div key={f.id} style={S.pctRow}>
              <span style={{ ...S.pctDot, background: f.color }} />
              <span style={S.pctName}>{f.name}</span>
              <input
                type="number"
                value={f.pct}
                onChange={(e) => {
                  const next = [...draftFunds];
                  next[i] = { ...f, pct: e.target.value };
                  setDraftFunds(next);
                }}
                style={S.pctInput}
                className="tnum"
              />
              <span style={{ color: T.muted, fontSize: 12 }}>%</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <span style={{ fontSize: 11.5, color: totalPct === 100 ? T.green : T.orange }} className="tnum">
              TOTAL: {totalPct}% {totalPct !== 100 && "— MUST EQUAL 100"}
            </span>
            <button style={{ ...S.submitBtnGreen, padding: "8px 14px", opacity: totalPct === 100 ? 1 : 0.4 }} className="npop" onClick={savePcts} disabled={totalPct !== 100}>
              <Check size={13} /> SAVE
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
        {data.funds.map((f) => {
          const isOpen = expandedFund === f.id;
          const contributingIncome = data.income.filter((e) => e.fundDelta?.[f.id]);
          const contributingExpense = data.expenses.filter((e) => e.fundDelta?.[f.id]);
          const recent = [...contributingIncome.map((e) => ({ ...e, kind: "in" })), ...contributingExpense.map((e) => ({ ...e, kind: "out" }))]
            .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
            .slice(0, 6);
          return (
            <div key={f.id} style={{ ...S.fundCard, boxShadow: `4px 4px 0px ${f.color}`, cursor: "pointer" }} className="npop-flat" onClick={() => setExpandedFund(isOpen ? null : f.id)}>
              <div style={S.fundTop}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ ...S.pctDot, background: f.color }} />
                  <span style={S.budgetName}>{f.name.toUpperCase()}</span>
                </div>
                <span style={{ fontSize: 11, color: T.muted }} className="tnum">{f.pct}%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <div style={{ ...S.fundBalance, color: f.color }} className="tnum">{fmt(data.fundBalances[f.id] || 0)}</div>
                {correctingId === f.id ? (
                  <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <AmountInput autoFocus placeholder="±amount" value={correctionVal} onChange={(v) => setCorrectionVal(v)} style={{ ...S.pctInput, width: 74 }} className="tnum" />
                    <button style={S.smallToggle} onClick={() => applyCorrection(f.id)}><Check size={12} color={T.green} /></button>
                  </div>
                ) : (
                  <button style={S.correctionLink} onClick={(e) => { e.stopPropagation(); setCorrectingId(f.id); setCorrectionVal(""); }}>ADJUST</button>
                )}
              </div>

              {isOpen && (
                <div style={S.expandPanel} onClick={(e) => e.stopPropagation()}>
                  <div style={S.expandLabel}>RECENT CONTRIBUTING ENTRIES</div>
                  {recent.length === 0 ? (
                    <div style={{ fontSize: 11, color: T.muted }}>nothing yet</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {recent.map((e) => (
                        <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }} className="tnum">
                          <span style={{ color: T.muted }}>{fmtDate(e.date)} · {e.kind === "in" ? e.source : e.category}</span>
                          <span style={{ color: e.kind === "in" ? T.green : T.orange, fontWeight: 700 }}>
                            {e.fundDelta[f.id] >= 0 ? "+" : ""}{fmt(e.fundDelta[f.id])}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <AITipBlock
                    prompt={`Act as a sharp financial advisor. This is my "${f.name}" fund (${f.pct}% of monthly net profit), current balance ₹${data.fundBalances[f.id] || 0}. ${buildContext(data)} Based on the actual patterns above, give me 2-3 short, specific sentences on whether this fund's allocation % looks right and how I'm using it. Be direct and concrete, not generic.`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <SectionLabel text="MONTHLY AUDIT LOG" />
      <div style={{ fontSize: 11, color: T.muted, marginBottom: 8, marginTop: -6 }}>FUNDS UPDATE LIVE PER ENTRY — THIS IS THE RECORD OF WHAT CLOSED EACH MONTH</div>
      {history.length === 0 ? (
        <EmptyNote text="once a month completes, its audit summary shows up here" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {history.map((h) => (
            <div key={h.month} style={S.historyCard}>
              <div style={S.historyTop}>
                <span style={S.budgetName}>{monthLabel(h.month).toUpperCase()}</span>
                <span style={{ color: h.netProfit >= 0 ? T.green : T.orange, fontSize: 13, fontWeight: 700 }} className="tnum">
                  {fmtSigned(h.netProfit)}
                </span>
              </div>
              <div style={S.historyAllocRow}>
                {data.funds.map((f) => (
                  <span key={f.id} style={{ fontSize: 10.5, color: T.muted }} className="tnum">
                    {f.name.split(" ")[0]}: <span style={{ color: f.color }}>{fmt(h.allocated[f.id] || 0)}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Goals ---------------- */

function GoalsTab({ data, persist }) {
  const [form, setForm] = useState({ name: "", target: "", fundId: data.funds[0].id, targetDate: "", country: "", letter: "" });
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const addGoal = () => {
    const t = parseFloat(form.target);
    if (!form.name.trim() || !t || t <= 0) return;
    const goal = { id: Date.now(), name: form.name.trim(), target: t, fundId: form.fundId, targetDate: form.targetDate || null, country: form.country || null, letter: form.letter.trim() || null, priority: data.goals.length === 0 };
    persist({ ...data, goals: [...data.goals, goal] });
    setForm({ name: "", target: "", fundId: data.funds[0].id, targetDate: "", country: "", letter: "" });
    setShowForm(false);
  };
  const removeGoal = (id) => persist({ ...data, goals: data.goals.filter((g) => g.id !== id) });
  const setPriority = (id) => persist({ ...data, goals: data.goals.map((g) => ({ ...g, priority: g.id === id })) });

  return (
    <div>
      <SectionLabel text="GOALS" noMargin />
      <div style={S.sectionHeadRow}>
        <span style={{ fontSize: 11, color: T.muted }}>PIN ONE AS "NEXT UP" · TAP A GOAL FOR TIPS</span>
        <button style={S.addBtn} className="npop" onClick={() => setShowForm((s) => !s)}>
          {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? "CANCEL" : "NEW GOAL"}
        </button>
      </div>

      {showForm && (
        <div style={S.formCard}>
          {form.fundId === "travel" && (
            <>
              {form.country && (
                <div style={{ fontSize: 40, textAlign: "center", marginBottom: -4 }}>{countryFlag(form.country)}</div>
              )}
              <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} style={S.select}>
                <option value="">SELECT COUNTRY (OPTIONAL)</option>
                {COUNTRIES.map(([name, code]) => <option key={code} value={code}>{countryFlag(code)} {name}</option>)}
              </select>
            </>
          )}
          <input placeholder="goal name — e.g. Sri Lanka Trip" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...S.input, width: "100%" }} />
          <div style={S.formRow}>
            <AmountInput placeholder="target amount" value={form.target} onChange={(v) => setForm({ ...form, target: v })} style={S.input} className="tnum" />
            <select value={form.fundId} onChange={(e) => setForm({ ...form, fundId: e.target.value })} style={S.select}>
              {data.funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <input type="date" placeholder="target date (optional)" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} style={{ ...S.input, width: "100%" }} className="tnum" />
          <textarea placeholder="letter to future self (optional) — opens only when this goal is reached" value={form.letter} onChange={(e) => setForm({ ...form, letter: e.target.value })} style={{ ...S.input, width: "100%", minHeight: 60, fontFamily: "'Space Grotesk', sans-serif", resize: "vertical" }} />
          <button style={S.submitBtnGreen} className="npop" onClick={addGoal}>CREATE GOAL</button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
        {data.goals.length === 0 && <EmptyNote text="name a goal — even a rough number helps it become real" />}
        {data.goals.map((g) => {
          const fund = data.funds.find((f) => f.id === g.fundId) || data.funds[0];
          const bal = data.fundBalances[g.fundId] || 0;
          const pct = Math.min(100, Math.round((bal / g.target) * 100));
          const remaining = Math.max(0, g.target - bal);
          const netProfitNeeded = fund.pct > 0 ? remaining / (fund.pct / 100) : 0;
          const salesNeeded = netProfitNeeded / (MARGIN_PCT / 100);
          const daysLeft = g.targetDate ? daysBetween(todayISO(), g.targetDate) : null;
          const daily = daysLeft && remaining > 0 ? remaining / daysLeft : null;
          const todayGrowth = todayFundGrowth(data, g.fundId);
          const paceDays = daysAtPace(remaining, todayGrowth);
          const isOpen = expandedId === g.id;

          return (
            <div
              key={g.id}
              style={{ ...S.goalCard, boxShadow: g.priority ? `4px 4px 0px ${fund.color}` : `4px 4px 0px ${T.line}`, cursor: "pointer" }}
              className="npop-flat"
              onClick={() => setExpandedId(isOpen ? null : g.id)}
            >
              <div style={S.budgetTop}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ ...S.pctDot, background: fund.color }} />
                  {g.country && <span style={{ fontSize: 18 }}>{countryFlag(g.country)}</span>}
                  <span style={S.budgetName}>{g.name.toUpperCase()}</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {daysLeft !== null && remaining > 0 && (
                    <span style={{ ...S.daysLeftChip, borderColor: fund.color, color: fund.color }} className="tnum">{daysLeft}D LEFT</span>
                  )}
                  <button style={{ ...S.pinBtn, ...(g.priority ? { color: fund.color } : {}) }} onClick={(e) => { e.stopPropagation(); setPriority(g.id); }}>
                    <Pin size={13} fill={g.priority ? fund.color : "none"} />
                  </button>
                  <button style={S.deleteBtnInline} onClick={(e) => { e.stopPropagation(); removeGoal(g.id); }}><Trash2 size={13} color={T.muted} /></button>
                </div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: fund.color, marginBottom: 6 }} className="tnum">{fmt(bal)} / {fmt(g.target)}</div>
              <div style={S.progressTrack}>
                <div style={{ ...S.progressFill, width: `${pct}%`, background: fund.color }} />
              </div>
              <div style={{ color: T.muted, fontSize: 11, marginTop: 6 }} className="tnum">
                {pct}% · VIA {fund.name.toUpperCase()}
              </div>
              {remaining > 0 && paceDays !== null && (
                <div style={{ fontSize: 11, color: T.gold || T.green, marginTop: 4, fontWeight: 700 }} className="tnum">
                  AT TODAY'S PACE (₹{Math.round(todayGrowth)}/day) → ~{paceDays} DAYS
                </div>
              )}
              {remaining > 0 && (
                <div style={S.goalCalc}>
                  <span className="tnum">NET PROFIT NEEDED: <b style={{ color: T.ivory }}>{fmt(netProfitNeeded)}</b></span>
                  <span className="tnum">SALES NEEDED (~{MARGIN_PCT}% MARGIN): <b style={{ color: T.purple }}>{fmt(salesNeeded)}</b></span>
                  {daily && <span className="tnum">TODAY'S NUMBER: <b style={{ color: T.green }}>{fmt(daily)}</b></span>}
                  <span className="tnum">{fmt(remaining)} LEFT</span>
                  <span className="tnum">= {notes500(remaining).toLocaleString("en-IN")} × ₹500 NOTES</span>
                </div>
              )}
              {remaining <= 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ color: T.green, fontSize: 12, fontWeight: 700 }}>🎉 GOAL REACHED</div>
                  {g.letter && (
                    <div style={{ ...S.formCard, marginTop: 8, borderColor: T.gold || T.green }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ fontSize: 9.5, color: T.muted, fontWeight: 700, letterSpacing: "0.05em" }}>📜 A LETTER YOU WROTE YOURSELF</div>
                      <div style={{ fontSize: 12.5, color: T.ivory, lineHeight: 1.5, marginTop: 6 }}>{g.letter}</div>
                    </div>
                  )}
                </div>
              )}

              {isOpen && remaining > 0 && (
                <div style={S.expandPanel} onClick={(e) => e.stopPropagation()}>
                  {g.targetDate && (
                    <GoalTimeline targetDate={g.targetDate} remaining={remaining} netProfitNeeded={netProfitNeeded} salesNeeded={salesNeeded} />
                  )}
                  <div style={S.expandLabel}>HOW TO REACH IT</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {smartReachTips(salesNeeded, computeAvgSale(data)).map((t) => (
                      <div key={t.count} style={{ fontSize: 11.5, color: T.ivory }} className="tnum">
                        → {t.count} SALE{t.count > 1 ? "S" : ""} OF ~{fmt(t.each)} REVENUE{t.count > 1 ? " EACH" : ""}
                      </div>
                    ))}
                  </div>
                  <AITipBlock
                    prompt={`Act as a sharp, encouraging business coach. My "${g.name}" goal needs ₹${remaining} more (via the ${fund.name} fund, ${fund.pct}% of profit)${g.targetDate ? `, by ${g.targetDate}` : ""}. Today so far this fund has grown by ₹${Math.round(todayGrowth)}; at that daily pace it would take ${paceDays ?? "many"} days. ${buildContext(data)} Based on my actual patterns above, tell me: (1) confirm the at-current-pace day count in one line, (2) ONE specific accelerated recommendation naming a concrete action (e.g. sell N more of a specific item/category via a specific channel) with an estimated profit boost for today, and (3) the revised days-to-target if that's done. Keep it to 3-4 short, punchy sentences, format like: "At this pace: X days. Recommendation: sell N more [items] via [channel] to add ₹Y today. That would cut it to Z days." Be concrete with real numbers from my data, not generic.`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Dues ---------------- */

function DuesTab({ data, persist }) {
  const [subTab, setSubTab] = useState("receivable");
  const [form, setForm] = useState({ party: "", amount: "", purpose: "personal", dueDate: "", note: "" });
  const [showForm, setShowForm] = useState(false);
  const [openParty, setOpenParty] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState(null);

  const list = subTab === "receivable" ? data.receivables : data.payables;
  const key = subTab === "receivable" ? "receivables" : "payables";
  const doneStatus = subTab === "receivable" ? "received" : "paid";

  const addEntry = () => {
    const amt = parseFloat(form.amount);
    if (!form.party.trim() || !amt || amt <= 0) return;
    const entry = { id: Date.now(), party: form.party.trim(), amount: amt, purpose: form.purpose, dueDate: form.dueDate || null, note: form.note.trim(), status: "pending" };
    persist({ ...data, [key]: [...list, entry] });
    setForm({ party: "", amount: "", purpose: "personal", dueDate: "", note: "" });
    setShowForm(false);
    setOpenParty(entry.party);
  };
  const toggleStatus = (id) => {
    persist({ ...data, [key]: list.map((e) => (e.id === id ? { ...e, status: e.status === doneStatus ? "pending" : doneStatus } : e)) });
  };
  const removeEntry = (id) => persist({ ...data, [key]: list.filter((e) => e.id !== id) });
  const totalPending = list.filter((e) => e.status !== doneStatus).reduce((s, e) => s + e.amount, 0);

  const startEdit = (e) => {
    setEditingId(e.id);
    setEditValues({ party: e.party, amount: String(e.amount), purpose: e.purpose || "personal", dueDate: e.dueDate || "", note: e.note || "" });
  };
  const saveEdit = () => {
    const amt = parseFloat(editValues.amount);
    if (!editValues.party.trim() || !amt || amt <= 0) return;
    persist({
      ...data,
      [key]: list.map((e) =>
        e.id === editingId
          ? { ...e, party: editValues.party.trim(), amount: amt, purpose: editValues.purpose, dueDate: editValues.dueDate || null, note: editValues.note.trim() }
          : e
      ),
    });
    setEditingId(null);
    setEditValues(null);
  };

  const grouped = useMemo(() => {
    const map = {};
    list.forEach((e) => {
      if (!map[e.party]) map[e.party] = [];
      map[e.party].push(e);
    });
    return Object.entries(map)
      .map(([party, entries]) => ({
        party,
        entries: entries.sort((a, b) => b.id - a.id),
        totalPending: entries.filter((e) => e.status !== doneStatus).reduce((s, e) => s + e.amount, 0),
        totalAll: entries.reduce((s, e) => s + e.amount, 0),
      }))
      .sort((a, b) => b.totalPending - a.totalPending);
  }, [list, doneStatus]);

  return (
    <div>
      <div style={S.toggleWrap}>
        <button style={{ ...S.toggleBtn, flex: 1, ...(subTab === "receivable" ? { background: T.green, color: T.bg } : {}) }} onClick={() => setSubTab("receivable")}>
          <ArrowDownCircle size={13} style={{ marginRight: 4 }} /> RECEIVABLE
        </button>
        <button style={{ ...S.toggleBtn, flex: 1, ...(subTab === "payable" ? { background: T.orange, color: T.ivory } : {}) }} onClick={() => setSubTab("payable")}>
          <ArrowUpCircle size={13} style={{ marginRight: 4 }} /> PAYABLE
        </button>
      </div>

      <div style={S.heroCard}>
        <div style={S.heroLabel}>TOTAL PENDING — {subTab.toUpperCase()}</div>
        <div style={{ ...S.heroNum, color: subTab === "receivable" ? T.green : T.orange }} className="tnum">{fmt(totalPending)}</div>
      </div>

      <div style={S.sectionHeadRow}>
        <SectionLabel text={`BY PERSON — ${grouped.length}`} noMargin />
        <button style={S.addBtn} className="npop" onClick={() => setShowForm((s) => !s)}>
          {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? "CANCEL" : "ADD"}
        </button>
      </div>

      {showForm && (
        <div style={S.formCard}>
          <input placeholder={subTab === "receivable" ? "who owes you" : "who you owe"} value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })} style={{ ...S.input, width: "100%" }} />
          <div style={S.toggleWrap}>
            <button style={{ ...S.toggleBtn, flex: 1, ...(form.purpose === "personal" ? { background: T.purple, color: T.ivory } : {}) }} onClick={() => setForm({ ...form, purpose: "personal" })}>PERSONAL</button>
            <button style={{ ...S.toggleBtn, flex: 1, ...(form.purpose === "business" ? { background: T.blue, color: T.bg } : {}) }} onClick={() => setForm({ ...form, purpose: "business" })}>BUSINESS</button>
          </div>
          <div style={S.formRow}>
            <AmountInput placeholder="amount" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} style={S.input} className="tnum" />
            <input type="date" placeholder={subTab === "receivable" ? "expected date of receiving" : "expected date of paying"} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} style={S.input} className="tnum" />
          </div>
          <input type="text" placeholder="note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ ...S.input, width: "100%" }} />
          <button style={S.submitBtnGreen} className="npop" onClick={addEntry}>SAVE</button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
        {grouped.length === 0 && <EmptyNote text={`no ${subTab}s logged yet`} />}
        {grouped.map((g) => {
          const isOpen = openParty === g.party;
          const color = subTab === "receivable" ? T.green : T.orange;
          return (
            <div key={g.party} style={{ ...S.goalCard, boxShadow: `4px 4px 0px ${color}`, cursor: "pointer" }} className="npop-flat" onClick={() => setOpenParty(isOpen ? null : g.party)}>
              <div style={S.budgetTop}>
                <span style={S.budgetName}>{g.party.toUpperCase()}</span>
                <span style={{ fontSize: 10, color: T.muted }} className="tnum">{g.entries.length} ENTR{g.entries.length === 1 ? "Y" : "IES"}</span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color, marginTop: 2 }} className="tnum">{fmt(g.totalPending)}</div>
              {g.totalPending !== g.totalAll && (
                <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }} className="tnum">{fmt(g.totalAll)} TOTAL LOGGED</div>
              )}

              {isOpen && (
                <div style={S.expandPanel} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {g.entries.map((e) => (
                      <div key={e.id} style={S.ledgerRow}>
                        <div style={S.ledgerMain}>
                          <div style={{ ...S.ledgerCategory, textDecoration: e.status === doneStatus ? "line-through" : "none", opacity: e.status === doneStatus ? 0.5 : 1 }}>
                            {e.purpose && <span style={{ ...S.fineTag, color: e.purpose === "business" ? T.blue : T.purple, borderColor: e.purpose === "business" ? T.blue : T.purple, marginLeft: 0, marginRight: 6 }}>{e.purpose.toUpperCase()}</span>}
                            {e.note || "—"}
                          </div>
                          {e.dueDate && <div style={S.ledgerNote}>EXPECTED {fmtDate(e.dueDate)}</div>}
                        </div>
                        <div style={{ ...S.ledgerAmt, color, opacity: e.status === doneStatus ? 0.5 : 1 }} className="tnum">{fmt(e.amount)}</div>
                        <button style={S.smallToggle} onClick={(ev) => { ev.stopPropagation(); toggleStatus(e.id); }}>
                          <Check size={12} color={e.status === doneStatus ? T.green : T.muted} />
                        </button>
                        <button style={S.editBtn} onClick={(ev) => { ev.stopPropagation(); startEdit(e); }}><Pencil size={12} color={T.muted} /></button>
                        <button style={S.deleteBtn} onClick={(ev) => { ev.stopPropagation(); removeEntry(e.id); }}><Trash2 size={13} color={T.muted} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editingId && editValues && (
        <EditEntryModal
          title={subTab === "receivable" ? "EDIT RECEIVABLE" : "EDIT PAYABLE"}
          values={editValues}
          onChange={(key2, val) => setEditValues({ ...editValues, [key2]: val })}
          onSave={saveEdit}
          onCancel={() => { setEditingId(null); setEditValues(null); }}
          fields={[
            { key: "party", type: "text", label: subTab === "receivable" ? "who owes you" : "who you owe" },
            { key: "amount", type: "amount", label: "amount" },
            { key: "purpose", type: "select", label: "purpose", options: [{ value: "personal", label: "PERSONAL" }, { value: "business", label: "BUSINESS" }] },
            { key: "dueDate", type: "date", label: "expected date" },
            { key: "note", type: "text", label: "note (optional)" },
          ]}
        />
      )}
    </div>
  );
}

/* ---------------- Accounts (Cash / Bank / Forex) ---------------- */

function AccountsTab({ data, persist }) {
  const ACCOUNT_TYPES = [
    { id: "cash", label: "CASH", color: T.green },
    { id: "bank", label: "BANK", color: T.blue },
    { id: "forex", label: "FOREX", color: T.purple },
  ];
  const [subTab, setSubTab] = useState("cash");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ amount: "", type: "in", note: "", date: todayISO() });
  const [expandedDay, setExpandedDay] = useState(null);
  const [editingStart, setEditingStart] = useState(false);
  const [startDraft, setStartDraft] = useState("0");
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState(null);

  const acc = data.accounts[subTab];
  const accMeta = ACCOUNT_TYPES.find((a) => a.id === subTab);
  const today = todayISO();

  const sortedEntries = useMemo(() => [...acc.entries].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id), [acc.entries]);

  // build day-by-day running balance
  const dayMap = useMemo(() => {
    const dates = Array.from(new Set(sortedEntries.map((e) => e.date))).sort();
    let running = acc.startingBalance;
    const map = [];
    for (const d of dates) {
      const dayEntries = sortedEntries.filter((e) => e.date === d);
      const opening = running;
      const dayIn = dayEntries.filter((e) => e.type === "in").reduce((s, e) => s + e.amount, 0);
      const dayOut = dayEntries.filter((e) => e.type === "out").reduce((s, e) => s + e.amount, 0);
      running = opening + dayIn - dayOut;
      map.push({ date: d, opening, closing: running, entries: dayEntries });
    }
    return map;
  }, [sortedEntries, acc.startingBalance]);

  const currentBalance = dayMap.length > 0 ? dayMap[dayMap.length - 1].closing : acc.startingBalance;
  const todayRow = dayMap.find((d) => d.date === today);
  const todayOpening = todayRow ? todayRow.opening : currentBalance;
  const todayClosing = todayRow ? todayRow.closing : currentBalance;

  const addEntry = () => {
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) return;
    const entry = { id: Date.now(), date: form.date, type: form.type, amount: amt, note: form.note.trim() };
    persist({ ...data, accounts: { ...data.accounts, [subTab]: { ...acc, entries: [...acc.entries, entry] } } });
    setForm({ ...form, amount: "", note: "" });
    setShowForm(false);
  };
  const removeEntry = (id) => {
    persist({ ...data, accounts: { ...data.accounts, [subTab]: { ...acc, entries: acc.entries.filter((e) => e.id !== id) } } });
  };
  const startEdit = (e) => {
    setEditingId(e.id);
    setEditValues({ amount: String(e.amount), type: e.type, note: e.note || "", date: e.date });
  };
  const saveEdit = () => {
    const amt = parseFloat(editValues.amount);
    if (!amt || amt <= 0) return;
    const entries = acc.entries.map((e) =>
      e.id === editingId ? { ...e, amount: amt, type: editValues.type, note: editValues.note.trim(), date: editValues.date } : e
    );
    persist({ ...data, accounts: { ...data.accounts, [subTab]: { ...acc, entries } } });
    setEditingId(null);
    setEditValues(null);
  };
  const saveStart = () => {
    persist({ ...data, accounts: { ...data.accounts, [subTab]: { ...acc, startingBalance: parseFloat(startDraft) || 0 } } });
    setEditingStart(false);
  };

  const history = [...dayMap].reverse();

  return (
    <div>
      <SectionLabel text="ACCOUNTS" noMargin />
      <div style={{ ...S.toggleWrap, marginTop: 10 }}>
        {ACCOUNT_TYPES.map((a) => (
          <button
            key={a.id}
            style={{ ...S.toggleBtn, flex: 1, ...(subTab === a.id ? { background: a.color, color: T.bg } : {}) }}
            onClick={() => { setSubTab(a.id); setExpandedDay(null); }}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div style={{ ...S.heroCard, boxShadow: `4px 4px 0px ${accMeta.color}` }}>
        <div style={S.heroLabel}>{accMeta.label} BALANCE</div>
        <div style={{ ...S.heroNum, color: accMeta.color }} className="tnum">{fmt(currentBalance)}</div>
        {editingStart ? (
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <AmountInput autoFocus placeholder="starting balance" value={startDraft} onChange={(v) => setStartDraft(v)} style={{ ...S.input, fontSize: 12 }} className="tnum" />
            <button style={{ ...S.smallToggle, padding: "0 10px" }} onClick={saveStart}><Check size={13} color={T.green} /></button>
          </div>
        ) : (
          <button style={{ ...S.correctionLink, marginTop: 10, display: "block" }} onClick={() => { setStartDraft(String(acc.startingBalance)); setEditingStart(true); }}>
            SET PREVIOUS/STARTING BALANCE — MONEY ALREADY HERE
          </button>
        )}
      </div>

      <div style={S.sectionHeadRow}>
        <SectionLabel text="TODAY" noMargin />
        <button style={S.addBtn} className="npop" onClick={() => setShowForm((s) => !s)}>
          {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? "CANCEL" : "ADD ENTRY"}
        </button>
      </div>

      {showForm && (
        <div style={S.formCard}>
          <div style={S.toggleWrap}>
            <button style={{ ...S.toggleBtn, flex: 1, ...(form.type === "in" ? { background: T.green, color: T.bg } : {}) }} onClick={() => setForm({ ...form, type: "in" })}>IN</button>
            <button style={{ ...S.toggleBtn, flex: 1, ...(form.type === "out" ? { background: T.orange, color: T.ivory } : {}) }} onClick={() => setForm({ ...form, type: "out" })}>OUT</button>
          </div>
          <div style={S.formRow}>
            <AmountInput placeholder="amount" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} style={S.input} className="tnum" />
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={S.input} className="tnum" />
          </div>
          <input type="text" placeholder="note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ ...S.input, width: "100%" }} />
          <button style={form.type === "in" ? S.submitBtnGreen : S.submitBtnOrange} className="npop" onClick={addEntry}>SAVE</button>
        </div>
      )}

      <div
        style={{ ...S.statBox, boxShadow: `3px 3px 0px ${accMeta.color}`, cursor: "pointer", marginTop: 4 }}
        className="npop-flat"
        onClick={() => setExpandedDay(expandedDay === "today" ? null : "today")}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <div style={S.statBoxLabel}>OPENING</div>
            <div style={{ ...S.statBoxNum, color: T.muted, fontSize: 16 }} className="tnum">{fmt(todayOpening)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={S.statBoxLabel}>CLOSING</div>
            <div style={{ ...S.statBoxNum, color: accMeta.color, fontSize: 16 }} className="tnum">{fmt(todayClosing)}</div>
          </div>
        </div>

        {expandedDay === "today" && (
          <div style={S.expandPanel} onClick={(e) => e.stopPropagation()}>
            <div style={S.expandLabel}>TODAY'S ENTRIES</div>
            {!todayRow || todayRow.entries.length === 0 ? (
              <div style={{ fontSize: 11, color: T.muted }}>nothing logged today</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {todayRow.entries.map((e) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }} className="tnum">
                    <span style={{ color: T.muted }}>{e.note || (e.type === "in" ? "money in" : "money out")}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: e.type === "in" ? T.green : T.orange, fontWeight: 700 }}>{e.type === "in" ? "+" : "−"}{fmt(e.amount)}</span>
                      <button style={S.editBtn} onClick={() => startEdit(e)}><Pencil size={11} color={T.muted} /></button>
                      <button style={S.deleteBtn} onClick={() => removeEntry(e.id)}><Trash2 size={11} color={T.muted} /></button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <SectionLabel text="HISTORY" />
      {history.filter((d) => d.date !== today).length === 0 ? (
        <EmptyNote text="past days will build up here as you log entries" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {history.filter((d) => d.date !== today).slice(0, 14).map((d) => {
            const isOpen = expandedDay === d.date;
            return (
              <div key={d.date} style={{ ...S.historyCard, cursor: "pointer" }} className="npop-flat" onClick={() => setExpandedDay(isOpen ? null : d.date)}>
                <div style={S.historyTop}>
                  <span style={S.budgetName}>{fmtDate(d.date)}</span>
                  <span style={{ fontSize: 12, color: T.muted }} className="tnum">{fmt(d.opening)} → {fmt(d.closing)}</span>
                </div>
                {isOpen && (
                  <div style={S.expandPanel} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {d.entries.map((e) => (
                        <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }} className="tnum">
                          <span style={{ color: T.muted }}>{e.note || (e.type === "in" ? "money in" : "money out")}</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ color: e.type === "in" ? T.green : T.orange, fontWeight: 700 }}>{e.type === "in" ? "+" : "−"}{fmt(e.amount)}</span>
                            <button style={S.editBtn} onClick={(ev) => { ev.stopPropagation(); startEdit(e); }}><Pencil size={11} color={T.muted} /></button>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editingId && editValues && (
        <EditEntryModal
          title="EDIT ENTRY"
          values={editValues}
          onChange={(key, val) => setEditValues({ ...editValues, [key]: val })}
          onSave={saveEdit}
          onCancel={() => { setEditingId(null); setEditValues(null); }}
          fields={[
            { key: "type", type: "select", label: "type", options: [{ value: "in", label: "IN" }, { value: "out", label: "OUT" }] },
            { key: "amount", type: "amount", label: "amount" },
            { key: "date", type: "date", label: "date" },
            { key: "note", type: "text", label: "note (optional)" },
          ]}
        />
      )}
    </div>
  );
}

/* ---------------- Expense Pool (campaigns / trips) ---------------- */

function ExpensePoolTab({ data, persist, registerActivity, setToast, triggerNoteAnim }) {
  const [showNewPool, setShowNewPool] = useState(false);
  const [newPool, setNewPool] = useState({ purpose: "", date: todayISO() });
  const [openPoolId, setOpenPoolId] = useState(null);
  const [entryForm, setEntryForm] = useState({ date: todayISO(), amount: "", note: "" });
  const [editing, setEditing] = useState(null); // { poolId, entryId }
  const [editValues, setEditValues] = useState(null);

  const createPool = () => {
    if (!newPool.purpose.trim()) return;
    const pool = { id: Date.now(), purpose: newPool.purpose.trim(), date: newPool.date, entries: [] };
    persist({ ...data, expensePools: [...data.expensePools, pool] });
    setNewPool({ purpose: "", date: todayISO() });
    setShowNewPool(false);
    setOpenPoolId(pool.id);
  };

  const removePool = (id) => {
    const pool = data.expensePools.find((p) => p.id === id);
    const linkedIds = new Set((pool?.entries || []).map((e) => e.linkedExpenseId).filter(Boolean));
    const fundBalances = { ...data.fundBalances };
    data.expenses.filter((e) => linkedIds.has(e.id)).forEach((e) => {
      if (e.fundDelta) Object.entries(e.fundDelta).forEach(([fid, amt]) => { fundBalances[fid] = (fundBalances[fid] || 0) - amt; });
    });
    persist({
      ...data,
      expensePools: data.expensePools.filter((p) => p.id !== id),
      expenses: data.expenses.filter((e) => !linkedIds.has(e.id)),
      fundBalances,
    });
  };

  const addPoolEntry = (pool) => {
    const amt = parseFloat(entryForm.amount);
    if (!amt || amt <= 0) return;
    const fundDelta = {};
    const fundBalances = { ...data.fundBalances };
    data.funds.forEach((f) => {
      const share = Math.round((amt * f.pct) / 100);
      fundDelta[f.id] = -share;
      fundBalances[f.id] = (fundBalances[f.id] || 0) - share;
    });
    const linkedExpenseId = Date.now() + 1;
    const linkedExpense = {
      id: linkedExpenseId, amount: amt, category: `Pool: ${pool.purpose}`, note: entryForm.note.trim(),
      date: entryForm.date, unnecessary: false, fine: 0, fundDelta, poolId: pool.id,
    };
    const poolEntry = { id: Date.now(), date: entryForm.date, amount: amt, note: entryForm.note.trim(), linkedExpenseId };

    let next = {
      ...data,
      expensePools: data.expensePools.map((p) => (p.id === pool.id ? { ...p, entries: [...p.entries, poolEntry] } : p)),
      expenses: [...data.expenses, linkedExpense],
      fundBalances,
    };
    next = registerActivity(next, 3);
    persist(next);
    triggerNoteAnim(amt, "out");
    setEntryForm({ date: todayISO(), amount: "", note: "" });
    setToast("+3 XP · FUNDS UPDATED");
    setTimeout(() => setToast(null), 1400);
  };

  const removePoolEntry = (poolId, entry) => {
    const fundBalances = { ...data.fundBalances };
    const linked = data.expenses.find((e) => e.id === entry.linkedExpenseId);
    if (linked?.fundDelta) {
      Object.entries(linked.fundDelta).forEach(([fid, amt]) => { fundBalances[fid] = (fundBalances[fid] || 0) - amt; });
    }
    persist({
      ...data,
      expensePools: data.expensePools.map((p) => (p.id === poolId ? { ...p, entries: p.entries.filter((e) => e.id !== entry.id) } : p)),
      expenses: data.expenses.filter((e) => e.id !== entry.linkedExpenseId),
      fundBalances,
    });
  };

  const startEdit = (poolId, entry) => {
    setEditing({ poolId, entryId: entry.id });
    setEditValues({ amount: String(entry.amount), date: entry.date, note: entry.note || "" });
  };
  const saveEdit = () => {
    const amt = parseFloat(editValues.amount);
    if (!amt || amt <= 0) return;
    const pool = data.expensePools.find((p) => p.id === editing.poolId);
    const poolEntry = pool?.entries.find((e) => e.id === editing.entryId);
    if (!poolEntry) return;
    const linked = data.expenses.find((e) => e.id === poolEntry.linkedExpenseId);
    const newDelta = fundDeltaForAmount(data.funds, amt, -1);
    const fundBalances = swapFundDelta(data.fundBalances, linked?.fundDelta, newDelta);
    const expensePools = data.expensePools.map((p) =>
      p.id === editing.poolId
        ? { ...p, entries: p.entries.map((e) => (e.id === editing.entryId ? { ...e, amount: amt, date: editValues.date, note: editValues.note.trim() } : e)) }
        : p
    );
    const expenses = data.expenses.map((e) =>
      e.id === poolEntry.linkedExpenseId ? { ...e, amount: amt, date: editValues.date, note: editValues.note.trim(), fundDelta: newDelta } : e
    );
    persist({ ...data, expensePools, expenses, fundBalances });
    setEditing(null);
    setEditValues(null);
  };

  const totalAcrossPools = data.expensePools.reduce((s, p) => s + p.entries.reduce((s2, e) => s2 + e.amount, 0), 0);

  return (
    <div>
      <div style={{ ...S.heroCard, boxShadow: `4px 4px 0px ${T.orange}` }}>
        <div style={S.heroLabel}>ACROSS ALL POOLS</div>
        <div style={{ ...S.heroNum, color: T.orange }} className="tnum">{fmt(totalAcrossPools)}</div>
        <div style={S.heroSub}>{data.expensePools.length} POOL{data.expensePools.length !== 1 ? "S" : ""} ACTIVE · COUNTS TOWARD FUNDS & EXPENSE TOTALS</div>
      </div>

      <div style={S.sectionHeadRow}>
        <SectionLabel text="EXPENSE POOLS" noMargin />
        <button style={S.addBtn} className="npop" onClick={() => setShowNewPool((s) => !s)}>
          {showNewPool ? <X size={14} /> : <Plus size={14} />} {showNewPool ? "CANCEL" : "NEW POOL"}
        </button>
      </div>

      {showNewPool && (
        <div style={S.formCard}>
          <input type="text" placeholder="purpose — e.g. Sri Lanka Trip, Diwali Campaign" value={newPool.purpose} onChange={(e) => setNewPool({ ...newPool, purpose: e.target.value })} style={{ ...S.input, width: "100%" }} />
          <input type="date" value={newPool.date} onChange={(e) => setNewPool({ ...newPool, date: e.target.value })} style={{ ...S.input, width: "100%" }} className="tnum" />
          <button style={S.submitBtnOrange} className="npop" onClick={createPool}>CREATE POOL</button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
        {data.expensePools.length === 0 && <EmptyNote text="create a pool for a trip, campaign, or anything with many small expenses" />}
        {[...data.expensePools].reverse().map((p) => {
          const total = p.entries.reduce((s, e) => s + e.amount, 0);
          const isOpen = openPoolId === p.id;
          return (
            <div key={p.id} style={{ ...S.goalCard, boxShadow: `4px 4px 0px ${T.orange}`, cursor: "pointer" }} className="npop-flat" onClick={() => setOpenPoolId(isOpen ? null : p.id)}>
              <div style={S.budgetTop}>
                <div>
                  <span style={S.budgetName}>{p.purpose.toUpperCase()}</span>
                  <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }} className="tnum">STARTED {fmtDate(p.date)} · {p.entries.length} ENTRIES</div>
                </div>
                <button style={S.deleteBtnInline} onClick={(e) => { e.stopPropagation(); removePool(p.id); }}><Trash2 size={13} color={T.muted} /></button>
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: T.orange, marginTop: 6 }} className="tnum">{fmt(total)}</div>

              {isOpen && (
                <div style={S.expandPanel} onClick={(e) => e.stopPropagation()}>
                  <div style={S.formCard}>
                    <div style={S.formRow}>
                      <AmountInput placeholder="amount" value={entryForm.amount} onChange={(v) => setEntryForm({ ...entryForm, amount: v })} style={S.input} className="tnum" />
                      <input type="date" value={entryForm.date} onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })} style={S.input} className="tnum" />
                    </div>
                    <input type="text" placeholder="what was this for" value={entryForm.note} onChange={(e) => setEntryForm({ ...entryForm, note: e.target.value })} style={{ ...S.input, width: "100%" }} />
                    <button style={S.submitBtnOrange} className="npop" onClick={() => addPoolEntry(p)}>ADD TO POOL</button>
                  </div>

                  {p.entries.length === 0 ? (
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }}>no entries yet</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                      {[...p.entries].reverse().map((e) => (
                        <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }} className="tnum">
                          <span style={{ color: T.muted }}>{fmtDateShort(e.date)} · {e.note || "expense"}</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ color: T.orange, fontWeight: 700 }}>−{fmt(e.amount)}</span>
                            <button style={S.editBtn} onClick={() => startEdit(p.id, e)}><Pencil size={11} color={T.muted} /></button>
                            <button style={S.deleteBtn} onClick={() => removePoolEntry(p.id, e)}><Trash2 size={11} color={T.muted} /></button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && editValues && (
        <EditEntryModal
          title="EDIT POOL ENTRY"
          values={editValues}
          onChange={(k, val) => setEditValues({ ...editValues, [k]: val })}
          onSave={saveEdit}
          onCancel={() => { setEditing(null); setEditValues(null); }}
          fields={[
            { key: "amount", type: "amount", label: "amount" },
            { key: "date", type: "date", label: "date" },
            { key: "note", type: "text", label: "what was this for" },
          ]}
        />
      )}
    </div>
  );
}

/* ---------------- Hustle (the WHY) ---------------- */

function HustleTab({ data, persist }) {
  const [editingStar, setEditingStar] = useState(false);
  const [starDraft, setStarDraft] = useState(data.northStar);
  const [showReasonForm, setShowReasonForm] = useState(false);
  const [reasonDraft, setReasonDraft] = useState("");
  const [showVisionForm, setShowVisionForm] = useState(false);
  const [visionDraft, setVisionDraft] = useState({ name: "", amount: "", why: "", photo: null, targetDate: "", fundId: "none" });
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [identityDraft, setIdentityDraft] = useState(data.identityStatement);
  const [editingPlan, setEditingPlan] = useState(false);
  const [planDraft, setPlanDraft] = useState(data.ifThenPlan);

  const saveStar = () => {
    persist({ ...data, northStar: starDraft.trim() });
    setEditingStar(false);
  };
  const addReason = () => {
    if (!reasonDraft.trim()) return;
    persist({ ...data, whyReasons: [...data.whyReasons, { id: Date.now(), text: reasonDraft.trim() }] });
    setReasonDraft("");
    setShowReasonForm(false);
  };
  const removeReason = (id) => persist({ ...data, whyReasons: data.whyReasons.filter((r) => r.id !== id) });

  const handleVisionPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setVisionDraft({ ...visionDraft, photo: reader.result });
    reader.readAsDataURL(file);
  };
  const addVisionItem = () => {
    const amt = parseFloat(visionDraft.amount);
    if (!visionDraft.name.trim() || !amt || amt <= 0) return;
    persist({
      ...data,
      visionItems: [...data.visionItems, {
        id: Date.now(), name: visionDraft.name.trim(), amount: amt, why: visionDraft.why.trim(), photo: visionDraft.photo,
        targetDate: visionDraft.targetDate || null, fundId: visionDraft.fundId !== "none" ? visionDraft.fundId : null,
      }],
    });
    setVisionDraft({ name: "", amount: "", why: "", photo: null, targetDate: "", fundId: "none" });
    setShowVisionForm(false);
  };
  const removeVisionItem = (id) => persist({ ...data, visionItems: data.visionItems.filter((v) => v.id !== id) });

  const saveIdentity = () => { persist({ ...data, identityStatement: identityDraft.trim() }); setEditingIdentity(false); };
  const savePlan = () => { persist({ ...data, ifThenPlan: planDraft.trim() }); setEditingPlan(false); };

  const netWorth = computeNetWorthQuick(data);
  const streakAtRisk = data.streak.count >= 3;

  const activeGoals = data.goals.filter((g) => (data.fundBalances[g.fundId] || 0) < g.target);
  const lettersWritten = data.goals.filter((g) => g.letter);
  const lalaTotal = data.expenses.filter((e) => e.category === "Lala Fund" || e.note?.toLowerCase().includes("lala")).reduce((s, e) => s + e.amount, 0);

  return (
    <div>
      <PermanentQuoteCard />

      <SectionLabel text="YOUR NORTH STAR" noMargin />
      <div style={{ ...S.heroCard, boxShadow: `4px 4px 0px ${T.gold || T.green}`, cursor: "pointer" }} onClick={() => !editingStar && setEditingStar(true)}>
        {editingStar ? (
          <>
            <textarea
              autoFocus
              placeholder="e.g. Dubai 2031 — building a life where no one controls my time"
              value={starDraft}
              onChange={(e) => setStarDraft(e.target.value)}
              style={{ ...S.input, width: "100%", minHeight: 70, fontFamily: "'Space Grotesk', sans-serif", resize: "vertical" }}
              onClick={(e) => e.stopPropagation()}
            />
            <button style={{ ...S.submitBtnGreen, marginTop: 8 }} className="npop" onClick={(e) => { e.stopPropagation(); saveStar(); }}>SAVE</button>
          </>
        ) : data.northStar ? (
          <div style={{ fontSize: 18, fontWeight: 700, color: T.gold || T.green, lineHeight: 1.4 }}>{data.northStar}</div>
        ) : (
          <div style={{ fontSize: 12, color: T.muted }}>TAP TO WRITE THE ONE THING ALL OF THIS IS FOR</div>
        )}
      </div>

      <div style={S.sectionHeadRow}>
        <SectionLabel text="WHY YOU'RE DOING THIS" noMargin />
        <button style={S.addBtn} className="npop" onClick={() => setShowReasonForm((s) => !s)}>
          {showReasonForm ? <X size={14} /> : <Plus size={14} />} {showReasonForm ? "CANCEL" : "ADD"}
        </button>
      </div>

      {showReasonForm && (
        <div style={S.formCard}>
          <input type="text" placeholder="e.g. take care of my family" value={reasonDraft} onChange={(e) => setReasonDraft(e.target.value)} style={{ ...S.input, width: "100%" }} />
          <button style={S.submitBtnPurple} className="npop" onClick={addReason}>SAVE REASON</button>
        </div>
      )}

      {data.whyReasons.length === 0 ? (
        <EmptyNote text="write down every real reason you're grinding — read it when it gets hard" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
          {data.whyReasons.map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...S.statBox }}>
              <span style={{ fontSize: 12.5, color: T.ivory }}>⚡ {r.text}</span>
              <button style={S.deleteBtn} onClick={() => removeReason(r.id)}><Trash2 size={12} color={T.muted} /></button>
            </div>
          ))}
        </div>
      )}

      {data.visionItems.length > 0 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 8 }}>
          {data.visionItems.map((v) => {
            const fund = v.fundId ? data.funds.find((f) => f.id === v.fundId) : null;
            const saved = fund ? (data.fundBalances[v.fundId] || 0) : 0;
            const remaining = Math.max(0, v.amount - saved);
            const daysLeft = v.targetDate ? daysBetween(todayISO(), v.targetDate) : null;
            return (
              <div key={v.id} style={S.whyVisionCard}>
                {v.photo ? (
                  <img src={v.photo} alt={v.name} style={S.whyVisionImg} />
                ) : (
                  <div style={{ ...S.whyVisionImg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>💭</div>
                )}
                <div style={{ padding: 8 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: T.ivory }}>{v.name.toUpperCase()}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.gold || T.green, marginTop: 2 }} className="tnum">{fmt(remaining)} LEFT</div>
                  {daysLeft !== null && <div style={{ fontSize: 9, color: daysLeft <= 30 ? T.orange : T.muted, marginTop: 1, fontWeight: 700 }} className="tnum">{daysLeft >= 0 ? `${daysLeft}D LEFT` : "OVERDUE"}</div>}
                  {v.why && <div style={{ fontSize: 9, color: T.muted, marginTop: 4, fontStyle: "italic", lineHeight: 1.3 }}>"{v.why.length > 60 ? v.why.slice(0, 60) + "…" : v.why}"</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={S.sectionHeadRow}>
        <SectionLabel text="VISION BOARD — GHAR, GAADI, ANYTHING" noMargin />
        <button style={S.addBtn} className="npop" onClick={() => setShowVisionForm((s) => !s)}>
          {showVisionForm ? <X size={14} /> : <Plus size={14} />} {showVisionForm ? "CANCEL" : "ADD"}
        </button>
      </div>

      {showVisionForm && (
        <div style={S.formCard}>
          <input type="text" placeholder="what — e.g. Dream House, Fortuner" value={visionDraft.name} onChange={(e) => setVisionDraft({ ...visionDraft, name: e.target.value })} style={{ ...S.input, width: "100%" }} />
          <AmountInput placeholder="how much money needed" value={visionDraft.amount} onChange={(v) => setVisionDraft({ ...visionDraft, amount: v })} style={{ ...S.input, width: "100%" }} className="tnum" />
          <input type="date" placeholder="by when do you want this" value={visionDraft.targetDate} onChange={(e) => setVisionDraft({ ...visionDraft, targetDate: e.target.value })} style={{ ...S.input, width: "100%" }} className="tnum" />
          <select value={visionDraft.fundId} onChange={(e) => setVisionDraft({ ...visionDraft, fundId: e.target.value })} style={S.select}>
            <option value="none">TRACK PROGRESS — NONE (JUST A DREAM FOR NOW)</option>
            {data.funds.map((f) => <option key={f.id} value={f.id}>TRACK VIA {f.name.toUpperCase()}</option>)}
          </select>
          <textarea placeholder="why do you want this — be honest" value={visionDraft.why} onChange={(e) => setVisionDraft({ ...visionDraft, why: e.target.value })} style={{ ...S.input, width: "100%", minHeight: 50, fontFamily: "'Space Grotesk', sans-serif", resize: "vertical" }} />
          {visionDraft.photo ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <img src={visionDraft.photo} alt="vision" style={{ width: 44, height: 44, objectFit: "cover", border: `1.5px solid ${T.line}` }} />
              <button style={S.correctionLink} onClick={() => setVisionDraft({ ...visionDraft, photo: null })}>REMOVE PHOTO</button>
            </div>
          ) : (
            <label style={S.photoUploadBtn}>
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleVisionPhoto} />
              📷 ADD PHOTO (OPTIONAL)
            </label>
          )}
          <button style={S.submitBtnGreen} className="npop" onClick={addVisionItem}>ADD TO VISION BOARD</button>
        </div>
      )}

      {data.visionItems.length === 0 ? (
        <EmptyNote text="add the house, car, anything real you're working toward — with a photo it hits different" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 8 }}>
          {data.visionItems.map((v) => {
            const fund = v.fundId ? data.funds.find((f) => f.id === v.fundId) : null;
            const saved = fund ? (data.fundBalances[v.fundId] || 0) : 0;
            const remaining = Math.max(0, v.amount - saved);
            const pct = fund ? Math.min(100, Math.round((saved / v.amount) * 100)) : 0;
            const daysLeft = v.targetDate ? daysBetween(todayISO(), v.targetDate) : null;
            const dailyNeeded = daysLeft && daysLeft > 0 && remaining > 0 ? remaining / daysLeft : null;
            const weeklyNeeded = dailyNeeded ? dailyNeeded * 7 : null;
            return (
              <div key={v.id} style={{ ...S.heroCard, position: "relative", boxShadow: `4px 4px 0px ${daysLeft !== null && daysLeft <= 30 ? T.orange : (T.gold || T.green)}` }}>
                <button style={{ ...S.deleteBtn, position: "absolute", top: 8, right: 8, zIndex: 5 }} onClick={() => removeVisionItem(v.id)}><Trash2 size={12} color={T.muted} /></button>
                {v.photo && <Tilt3DCard src={v.photo} />}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: v.photo ? 8 : 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.ivory }}>{v.name.toUpperCase()}</div>
                  {daysLeft !== null && <span style={{ ...S.daysLeftChip, borderColor: daysLeft <= 30 ? T.orange : (T.gold || T.green), color: daysLeft <= 30 ? T.orange : (T.gold || T.green) }} className="tnum">{daysLeft >= 0 ? `${daysLeft}D LEFT` : "OVERDUE"}</span>}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: T.gold || T.green, marginTop: 4 }} className="tnum">{fmt(v.amount)}</div>

                {fund && (
                  <>
                    <div style={{ ...S.progressTrack, marginTop: 8 }}>
                      <div style={{ ...S.progressFill, width: `${pct}%`, background: fund.color }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10.5 }} className="tnum">
                      <span style={{ color: T.muted }}>{fmt(saved)} SAVED VIA {fund.name.toUpperCase()}</span>
                      <span style={{ color: fund.color, fontWeight: 700 }}>{pct}%</span>
                    </div>
                  </>
                )}

                <div style={{ fontSize: 10, color: T.muted, marginTop: 6 }} className="tnum">
                  {remaining > 0 ? `${fmt(remaining)} LEFT · = ${notes500(remaining).toLocaleString("en-IN")} × ₹500 NOTES` : "FULLY FUNDED 🎉"}
                </div>
                {dailyNeeded !== null && (
                  <div style={{ fontSize: 11, color: daysLeft <= 30 ? T.orange : T.green, marginTop: 6, fontWeight: 700 }} className="tnum">
                    NEED {fmt(dailyNeeded)}/DAY · {fmt(weeklyNeeded)}/WEEK TO MAKE IT
                  </div>
                )}
                {v.targetDate && <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }} className="tnum">TARGET: {fmtDate(v.targetDate)}</div>}
                {v.why && <div style={{ fontSize: 12, color: T.muted, marginTop: 8, fontStyle: "italic", lineHeight: 1.4 }}>"{v.why}"</div>}
              </div>
            );
          })}
        </div>
      )}

      <SectionLabel text="PSYCHOLOGICAL ANCHORS" />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 8 }}>
        <div style={{ ...S.formCard, cursor: "pointer" }} onClick={() => !editingIdentity && setEditingIdentity(true)}>
          <div style={{ fontSize: 9.5, color: T.muted, fontWeight: 700 }}>IDENTITY — WHO YOU ARE, NOT WHAT YOU WANT</div>
          {editingIdentity ? (
            <>
              <input type="text" autoFocus placeholder='e.g. "I am someone who closes every target I set"' value={identityDraft} onChange={(e) => setIdentityDraft(e.target.value)} style={{ ...S.input, width: "100%", marginTop: 6 }} onClick={(e) => e.stopPropagation()} />
              <button style={{ ...S.submitBtnGreen, marginTop: 8 }} className="npop" onClick={(e) => { e.stopPropagation(); saveIdentity(); }}>SAVE</button>
            </>
          ) : (
            <div style={{ fontSize: 13, color: T.ivory, marginTop: 6, fontWeight: 700 }}>{data.identityStatement || "TAP TO WRITE YOUR IDENTITY STATEMENT"}</div>
          )}
        </div>

        <div style={{ ...S.formCard, cursor: "pointer" }} onClick={() => !editingPlan && setEditingPlan(true)}>
          <div style={{ fontSize: 9.5, color: T.muted, fontWeight: 700 }}>IF-THEN PLAN — FOR WHEN YOU WANT TO QUIT</div>
          {editingPlan ? (
            <>
              <textarea autoFocus placeholder='e.g. "If I feel like giving up, then I open this tab and read my why."' value={planDraft} onChange={(e) => setPlanDraft(e.target.value)} style={{ ...S.input, width: "100%", minHeight: 55, marginTop: 6, fontFamily: "'Space Grotesk', sans-serif", resize: "vertical" }} onClick={(e) => e.stopPropagation()} />
              <button style={{ ...S.submitBtnGreen, marginTop: 8 }} className="npop" onClick={(e) => { e.stopPropagation(); savePlan(); }}>SAVE</button>
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: T.ivory, marginTop: 6 }}>{data.ifThenPlan || "TAP TO WRITE YOUR IF-THEN PLAN"}</div>
          )}
        </div>

        {streakAtRisk && (
          <div style={{ ...S.statBox, boxShadow: `3px 3px 0px ${T.orange}` }}>
            <div style={S.statBoxLabel}>LOSS CHECK</div>
            <div style={{ fontSize: 12.5, color: T.ivory, marginTop: 6 }}>
              You've built a <b style={{ color: T.orange }}>{data.streak.count}-day streak</b> and <b style={{ color: T.orange }}>{fmtSigned(netWorth)}</b> net worth. One lazy week doesn't just cost money — it costs the momentum you already earned.
            </div>
          </div>
        )}
      </div>

      {activeGoals.length > 0 && (
        <>
          <SectionLabel text="THE TARGETS THAT PROVE IT" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activeGoals.map((g) => {
              const fund = data.funds.find((f) => f.id === g.fundId);
              const bal = data.fundBalances[g.fundId] || 0;
              const pct = Math.min(100, Math.round((bal / g.target) * 100));
              return (
                <div key={g.id} style={{ ...S.statBox, boxShadow: `3px 3px 0px ${fund?.color}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: T.ivory }}>
                      {g.country && <span style={{ marginRight: 6 }}>{countryFlag(g.country)}</span>}
                      {g.name.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: fund?.color }} className="tnum">{pct}%</span>
                  </div>
                  <div style={{ ...S.progressTrack, marginTop: 6 }}>
                    <div style={{ ...S.progressFill, width: `${pct}%`, background: fund?.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {lettersWritten.length > 0 && (
        <>
          <SectionLabel text="LETTERS YOU WROTE YOURSELF" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lettersWritten.map((g) => {
              const bal = data.fundBalances[g.fundId] || 0;
              const reached = bal >= g.target;
              return (
                <div key={g.id} style={{ ...S.formCard, opacity: reached ? 1 : 0.55 }}>
                  <div style={{ fontSize: 10, color: T.muted, fontWeight: 700 }}>
                    📜 FOR "{g.name.toUpperCase()}" {reached ? "" : "— UNLOCKS WHEN YOU HIT THIS GOAL"}
                  </div>
                  {reached ? (
                    <div style={{ fontSize: 12.5, color: T.ivory, lineHeight: 1.5, marginTop: 6 }}>{g.letter}</div>
                  ) : (
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 6, fontStyle: "italic" }}>🔒 locked — keep going</div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {lalaTotal > 0 && (
        <>
          <SectionLabel text="THE GIVING SIDE" />
          <div style={{ ...S.statBox, boxShadow: `3px 3px 0px ${T.purple}` }}>
            <div style={S.statBoxLabel}>LALA FUND GIVEN SO FAR</div>
            <div style={{ ...S.statBoxNum, color: T.purple }} className="tnum">{fmt(lalaTotal)}</div>
            <div style={{ fontSize: 10.5, color: T.muted, marginTop: 4 }}>EVERY RUPEE YOU MAKE, SOMEONE ELSE FEELS TOO</div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Analytics ---------------- */

const CHART_TOOLTIP_STYLE = { background: "#1E1E1E", border: "1.5px solid #2A2A2A", borderRadius: 0, fontFamily: "'Space Grotesk', sans-serif", fontSize: 12 };

function BudgetVsActual({ data, persist }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category: EXPENSE_CATEGORIES[0], limit: "" });

  const cur = currentMonthKey();
  const spendByCategory = useMemo(() => {
    const map = {};
    data.expenses.filter((e) => monthKey(e.date) === cur).forEach((e) => { map[e.category] = (map[e.category] || 0) + e.amount; });
    return map;
  }, [data.expenses, cur]);

  const addBudget = () => {
    const lim = parseFloat(form.limit);
    if (!lim || lim <= 0) return;
    if (data.budgets.some((b) => b.category === form.category)) {
      persist({ ...data, budgets: data.budgets.map((b) => (b.category === form.category ? { ...b, limit: lim } : b)) });
    } else {
      persist({ ...data, budgets: [...data.budgets, { category: form.category, limit: lim }] });
    }
    setForm({ ...form, limit: "" });
    setShowForm(false);
  };
  const removeBudget = (category) => persist({ ...data, budgets: data.budgets.filter((b) => b.category !== category) });

  return (
    <>
      <div style={S.sectionHeadRow}>
        <SectionLabel text="BUDGET VS ACTUAL" noMargin />
        <button style={S.addBtn} className="npop" onClick={() => setShowForm((s) => !s)}>
          {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? "CANCEL" : "SET BUDGET"}
        </button>
      </div>
      {showForm && (
        <div style={S.formCard}>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={S.select}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <AmountInput placeholder="monthly limit" value={form.limit} onChange={(v) => setForm({ ...form, limit: v })} style={{ ...S.input, width: "100%" }} className="tnum" />
          <button style={S.submitBtnGreen} className="npop" onClick={addBudget}>SAVE BUDGET</button>
        </div>
      )}
      {data.budgets.length === 0 ? <EmptyNote text="set a category budget to compare against actual spend" /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.budgets.map((b) => {
            const actual = spendByCategory[b.category] || 0;
            const pct = Math.min(100, Math.round((actual / b.limit) * 100));
            const over = actual > b.limit;
            return (
              <div key={b.category} style={{ ...S.statBox, boxShadow: `3px 3px 0px ${over ? T.orange : T.green}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.ivory }}>{b.category.toUpperCase()}</span>
                  <button style={S.deleteBtn} onClick={() => removeBudget(b.category)}><Trash2 size={12} color={T.muted} /></button>
                </div>
                <div style={{ ...S.progressTrack, marginTop: 6 }}>
                  <div style={{ ...S.progressFill, width: `${pct}%`, background: over ? T.orange : T.green }} />
                </div>
                <div style={{ fontSize: 10.5, color: over ? T.orange : T.muted, marginTop: 4, fontWeight: 700 }} className="tnum">
                  {fmt(actual)} OF {fmt(b.limit)}{over ? " — OVER BUDGET" : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function buildTrendSeries(data, range) {
  const today = new Date();
  const results = [];

  if (range === "week" || range === "month") {
    const days = range === "week" ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const inc = data.income.filter((e) => e.date === iso).reduce((s, e) => s + e.amount, 0);
      const exp = data.expenses.filter((e) => e.date === iso).reduce((s, e) => s + e.amount, 0);
      const label = range === "week"
        ? d.toLocaleDateString("en-IN", { weekday: "short" })
        : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      results.push({ label, income: inc, expense: exp, profit: inc - exp });
    }
  } else if (range === "3m") {
    for (let i = 12; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * 7);
      const monday = mondayOf(d.toISOString().slice(0, 10));
      const sunday = new Date(new Date(monday + "T00:00:00").getTime() + 6 * 86400000).toISOString().slice(0, 10);
      const inc = data.income.filter((e) => e.date >= monday && e.date <= sunday).reduce((s, e) => s + e.amount, 0);
      const exp = data.expenses.filter((e) => e.date >= monday && e.date <= sunday).reduce((s, e) => s + e.amount, 0);
      const label = new Date(monday + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      results.push({ label, income: inc, expense: exp, profit: inc - exp });
    }
  } else {
    const monthsCount = range === "6m" ? 6 : 12;
    for (let i = monthsCount - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const inc = data.income.filter((e) => monthKey(e.date) === mk).reduce((s, e) => s + e.amount, 0);
      const exp = data.expenses.filter((e) => monthKey(e.date) === mk).reduce((s, e) => s + e.amount, 0);
      const label = d.toLocaleDateString("en-IN", range === "1y" ? { month: "short", year: "2-digit" } : { month: "short" });
      results.push({ label, income: inc, expense: exp, profit: inc - exp });
    }
  }
  return results;
}

const TREND_RANGES = [
  { id: "week", label: "WEEK" },
  { id: "month", label: "MONTH" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "1y", label: "1Y" },
];

function TrendRangePicker({ range, setRange }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
      {TREND_RANGES.map((r) => (
        <button
          key={r.id}
          style={{ ...S.miniTypeBtn, borderColor: T.gold || T.green, color: range === r.id ? T.bg : (T.gold || T.green), background: range === r.id ? (T.gold || T.green) : "none" }}
          className="npop-flat"
          onClick={() => setRange(r.id)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function WhatIfSimulator({ data, avgProfitPerSale, monthlyWaste }) {
  const [extraSales, setExtraSales] = useState(0);
  const [wasteCutPct, setWasteCutPct] = useState(0);

  const goal = priorityGoalForBoss(data);
  const fund = goal ? data.funds.find((f) => f.id === goal.fundId) : null;
  const bal = goal ? (data.fundBalances[goal.fundId] || 0) : 0;
  const remaining = goal ? Math.max(0, goal.target - bal) : 0;

  const extraProfit = extraSales * avgProfitPerSale;
  const wasteSaved = monthlyWaste * (wasteCutPct / 100);
  const totalBoost = extraProfit + wasteSaved;

  const currentPaceDays = goal ? daysAtPace(remaining, todayFundGrowth(data, goal.fundId)) : null;
  const boostedDailyGrowth = goal ? todayFundGrowth(data, goal.fundId) + (totalBoost * (fund?.pct || 0) / 100) / 30 : null;
  const newPaceDays = goal && boostedDailyGrowth > 0 ? daysAtPace(remaining, boostedDailyGrowth) : null;

  return (
    <>
      <SectionLabel text="WHAT-IF SIMULATOR" />
      <div style={S.heroCard}>
        {avgProfitPerSale === 0 && <div style={{ fontSize: 10.5, color: T.muted, marginBottom: 8 }}>LOG A FEW SOLD ORDERS TO UNLOCK ACCURATE SIMULATION</div>}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: T.ivory }}>SELL {extraSales} MORE ITEMS</span>
            <span style={{ color: T.green, fontWeight: 700 }} className="tnum">+{fmt(extraProfit)}</span>
          </div>
          <input type="range" min={0} max={20} value={extraSales} onChange={(e) => setExtraSales(Number(e.target.value))} style={{ width: "100%", marginTop: 6 }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: T.ivory }}>CUT WASTE BY {wasteCutPct}%</span>
            <span style={{ color: T.green, fontWeight: 700 }} className="tnum">+{fmt(wasteSaved)}</span>
          </div>
          <input type="range" min={0} max={100} step={10} value={wasteCutPct} onChange={(e) => setWasteCutPct(Number(e.target.value))} style={{ width: "100%", marginTop: 6 }} />
        </div>

        <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 10 }}>
          <div style={{ fontSize: 10.5, color: T.muted }}>TOTAL EXTRA THIS MONTH</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: T.purple }} className="tnum">{fmt(totalBoost)}</div>
          {goal && (totalBoost > 0) && (
            <div style={{ fontSize: 11, color: T.green, marginTop: 6, fontWeight: 700 }} className="tnum">
              "{goal.name}" GOAL: {currentPaceDays !== null ? `${currentPaceDays}D` : "—"} → {newPaceDays !== null ? `${newPaceDays}D` : "—"} AT THIS PACE
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ExportSection({ data }) {
  const [open, setOpen] = useState(null); // null | 'csv' | 'report'
  const [copied, setCopied] = useState(false);

  const text = open === "csv" ? buildCSVText(data) : open === "report" ? buildReportText(data) : "";

  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    setCopied(ok);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <SectionLabel text="EXPORT DATA" />
      <div style={{ fontSize: 10.5, color: T.muted, marginBottom: 10 }}>OPENS A COPYABLE VIEW — PASTE INTO SHEETS, DOCS, OR ANYWHERE YOU NEED IT</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button style={S.exportBtn} className="npop" onClick={() => setOpen("csv")}>
          <FileDown size={15} color={T.green} /> COPY AS CSV (PASTE INTO SHEETS)
        </button>
        <button style={S.exportBtn} className="npop" onClick={() => setOpen("report")}>
          <Printer size={15} color={T.orange} /> COPY / VIEW SUMMARY REPORT
        </button>
      </div>

      {open && (
        <div style={S.calcOverlay} onClick={() => setOpen(null)}>
          <div style={S.calcModal} onClick={(e) => e.stopPropagation()}>
            <div style={S.calcHeader}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.ivory }}>{open === "csv" ? "CSV DATA" : "SUMMARY REPORT"}</div>
              <button style={S.calcCloseBtn} onClick={() => setOpen(null)}><X size={16} color={T.ivory} /></button>
            </div>
            <div style={{ fontSize: 10, color: T.muted, marginBottom: 8 }}>TAP THE BOX, SELECT ALL, COPY — OR USE THE BUTTON BELOW</div>
            <textarea
              readOnly
              value={text}
              onFocus={(e) => e.target.select()}
              style={{ ...S.input, width: "100%", height: 220, fontSize: 10.5, fontFamily: "monospace", resize: "vertical" }}
            />
            <button style={{ ...S.submitBtnGreen, marginTop: 10 }} className="npop" onClick={handleCopy}>
              {copied ? "COPIED ✓" : "COPY TO CLIPBOARD"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ChartCard({ title, children, height = 200 }) {
  return (
    <div style={S.heroCard}>
      <div style={S.heroLabel}>{title}</div>
      <div style={{ marginTop: 10 }}>
        <ResponsiveContainer width="100%" height={height}>
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AnalyticsTab({ data, persist }) {
  const [trendRange, setTrendRange] = useState("6m");
  const cur = currentMonthKey();
  const lastMonthDate = new Date();
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;

  const monthIncome = (mk) => data.income.filter((e) => monthKey(e.date) === mk).reduce((s, e) => s + e.amount, 0);
  const monthExpense = (mk) => data.expenses.filter((e) => monthKey(e.date) === mk).reduce((s, e) => s + e.amount, 0);

  const curInc = monthIncome(cur), curExp = monthExpense(cur), curProfit = curInc - curExp;
  const lastInc = monthIncome(lastMonth), lastExp = monthExpense(lastMonth), lastProfit = lastInc - lastExp;

  const incomeGrowth = lastInc > 0 ? Math.round(((curInc - lastInc) / lastInc) * 1000) / 10 : null;
  const profitMargin = curInc > 0 ? Math.round((curProfit / curInc) * 1000) / 10 : 0;
  const savingsRate = curInc > 0 ? Math.round((Math.max(0, curProfit) / curInc) * 1000) / 10 : 0;

  const totalIncome = data.income.reduce((s, e) => s + e.amount, 0);
  const totalExpense = data.expenses.reduce((s, e) => s + e.amount, 0);
  const wasteTotal = data.expenses.filter((e) => e.unnecessary).reduce((s, e) => s + e.amount, 0);
  const wasteRatio = totalExpense > 0 ? Math.round((wasteTotal / totalExpense) * 1000) / 10 : 0;
  const fineTotal = data.expenses.reduce((s, e) => s + (e.fine || 0), 0);

  const cashBalance = totalIncome - totalExpense;
  const totalInvested = data.investments.reduce((s, i) => s + i.amount, 0);
  const totalReceivable = data.receivables.filter((r) => r.status !== "received").reduce((s, r) => s + r.amount, 0);
  const totalPayable = data.payables.filter((p) => p.status !== "paid").reduce((s, p) => s + p.amount, 0);
  const netWorth = computeNetWorthQuick(data);

  const avgTxnSize = data.expenses.length > 0 ? totalExpense / data.expenses.length : 0;
  const debtToIncomeRatio = totalIncome > 0 ? Math.round((totalPayable / totalIncome) * 1000) / 10 : 0;
  const oldestReceivable = [...data.receivables].filter((r) => r.status !== "received").sort((a, b) => a.id - b.id)[0];
  const ageingDays = oldestReceivable ? daysBetween(oldestReceivable.dueDate || todayISO(), todayISO()) : null;

  // 6-month trend
  const trendData = useMemo(() => buildTrendSeries(data, trendRange), [data.income, data.expenses, trendRange]);

  const netWorthPieData = [
    { name: "Cash", value: Math.max(0, cashBalance), color: T.green },
    { name: "Invested", value: totalInvested, color: T.purple },
    { name: "Receivable", value: totalReceivable, color: T.blue },
  ].filter((d) => d.value > 0);

  const fundPieData = data.funds.map((f) => ({ name: f.name, value: data.fundBalances[f.id] || 0, color: f.color })).filter((d) => d.value > 0);

  const topExpenseCats = useMemo(() => {
    const map = {};
    data.expenses.forEach((e) => { map[e.category] = (map[e.category] || 0) + e.amount; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value }));
  }, [data.expenses]);
  const topIncomeSrcs = useMemo(() => {
    const map = {};
    data.income.forEach((e) => { map[e.source] = (map[e.source] || 0) + e.amount; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value }));
  }, [data.income]);

  // net worth history — running snapshot at each month-end, last 6 months
  const netWorthHistory = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const incTillNow = data.income.filter((e) => monthKey(e.date) <= mk).reduce((s, e) => s + e.amount, 0);
      const expTillNow = data.expenses.filter((e) => monthKey(e.date) <= mk).reduce((s, e) => s + e.amount, 0);
      const invTillNow = data.investments.filter((iv) => monthKey(iv.date) <= mk).reduce((s, iv) => s + iv.amount, 0);
      const nw = data.openingBalance + (incTillNow - expTillNow) + invTillNow;
      months.push({ month: d.toLocaleDateString("en-IN", { month: "short" }), netWorth: Math.round(nw) });
    }
    return months;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.income, data.expenses, data.investments, data.openingBalance]);

  // long-term wealth projection — based on average monthly net worth growth
  const wealthProjection = useMemo(() => {
    const currentNW = netWorthHistory[netWorthHistory.length - 1]?.netWorth || 0;
    const firstNW = netWorthHistory[0]?.netWorth || 0;
    const monthsSpan = netWorthHistory.length - 1;
    const avgMonthlyGrowth = monthsSpan > 0 ? (currentNW - firstNW) / monthsSpan : 0;
    const milestones = [500000, 1000000, 2500000, 5000000, 10000000];
    const rows = milestones
      .filter((m) => m > currentNW)
      .map((m) => ({
        milestone: m,
        months: avgMonthlyGrowth > 0 ? Math.ceil((m - currentNW) / avgMonthlyGrowth) : null,
      }));
    return { currentNW, avgMonthlyGrowth, rows: rows.slice(0, 3) };
  }, [netWorthHistory]);

  // recurring expense detection — same category appearing with similar amount across 2+ consecutive months
  const recurringExpenses = useMemo(() => {
    const byCategory = {};
    data.expenses.filter((e) => !e.unnecessary).forEach((e) => {
      if (!byCategory[e.category]) byCategory[e.category] = [];
      byCategory[e.category].push(e);
    });
    const found = [];
    Object.entries(byCategory).forEach(([cat, entries]) => {
      const byMonth = {};
      entries.forEach((e) => {
        const mk = monthKey(e.date);
        if (!byMonth[mk]) byMonth[mk] = [];
        byMonth[mk].push(e.amount);
      });
      const monthKeys = Object.keys(byMonth).sort();
      if (monthKeys.length < 2) return;
      const avgByMonth = monthKeys.map((mk) => byMonth[mk].reduce((s, a) => s + a, 0) / byMonth[mk].length);
      let consecutive = 1;
      let maxConsecutive = 1;
      for (let i = 1; i < avgByMonth.length; i++) {
        const diff = Math.abs(avgByMonth[i] - avgByMonth[i - 1]) / Math.max(avgByMonth[i - 1], 1);
        if (diff <= 0.15) { consecutive++; maxConsecutive = Math.max(maxConsecutive, consecutive); } else consecutive = 1;
      }
      if (maxConsecutive >= 2) {
        found.push({ category: cat, avgAmount: avgByMonth[avgByMonth.length - 1], months: monthKeys.length });
      }
    });
    return found.sort((a, b) => b.avgAmount - a.avgAmount).slice(0, 6);
  }, [data.expenses]);

  // anomaly detection — expenses significantly above their category's average
  const anomalies = useMemo(() => {
    const byCategory = {};
    data.expenses.forEach((e) => {
      if (!byCategory[e.category]) byCategory[e.category] = [];
      byCategory[e.category].push(e);
    });
    const flagged = [];
    Object.values(byCategory).forEach((entries) => {
      if (entries.length < 3) return;
      const avg = entries.reduce((s, e) => s + e.amount, 0) / entries.length;
      entries.forEach((e) => {
        if (e.amount >= avg * 2 && e.amount - avg >= 500) {
          flagged.push({ ...e, avg });
        }
      });
    });
    return flagged.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  }, [data.expenses]);

  // 30-day cash flow forecast
  const forecast30 = useMemo(() => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const recentExpense = data.expenses.filter((e) => e.date >= thirtyDaysAgo).reduce((s, e) => s + e.amount, 0);
    const dailyBurn = recentExpense / 30;
    const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const today30 = todayISO();
    const expectedReceivables = data.receivables.filter((r) => r.status !== "received" && r.dueDate && r.dueDate >= today30 && r.dueDate <= in30Days).reduce((s, r) => s + r.amount, 0);
    const expectedPayables = data.payables.filter((p) => p.status !== "paid" && p.dueDate && p.dueDate >= today30 && p.dueDate <= in30Days).reduce((s, p) => s + p.amount, 0);
    const projectedBalance = cashBalance + expectedReceivables - expectedPayables - dailyBurn * 30;
    return { dailyBurn, expectedReceivables, expectedPayables, projectedBalance };
  }, [data.expenses, data.receivables, data.payables, cashBalance]);

  // merchant/party breakdown — from sold orders + dues
  const merchantData = useMemo(() => {
    const map = {};
    data.income.filter((e) => e.source === "Sold Order").forEach((e) => {
      const name = e.note?.split(" — ")[0] || "Unknown";
      map[name] = (map[name] || 0) + e.amount;
    });
    [...data.receivables, ...data.payables].forEach((d) => {
      map[d.party] = (map[d.party] || 0) + d.amount;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value }));
  }, [data.income, data.receivables, data.payables]);

  // financial calendar — current month day-by-day activity map
  const calendarDays = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Sun
    const leadingBlanks = (firstDayOfWeek + 6) % 7; // convert to Monday-start
    const days = [];
    for (let i = 0; i < leadingBlanks; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const hasIncome = data.income.some((e) => e.date === iso);
      const hasExpense = data.expenses.some((e) => e.date === iso);
      const dueDay = data.fixedExpenses.some((fe) => fe.dueDay === d);
      days.push({ d, iso, hasIncome, hasExpense, dueDay, isToday: iso === todayISO() });
    }
    return days;
  }, [data.income, data.expenses, data.fixedExpenses]);

  // activity heatmap — last 12 weeks of daily profit, github-style
  const heatmapWeeks = useMemo(() => {
    const weeks = [];
    const todayD = new Date();
    const startMonday = mondayOf(todayD.toISOString().slice(0, 10));
    for (let w = 11; w >= 0; w--) {
      const weekStart = new Date(new Date(startMonday + "T00:00:00").getTime() - w * 7 * 86400000);
      const days = [];
      for (let d = 0; d < 7; d++) {
        const dt = new Date(weekStart.getTime() + d * 86400000);
        const iso = dt.toISOString().slice(0, 10);
        if (iso > todayISO()) { days.push(null); continue; }
        const inc = data.income.filter((e) => e.date === iso).reduce((s, e) => s + e.amount, 0);
        const exp = data.expenses.filter((e) => e.date === iso).reduce((s, e) => s + e.amount, 0);
        days.push({ iso, profit: inc - exp, hasActivity: inc > 0 || exp > 0 });
      }
      weeks.push(days);
    }
    return weeks;
  }, [data.income, data.expenses]);

  // ghost mode — race current month's cumulative profit against best-ever completed month, day-for-day
  const ghostMode = useMemo(() => {
    if (data.auditedMonths.length === 0) return null;
    const best = [...data.auditedMonths].sort((a, b) => b.netProfit - a.netProfit)[0];
    if (!best || best.netProfit <= 0) return null;
    const dayOfMonth = new Date().getDate();
    const [by, bm] = best.month.split("-");
    const bestMonthDays = new Date(Number(by), Number(bm), 0).getDate();
    const cappedDay = Math.min(dayOfMonth, bestMonthDays);
    const bestEnd = `${best.month}-${String(cappedDay).padStart(2, "0")}`;
    const bestInc = data.income.filter((e) => e.date >= `${best.month}-01` && e.date <= bestEnd).reduce((s, e) => s + e.amount, 0);
    const bestExp = data.expenses.filter((e) => e.date >= `${best.month}-01` && e.date <= bestEnd).reduce((s, e) => s + e.amount, 0);
    const bestSoFar = bestInc - bestExp;
    const curMonthNow = currentMonthKey();
    const curInc = data.income.filter((e) => monthKey(e.date) === curMonthNow).reduce((s, e) => s + e.amount, 0);
    const curExp = data.expenses.filter((e) => monthKey(e.date) === curMonthNow).reduce((s, e) => s + e.amount, 0);
    const curSoFar = curInc - curExp;
    return { bestMonth: best.month, bestTotal: best.netProfit, bestSoFar, curSoFar, diff: curSoFar - bestSoFar };
  }, [data.auditedMonths, data.income, data.expenses]);

  // what-if simulator base numbers
  const soldOrders = data.income.filter((e) => e.source === "Sold Order");
  const avgProfitPerSale = soldOrders.length > 0 ? soldOrders.reduce((s, e) => s + e.amount, 0) / soldOrders.length : 0;
  const monthlyWaste = data.expenses.filter((e) => e.unnecessary && monthKey(e.date) === cur).reduce((s, e) => s + e.amount, 0);

  return (
    <div>
      <ExportSection data={data} />

      <SectionLabel text="CASH FLOW" noMargin />
      <div style={S.statGrid}>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>PROFIT MARGIN</div>
          <div style={{ ...S.statBoxNum, color: profitMargin >= 0 ? T.green : T.orange }} className="tnum">{profitMargin}%</div>
        </div>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>SAVINGS RATE</div>
          <div style={{ ...S.statBoxNum, color: T.purple }} className="tnum">{savingsRate}%</div>
        </div>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>MoM INCOME GROWTH</div>
          <div style={{ ...S.statBoxNum, color: incomeGrowth === null ? T.muted : incomeGrowth >= 0 ? T.green : T.orange }} className="tnum">
            {incomeGrowth === null ? "N/A" : `${incomeGrowth > 0 ? "+" : ""}${incomeGrowth}%`}
          </div>
        </div>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>THIS MONTH PROFIT</div>
          <div style={{ ...S.statBoxNum, color: curProfit >= 0 ? T.green : T.orange }} className="tnum">{fmtSigned(curProfit)}</div>
        </div>
      </div>

      <SectionLabel text="TRENDS" />
      <TrendRangePicker range={trendRange} setRange={setTrendRange} />

      <ChartCard title="INCOME TREND">
        <LineChart data={trendData}>
          <CartesianGrid stroke={T.line} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: T.muted, fontSize: 9, fontFamily: "'Space Grotesk', sans-serif" }} axisLine={{ stroke: T.line }} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: T.muted, fontSize: 10, fontFamily: "'Space Grotesk', sans-serif" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={36} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: T.muted }} formatter={(v) => fmt(v)} />
          <Line type="monotone" dataKey="income" stroke={T.green} strokeWidth={2.5} dot={{ r: 2.5 }} name="Income" />
        </LineChart>
      </ChartCard>

      <ChartCard title="EXPENSE TREND">
        <LineChart data={trendData}>
          <CartesianGrid stroke={T.line} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: T.muted, fontSize: 9, fontFamily: "'Space Grotesk', sans-serif" }} axisLine={{ stroke: T.line }} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: T.muted, fontSize: 10, fontFamily: "'Space Grotesk', sans-serif" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={36} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: T.muted }} formatter={(v) => fmt(v)} />
          <Line type="monotone" dataKey="expense" stroke={T.orange} strokeWidth={2.5} dot={{ r: 2.5 }} name="Expense" />
        </LineChart>
      </ChartCard>

      <ChartCard title="PROFIT TREND">
        <LineChart data={trendData}>
          <CartesianGrid stroke={T.line} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: T.muted, fontSize: 9, fontFamily: "'Space Grotesk', sans-serif" }} axisLine={{ stroke: T.line }} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: T.muted, fontSize: 10, fontFamily: "'Space Grotesk', sans-serif" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={36} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: T.muted }} formatter={(v) => fmt(v)} />
          <Line type="monotone" dataKey="profit" stroke={T.purple} strokeWidth={2.5} dot={{ r: 2.5 }} name="Profit" />
        </LineChart>
      </ChartCard>

      <SectionLabel text="NET WORTH HISTORY" />
      <ChartCard title="6-MONTH NET WORTH TREND">
        <LineChart data={netWorthHistory}>
          <CartesianGrid stroke={T.line} vertical={false} />
          <XAxis dataKey="month" tick={{ fill: T.muted, fontSize: 10, fontFamily: "'Space Grotesk', sans-serif" }} axisLine={{ stroke: T.line }} tickLine={false} />
          <YAxis tick={{ fill: T.muted, fontSize: 10, fontFamily: "'Space Grotesk', sans-serif" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={36} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: T.muted }} formatter={(v) => fmt(v)} />
          <Line type="monotone" dataKey="netWorth" stroke={T.gold || T.green} strokeWidth={2.5} dot={{ r: 3 }} name="Net Worth" />
        </LineChart>
      </ChartCard>

      <SectionLabel text="LONG-TERM WEALTH PROJECTION" />
      <div style={{ ...S.heroCard, boxShadow: `4px 4px 0px ${T.gold || T.green}` }}>
        <div style={S.heroLabel}>AT CURRENT PACE ({fmtSigned(wealthProjection.avgMonthlyGrowth)}/MO)</div>
        {wealthProjection.avgMonthlyGrowth <= 0 ? (
          <div style={{ fontSize: 12, color: T.orange, marginTop: 8, fontWeight: 700 }}>
            NET WORTH ISN'T TRENDING UP YET — LOG MORE MONTHS TO SEE A PROJECTION
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
            {wealthProjection.rows.map((r) => (
              <div key={r.milestone} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }} className="tnum">
                <span style={{ fontSize: 13, color: T.ivory, fontWeight: 700 }}>{fmt(r.milestone)}</span>
                <span style={{ fontSize: 12, color: T.gold || T.green, fontWeight: 700 }}>
                  ~{r.months} MO{r.months !== 1 ? "S" : ""} ({Math.round(r.months / 12 * 10) / 10}Y)
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <SectionLabel text="NET WORTH BREAKDOWN" />
      <div style={S.heroCard}>
        <div style={S.heroLabel}>TOTAL NET WORTH</div>
        <div style={{ ...S.heroNum, color: netWorth >= 0 ? T.ivory : T.orange }} className="tnum">{fmtSigned(netWorth)}</div>
        {netWorthPieData.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={netWorthPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2}>
                  {netWorthPieData.map((d, i) => <Cell key={i} fill={d.color} stroke={T.bg} strokeWidth={2} />)}
                </Pie>
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 10, fontFamily: "'Space Grotesk', sans-serif" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <SectionLabel text="DISCIPLINE" />
      <div style={S.statGrid}>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>WASTE RATIO</div>
          <div style={{ ...S.statBoxNum, color: wasteRatio > 15 ? T.orange : T.green }} className="tnum">{wasteRatio}%</div>
        </div>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>TOTAL FINES</div>
          <div style={{ ...S.statBoxNum, color: T.orange }} className="tnum">{fmt(fineTotal)}</div>
        </div>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>CURRENT STREAK</div>
          <div style={{ ...S.statBoxNum, color: T.green }} className="tnum">{data.streak.count}D</div>
        </div>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>PROFIT LEVEL</div>
          <div style={{ ...S.statBoxNum, color: T.green }} className="tnum">LV.{data.profitLevel}</div>
        </div>
      </div>

      <SectionLabel text="TOP EXPENSE CATEGORIES" />
      {topExpenseCats.length === 0 ? <EmptyNote text="no expenses logged yet" /> : (
        <ChartCard title="BY CATEGORY" height={Math.max(140, topExpenseCats.length * 34)}>
          <BarChart data={topExpenseCats} layout="vertical" margin={{ left: 8, right: 16 }}>
            <XAxis type="number" hide />
            <YAxis dataKey="name" type="category" width={100} tick={{ fill: T.ivory, fontSize: 10, fontFamily: "'Space Grotesk', sans-serif" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => fmt(v)} cursor={{ fill: T.line, opacity: 0.3 }} />
            <Bar dataKey="value" radius={[0, 3, 3, 0]}>
              {topExpenseCats.map((_, i) => <Cell key={i} fill={T.orange} fillOpacity={1 - i * 0.12} />)}
            </Bar>
          </BarChart>
        </ChartCard>
      )}

      <SectionLabel text="TOP INCOME SOURCES" />
      {topIncomeSrcs.length === 0 ? <EmptyNote text="no income logged yet" /> : (
        <ChartCard title="BY SOURCE" height={Math.max(140, topIncomeSrcs.length * 34)}>
          <BarChart data={topIncomeSrcs} layout="vertical" margin={{ left: 8, right: 16 }}>
            <XAxis type="number" hide />
            <YAxis dataKey="name" type="category" width={100} tick={{ fill: T.ivory, fontSize: 10, fontFamily: "'Space Grotesk', sans-serif" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => fmt(v)} cursor={{ fill: T.line, opacity: 0.3 }} />
            <Bar dataKey="value" radius={[0, 3, 3, 0]}>
              {topIncomeSrcs.map((_, i) => <Cell key={i} fill={T.green} fillOpacity={1 - i * 0.12} />)}
            </Bar>
          </BarChart>
        </ChartCard>
      )}

      <BudgetVsActual data={data} persist={persist} />

      <SectionLabel text="RECURRING / SUBSCRIPTIONS DETECTED" />
      {recurringExpenses.length === 0 ? <EmptyNote text="log a category across 2+ months to detect patterns" /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {recurringExpenses.map((r) => (
            <div key={r.category} style={{ ...S.statBox, boxShadow: `3px 3px 0px ${T.purple}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.ivory }}>{r.category.toUpperCase()}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.purple }} className="tnum">~{fmt(r.avgAmount)}/mo</span>
              </div>
              <div style={{ fontSize: 10, color: T.muted, marginTop: 3 }}>SEEN IN {r.months} MONTHS</div>
            </div>
          ))}
        </div>
      )}

      <SectionLabel text="ANOMALY ALERTS" />
      {anomalies.length === 0 ? <EmptyNote text="no unusual spending detected" /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {anomalies.map((a) => (
            <div key={a.id} style={{ ...S.statBox, boxShadow: `3px 3px 0px ${T.orange}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.ivory }}>{a.category.toUpperCase()}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.orange }} className="tnum">{fmt(a.amount)}</span>
              </div>
              <div style={{ fontSize: 10, color: T.muted, marginTop: 3 }} className="tnum">{fmtDate(a.date)} · CATEGORY AVG IS {fmt(a.avg)}</div>
            </div>
          ))}
        </div>
      )}

      <SectionLabel text="30-DAY CASH FLOW FORECAST" />
      <div style={{ ...S.heroCard, boxShadow: `4px 4px 0px ${forecast30.projectedBalance >= 0 ? T.green : T.orange}` }}>
        <div style={S.heroLabel}>PROJECTED BALANCE IN 30 DAYS</div>
        <div style={{ ...S.heroNum, color: forecast30.projectedBalance >= 0 ? T.ivory : T.orange }} className="tnum">{fmtSigned(forecast30.projectedBalance)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10, fontSize: 11 }} className="tnum">
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: T.muted }}>DAILY BURN RATE (30D AVG)</span><span style={{ color: T.orange }}>{fmt(forecast30.dailyBurn)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: T.muted }}>EXPECTED RECEIVABLES (30D)</span><span style={{ color: T.green }}>+{fmt(forecast30.expectedReceivables)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: T.muted }}>EXPECTED PAYABLES (30D)</span><span style={{ color: T.orange }}>−{fmt(forecast30.expectedPayables)}</span></div>
        </div>
      </div>

      <SectionLabel text="MERCHANT / PARTY BREAKDOWN" />
      {merchantData.length === 0 ? <EmptyNote text="log Sold Orders or Dues to see who you do business with most" /> : (
        <ChartCard title="TOP PARTIES BY VALUE" height={Math.max(140, merchantData.length * 34)}>
          <BarChart data={merchantData} layout="vertical" margin={{ left: 8, right: 16 }}>
            <XAxis type="number" hide />
            <YAxis dataKey="name" type="category" width={100} tick={{ fill: T.ivory, fontSize: 10, fontFamily: "'Space Grotesk', sans-serif" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => fmt(v)} cursor={{ fill: T.line, opacity: 0.3 }} />
            <Bar dataKey="value" radius={[0, 3, 3, 0]}>
              {merchantData.map((_, i) => <Cell key={i} fill={T.blue} fillOpacity={1 - i * 0.12} />)}
            </Bar>
          </BarChart>
        </ChartCard>
      )}

      <SectionLabel text="FINANCIAL CALENDAR" />
      <div style={S.heroCard}>
        <div style={S.heroLabel}>{new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" }).toUpperCase()}</div>
        <div style={S.calGridHeader}>
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} style={S.calDayLabel}>{d}</span>)}
        </div>
        <div style={S.calGrid}>
          {calendarDays.map((day, i) => (
            <div key={i} style={{ ...S.calCell, ...(day?.isToday ? { border: `1.5px solid ${T.gold || T.green}` } : {}) }}>
              {day && (
                <>
                  <span style={{ fontSize: 9.5, color: day.isToday ? (T.gold || T.green) : T.muted, fontWeight: day.isToday ? 700 : 400 }}>{day.d}</span>
                  <div style={{ display: "flex", gap: 2, marginTop: 2 }}>
                    {day.hasIncome && <span style={{ width: 4, height: 4, borderRadius: "50%", background: T.green }} />}
                    {day.hasExpense && <span style={{ width: 4, height: 4, borderRadius: "50%", background: T.orange }} />}
                    {day.dueDay && <span style={{ width: 4, height: 4, borderRadius: "50%", background: T.purple }} />}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 9, color: T.muted }}>
          <span><span style={{ color: T.green }}>●</span> INCOME</span>
          <span><span style={{ color: T.orange }}>●</span> EXPENSE</span>
          <span><span style={{ color: T.purple }}>●</span> FIXED DUE</span>
        </div>
      </div>

      <SectionLabel text="ACTIVITY HEATMAP — LAST 12 WEEKS" />
      <div style={S.heroCard}>
        <div style={{ display: "flex", gap: 3, overflowX: "auto", paddingBottom: 4 }}>
          {heatmapWeeks.map((week, wi) => (
            <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {week.map((day, di) => {
                let bg = T.line;
                if (day) {
                  if (!day.hasActivity) bg = T.bg;
                  else if (day.profit > 0) bg = T.green;
                  else if (day.profit < 0) bg = T.orange;
                  else bg = T.muted;
                }
                return <div key={di} style={{ width: 12, height: 12, background: day ? bg : "transparent", opacity: day && day.profit > 0 ? Math.min(1, 0.4 + Math.abs(day.profit) / 5000) : 1, border: `1px solid ${T.line}` }} />;
              })}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 9, color: T.muted }}>
          <span><span style={{ color: T.green }}>■</span> PROFIT DAY</span>
          <span><span style={{ color: T.orange }}>■</span> LOSS DAY</span>
          <span><span style={{ color: T.bg, border: `1px solid ${T.line}` }}>■</span> NO ACTIVITY</span>
        </div>
      </div>

      {ghostMode && (
        <>
          <SectionLabel text="GHOST MODE — VS YOUR BEST MONTH" />
          <div style={{ ...S.heroCard, boxShadow: `4px 4px 0px ${ghostMode.diff >= 0 ? T.green : T.orange}` }}>
            <div style={S.heroLabel}>RACING AGAINST {monthLabel(ghostMode.bestMonth).toUpperCase()} (BEST: {fmt(ghostMode.bestTotal)})</div>
            <div style={{ ...S.heroNum, color: ghostMode.diff >= 0 ? T.green : T.orange }} className="tnum">
              {ghostMode.diff >= 0 ? "AHEAD BY " : "BEHIND BY "}{fmt(Math.abs(ghostMode.diff))}
            </div>
            <div style={{ fontSize: 10.5, color: T.muted, marginTop: 6 }} className="tnum">
              YOU: {fmt(ghostMode.curSoFar)} · GHOST (SAME DAY): {fmt(ghostMode.bestSoFar)}
            </div>
          </div>
        </>
      )}

      <WhatIfSimulator data={data} avgProfitPerSale={avgProfitPerSale} monthlyWaste={monthlyWaste} />

      <SectionLabel text="FUND DISTRIBUTION" />
      {fundPieData.length === 0 ? <EmptyNote text="funds will show up here once they have a balance" /> : (
        <div style={S.heroCard}>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={fundPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} paddingAngle={2} label={{ fill: T.ivory, fontSize: 10, fontFamily: "'Space Grotesk', sans-serif" }}>
                {fundPieData.map((d, i) => <Cell key={i} fill={d.color} stroke={T.bg} strokeWidth={2} />)}
              </Pie>
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => fmt(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      <SectionLabel text="SAFETY & EFFICIENCY" />
      <div style={S.statGrid}>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>DEBT-TO-INCOME</div>
          <div style={{ ...S.statBoxNum, color: debtToIncomeRatio > 30 ? T.orange : T.green }} className="tnum">{debtToIncomeRatio}%</div>
        </div>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>AVG EXPENSE SIZE</div>
          <div style={{ ...S.statBoxNum, color: T.purple }} className="tnum">{fmt(avgTxnSize)}</div>
        </div>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>OLDEST RECEIVABLE</div>
          <div style={{ ...S.statBoxNum, color: ageingDays > 30 ? T.orange : T.muted }} className="tnum">{ageingDays !== null ? `${ageingDays}D` : "—"}</div>
        </div>
        <div style={S.statBox}>
          <div style={S.statBoxLabel}>TOTAL PAYABLE</div>
          <div style={{ ...S.statBoxNum, color: T.orange }} className="tnum">{fmt(totalPayable)}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Shared bits ---------------- */

function SectionLabel({ text, noMargin }) {
  return <div style={{ ...S.sectionLabel, marginTop: noMargin ? 0 : 20 }}>{text}</div>;
}
function EmptyNote({ text }) {
  return <div style={S.emptyNote}>{text}</div>;
}

/* ---------------- NeoPOP tokens + styles ---------------- */

const T = {
  bg: "#0D0D0D",
  surface: "#161616",
  surfaceHi: "#1E1E1E",
  line: "#2A2A2A",
  green: "#E5FE40",
  purple: "#6A35FF",
  orange: "#FF5C35",
  blue: "#35C9FF",
  ivory: "#F5F5F0",
  muted: "#7A7A7A",
};

const S = {
  app: { minHeight: "100vh", background: T.bg, color: T.ivory, fontFamily: "'Space Grotesk', sans-serif", paddingBottom: 84 },
  topBar: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "20px 18px 16px 18px", position: "sticky", top: 0, background: T.bg, zIndex: 10, borderBottom: `2px solid ${T.line}` },
  wordmark: { fontSize: 22, fontWeight: 700, letterSpacing: "0.03em" },
  whyBanner: { background: T.surface, border: `2.5px solid ${T.gold || T.green}`, boxShadow: "4px 4px 0px #000", padding: "14px 14px", marginTop: 12, marginBottom: 12, cursor: "pointer" },
  whyLabel: { fontSize: 9.5, fontWeight: 700, color: T.gold || T.green, letterSpacing: "0.05em" },
  whyText: { fontSize: 13.5, fontWeight: 700, color: T.ivory, lineHeight: 1.5, marginTop: 6 },
  whyPlaceholder: { fontSize: 11.5, color: T.muted, marginTop: 6, fontWeight: 600 },
  whyVisionCard: { flexShrink: 0, width: 130, background: T.surface, border: `1.5px solid ${T.line}`, boxShadow: "2px 2px 0px #000" },
  whyVisionImg: { width: "100%", height: 80, objectFit: "cover", display: "block", background: T.bg },
  permanentQuoteCard: { background: `linear-gradient(135deg, ${T.surface}, ${T.bg})`, border: `2px solid ${T.gold || T.green}`, boxShadow: `4px 4px 0px ${T.gold || T.green}`, padding: "18px 16px", marginBottom: 16 },
  permanentQuoteText: { fontSize: 13, fontStyle: "italic", color: T.ivory, lineHeight: 1.65, fontWeight: 500 },
  smsBanner: { width: "100%", background: T.blue, border: "2px solid #000", boxShadow: "3px 3px 0px #000", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: T.bg, marginBottom: 10, fontFamily: "'Space Grotesk', sans-serif" },
  littleJeetCard: { background: T.surface, border: `2px solid ${T.blue}`, boxShadow: `4px 4px 0px ${T.blue}`, padding: "14px 14px", marginBottom: 12 },
  littleJeetLabel: { fontSize: 9.5, fontWeight: 700, color: T.blue, letterSpacing: "0.05em" },
  littleJeetText: { fontSize: 12.5, color: T.ivory, lineHeight: 1.55, marginTop: 6 },
  ruthlessBanner: { background: T.orange, border: "2.5px solid #000", boxShadow: "4px 4px 0px #000", padding: "16px 14px", marginBottom: 12 },
  ruthlessText: { fontSize: 15, fontWeight: 700, color: T.bg, lineHeight: 1.4, letterSpacing: "-0.01em" },
  quoteBanner: { textAlign: "center", padding: "10px 8px", marginBottom: 10, minHeight: 34, display: "flex", alignItems: "center", justifyContent: "center" },
  quoteText: { fontSize: 12, fontStyle: "italic", color: T.gold || T.green, fontWeight: 600, letterSpacing: "0.01em", transition: "opacity 0.35s ease" },
  saveDot: { fontSize: 9.5, color: T.green, transition: "opacity 0.3s", height: 12, marginTop: 4, fontWeight: 700, letterSpacing: "0.05em" },
  clockRow: { fontSize: 10.5, color: T.muted, marginTop: 3, fontWeight: 600, letterSpacing: "0.03em" },
  nextCountryRow: { display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: T.green, marginTop: 3, fontWeight: 700, letterSpacing: "0.03em" },
  headerStats: { display: "flex", gap: 8 },
  statChip: { display: "flex", alignItems: "center", gap: 5, background: T.surface, border: `1.5px solid ${T.line}`, boxShadow: "2px 2px 0px #000", padding: "6px 10px", fontSize: 11, fontWeight: 700, color: T.ivory },

  bottomNav: { position: "fixed", bottom: 0, left: 0, right: 0, background: T.surface, borderTop: `2px solid ${T.line}`, display: "flex", justifyContent: "space-around", padding: "10px 4px calc(env(safe-area-inset-bottom, 4px) + 10px) 4px", zIndex: 20 },
  navBtn: { background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1, padding: "2px 0" },
  navIconWrap: { width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" },
  navLabel: { fontSize: 9, fontWeight: 700, letterSpacing: "0.02em" },

  body: { padding: "18px 16px 0 16px", maxWidth: 520, margin: "0 auto" },

  nextUpCard: { background: T.surface, border: `2px solid #000`, padding: "18px 16px", marginBottom: 18 },
  nextUpLabel: { display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, letterSpacing: "0.1em", marginBottom: 8, fontWeight: 700 },
  nextUpName: { fontSize: 22, fontWeight: 700, marginBottom: 12, letterSpacing: "0.01em" },
  nextUpRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  nextUpDaily: { fontSize: 12.5, fontWeight: 700, marginTop: 10, borderTop: "2px solid", paddingTop: 10, letterSpacing: "0.03em" },
  nextUpDate: { fontSize: 10.5, color: T.muted, marginTop: 6, fontWeight: 600 },

  heroCard: { background: T.surface, border: `2px solid ${T.line}`, boxShadow: "4px 4px 0px #000", padding: "20px 18px", marginBottom: 4 },
  heroLabel: { fontSize: 10.5, color: T.muted, letterSpacing: "0.08em", fontWeight: 700 },
  heroNum: { fontSize: 38, fontWeight: 700, marginTop: 6, letterSpacing: "-0.01em" },
  heroSub: { fontSize: 10.5, color: T.muted, marginTop: 6, fontWeight: 600, letterSpacing: "0.02em" },

  sectionLabel: { fontSize: 11, color: T.muted, letterSpacing: "0.1em", marginBottom: 12, borderBottom: `2px solid ${T.line}`, paddingBottom: 9, fontWeight: 700 },
  sectionHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 22, marginBottom: 4, gap: 8 },
  emptyNote: { fontSize: 12.5, color: T.muted, padding: "16px 4px" },

  addBtn: { display: "flex", alignItems: "center", gap: 6, background: T.surface, border: `1.5px solid ${T.line}`, boxShadow: "3px 3px 0px #000", color: T.green, fontSize: 11, padding: "7px 12px", fontFamily: "'Space Grotesk', sans-serif", flexShrink: 0, fontWeight: 700, letterSpacing: "0.03em" },
  formCard: { background: T.surfaceHi, border: `2px solid ${T.line}`, padding: 16, display: "flex", flexDirection: "column", gap: 10, marginBottom: 10, marginTop: 10 },
  formRow: { display: "flex", gap: 10 },
  input: { flex: 1, background: T.bg, border: `1.5px solid ${T.line}`, padding: "10px 10px", color: T.ivory, fontSize: 13 },
  select: { background: T.bg, border: `1.5px solid ${T.line}`, padding: "10px 10px", color: T.ivory, fontSize: 13 },
  submitBtnGreen: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: T.green, color: T.bg, border: "2px solid #000", boxShadow: "3px 3px 0px #000", padding: "11px", fontSize: 12.5, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "0.04em" },
  submitBtnOrange: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: T.orange, color: T.ivory, border: "2px solid #000", boxShadow: "3px 3px 0px #000", padding: "11px", fontSize: 12.5, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "0.04em" },
  submitBtnPurple: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: T.purple, color: T.ivory, border: "2px solid #000", boxShadow: "3px 3px 0px #000", padding: "11px", fontSize: 12.5, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "0.04em" },
  quickRow: { display: "flex", gap: 8 },
  quickBtn: { flex: 1, background: T.surface, border: "2px solid", boxShadow: "3px 3px 0px #000", padding: "12px 4px", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.03em", fontFamily: "'Space Grotesk', sans-serif" },
  miniTypeBtn: { border: "1.5px solid", padding: "6px 10px", fontSize: 10, fontWeight: 700, letterSpacing: "0.03em", fontFamily: "'Space Grotesk', sans-serif" },
  expandPanel: { marginTop: 12, paddingTop: 10, borderTop: `2px solid ${T.line}`, cursor: "default" },
  expandLabel: { fontSize: 9.5, color: T.muted, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 6 },
  timelineBox: { marginBottom: 12, paddingBottom: 12, borderBottom: `2px solid ${T.line}` },
  countdownRow: { display: "flex", gap: 8 },
  countdownUnit: { flex: 1, background: T.bg, border: `1.5px solid ${T.line}`, display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 4px" },
  countdownNum: { fontSize: 18, fontWeight: 700, color: T.ivory },
  countdownLabel: { fontSize: 8, color: T.muted, fontWeight: 700, letterSpacing: "0.05em", marginTop: 2 },
  netWorthFooter: { padding: "14px 4px", marginTop: 24 },
  netWorthFooterLabel: { fontSize: 10, color: T.muted, letterSpacing: "0.08em", fontWeight: 700 },
  netWorthFooterNum: { fontSize: 13, fontWeight: 700 },
  aiTipBtn: { background: T.bg, border: `1.5px solid ${T.purple}`, boxShadow: "2px 2px 0px #000", color: T.purple, fontSize: 10.5, fontWeight: 700, padding: "8px 12px", letterSpacing: "0.03em", fontFamily: "'Space Grotesk', sans-serif", width: "100%" },
  aiTipResult: { background: T.bg, border: `1.5px solid ${T.purple}`, padding: 10, fontSize: 11.5, color: T.ivory, lineHeight: 1.5, marginTop: 4 },

  noteOverlay: {
    position: "fixed", inset: 0, background: "rgba(13,13,13,0.88)", zIndex: 200,
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    pointerEvents: "none", animation: "overlayFade 2.2s ease forwards",
  },
  noteOverlayMsg: { fontSize: 15, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 8, animation: "overlayMsgPulse 0.5s ease" },
  noteOverlayLabel: { fontSize: 34, fontWeight: 700, marginBottom: 22, letterSpacing: "-0.01em" },
  noteStack: { display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", maxWidth: 340 },
  noteCard: {
    width: 128, height: 62, borderRadius: 3, border: "2px solid", position: "relative",
    display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "6px 8px",
    boxShadow: "3px 4px 10px rgba(0,0,0,0.5)", flexShrink: 0,
  },
  noteTopRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  noteValue: { fontSize: 15, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" },
  noteRBIsmall: { fontSize: 7, fontWeight: 700, opacity: 0.8, letterSpacing: "0.05em" },
  noteEmblem: { width: 16, height: 16, borderRadius: "50%", border: "1.5px solid", position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", opacity: 0.5 },
  noteBottomRow: { fontSize: 7, fontWeight: 600, opacity: 0.75 },
  noteLeftover: { fontSize: 11, color: T.muted, marginTop: 16, fontWeight: 700 },
  checkboxRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: T.muted, fontWeight: 600, letterSpacing: "0.02em" },

  ledger: { marginTop: 4 },
  ledgerRow: { display: "flex", alignItems: "center", gap: 8, padding: "12px 6px", borderBottom: `1.5px solid ${T.line}` },
  ledgerDate: { fontSize: 10, color: T.muted, width: 38, flexShrink: 0, fontWeight: 700 },
  ledgerMain: { flex: 1, minWidth: 0 },
  ledgerCategory: { fontSize: 13, color: T.ivory, fontWeight: 600 },
  ledgerNote: { fontSize: 10.5, color: T.muted, marginTop: 2 },
  ledgerAmt: { fontSize: 14, fontWeight: 700, flexShrink: 0 },
  deleteBtn: { background: "none", border: "none", padding: 4, flexShrink: 0, opacity: 0.6 },
  editBtn: { background: "none", border: "none", padding: 4, flexShrink: 0, opacity: 0.6 },
  smallToggle: { background: T.bg, border: `1.5px solid ${T.line}`, padding: 4, flexShrink: 0 },
  fineTag: { fontSize: 9, color: T.orange, border: `1.5px solid ${T.orange}`, padding: "1px 5px", marginLeft: 6, fontWeight: 700, letterSpacing: "0.03em" },
  correctionLink: { background: "none", border: "none", color: T.muted, fontSize: 10, textDecoration: "underline", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, letterSpacing: "0.03em" },
  daysLeftChip: { fontSize: 9.5, fontWeight: 700, border: "1.5px solid", padding: "3px 6px", letterSpacing: "0.02em" },

  photoUploadBtn: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    border: `1.5px dashed ${T.line}`, padding: "14px 8px", fontSize: 10.5, fontWeight: 700,
    color: T.muted, letterSpacing: "0.03em", marginBottom: 10, cursor: "pointer",
  },
  tiltCardWrap: { position: "relative", marginBottom: 10, height: 150, perspective: "700px" },
  tiltCardInner: {
    position: "relative", width: "100%", height: "100%", borderRadius: 4, overflow: "hidden",
    border: `2px solid #000`, boxShadow: "4px 6px 14px rgba(0,0,0,0.5)",
    transition: "transform 0.15s ease-out",
  },
  tiltCardImg: { width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" },
  tiltCardShine: { position: "absolute", inset: 0, pointerEvents: "none" },
  tiltRemoveBtn: { position: "absolute", top: 6, right: 6, background: "rgba(13,13,13,0.75)", border: "1.5px solid #000", padding: 5, zIndex: 5 },

  heatBox: { flex: 1, background: T.surface, border: `1.5px solid ${T.line}`, padding: 12 },
  bossBox: { background: T.surface, border: `2px solid ${T.line}`, padding: 14, marginTop: 10 },
  bossHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  bossName: { fontSize: 15, fontWeight: 700, color: T.ivory, marginTop: 6, letterSpacing: "0.02em" },
  bossHpTrack: { height: 12, background: T.line, marginTop: 8, border: "1.5px solid #000" },
  bossHpFill: { height: "100%", transition: "width 0.4s ease" },

  trophyGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },
  trophyCell: { background: T.surface, border: `1.5px solid ${T.line}`, padding: "10px 4px", display: "flex", flexDirection: "column", alignItems: "center" },

  calGridHeader: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginTop: 14, marginBottom: 4 },
  calDayLabel: { fontSize: 9, color: T.muted, fontWeight: 700, textAlign: "center" },
  calGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 },
  calCell: { aspectRatio: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: T.bg, border: `1px solid ${T.line}` },

  lockIconBtn: { background: T.surface, border: `1.5px solid ${T.line}`, padding: "6px 7px", display: "flex", alignItems: "center", justifyContent: "center" },
  lockScreenOverlay: { position: "fixed", inset: 0, background: T.bg, zIndex: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: T.ivory },
  pinDot: { width: 14, height: 14, borderRadius: "50%", border: "2px solid", transition: "background 0.15s ease" },
  pinKey: { background: T.surface, border: `1.5px solid ${T.line}`, color: T.ivory, fontSize: 18, fontWeight: 700, padding: "16px 0", fontFamily: "'Space Grotesk', sans-serif" },
  reportBtn: { display: "flex", justifyContent: "space-between", alignItems: "center", background: T.surface, border: `1.5px solid ${T.purple}`, boxShadow: "2px 2px 0px #000", padding: "12px 14px", textAlign: "left" },
  exportBtn: { display: "flex", alignItems: "center", gap: 8, background: T.surface, border: `1.5px solid ${T.line}`, boxShadow: "2px 2px 0px #000", padding: "12px 14px", fontSize: 11.5, fontWeight: 700, color: T.ivory, letterSpacing: "0.02em", fontFamily: "'Space Grotesk', sans-serif" },

  fabBtn: {
    position: "fixed", right: 16, bottom: 92, width: 52, height: 52,
    background: T.green, border: "2px solid #000", boxShadow: "3px 3px 0px #000",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 150,
  },
  voiceFab: {
    position: "fixed", right: 16, bottom: 154, width: 52, height: 52,
    background: T.purple, border: "2px solid #000", boxShadow: "3px 3px 0px #000",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 150,
  },
  calcOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 210, display: "flex", alignItems: "flex-end", justifyContent: "center" },
  calcModal: { width: "100%", maxWidth: 420, background: T.surface, borderTop: `2px solid ${T.line}`, padding: "16px 16px calc(env(safe-area-inset-bottom,16px) + 16px) 16px" },
  calcHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10 },
  calcCloseBtn: { background: T.bg, border: `1.5px solid ${T.line}`, padding: 6, flexShrink: 0 },
  calcDisplay: { fontSize: 34, fontWeight: 700, color: T.ivory, textAlign: "right", padding: "18px 10px", background: T.bg, border: `2px solid ${T.line}`, marginBottom: 10, minHeight: 30 },
  calcSubDisplay: { fontSize: 13, color: T.muted, marginBottom: 4 },
  calcGrid: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 },
  calcKey: { background: T.bg, border: `1.5px solid ${T.line}`, color: T.ivory, fontSize: 18, fontWeight: 700, padding: "16px 0", fontFamily: "'Space Grotesk', sans-serif" },
  calcKeyMuted: { background: T.surfaceHi, border: `1.5px solid ${T.line}`, color: T.muted, fontSize: 15, fontWeight: 700, padding: "16px 0", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", justifyContent: "center" },
  calcKeyOp: { background: T.purple, border: "2px solid #000", color: T.ivory, fontSize: 18, fontWeight: 700, padding: "16px 0", fontFamily: "'Space Grotesk', sans-serif" },
  calcKeyEquals: { background: T.green, border: "2px solid #000", color: T.bg, fontSize: 18, fontWeight: 700, padding: "16px 0", fontFamily: "'Space Grotesk', sans-serif" },

  budgetName: { fontSize: 12.5, color: T.ivory, fontWeight: 700, letterSpacing: "0.01em" },
  budgetTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  deleteBtnInline: { background: "none", border: "none", padding: 2 },
  pinBtn: { background: "none", border: "none", padding: 2, color: T.muted },

  pctRow: { display: "flex", alignItems: "center", gap: 8 },
  pctDot: { width: 9, height: 9, flexShrink: 0 },
  pctName: { flex: 1, fontSize: 12.5, color: T.ivory, fontWeight: 600 },
  pctInput: { width: 52, background: T.bg, border: `1.5px solid ${T.line}`, padding: "6px 6px", color: T.ivory, fontSize: 12.5, textAlign: "right" },

  fundCard: { background: T.surface, border: `2px solid ${T.line}`, padding: 14 },
  fundTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  fundBalance: { fontSize: 25, fontWeight: 700, marginTop: 8, letterSpacing: "-0.01em" },

  historyCard: { background: T.surface, border: `2px solid ${T.line}`, padding: 14 },
  historyTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  historyAllocRow: { display: "flex", flexWrap: "wrap", gap: 9, marginTop: 10 },

  goalCard: { background: T.surface, border: `2px solid ${T.line}`, padding: 15 },
  goalCalc: { display: "flex", flexDirection: "column", gap: 4, marginTop: 10, fontSize: 11, color: T.muted, borderTop: `2px solid ${T.line}`, paddingTop: 10 },
  progressTrack: { height: 8, background: T.line, overflow: "hidden" },
  progressFill: { height: "100%", transition: "width 0.3s" },

  miniGoalCard: { background: T.surface, border: `1.5px solid ${T.line}`, boxShadow: "2px 2px 0px #000", padding: 13 },
  miniGoalTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  miniGoalName: { fontSize: 12.5, color: T.ivory, fontWeight: 700 },

  statGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  statBox: { background: T.surface, border: `1.5px solid ${T.line}`, boxShadow: "3px 3px 0px #000", padding: 14 },
  statBoxLabel: { fontSize: 9.5, color: T.muted, fontWeight: 700, letterSpacing: "0.04em" },
  statBoxNum: { fontSize: 20, fontWeight: 700, marginTop: 6 },

  toggleWrap: { display: "flex", border: `2px solid ${T.line}`, overflow: "hidden", marginBottom: 14 },
  toggleBtn: { display: "flex", alignItems: "center", justifyContent: "center", padding: "11px 16px", background: "none", border: "none", color: T.muted, fontSize: 11.5, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, letterSpacing: "0.03em" },

  toast: { position: "fixed", bottom: 88, left: "50%", transform: "translateX(-50%)", background: T.surfaceHi, border: `2px solid ${T.green}`, boxShadow: "3px 3px 0px #000", color: T.green, fontSize: 11.5, fontWeight: 700, padding: "9px 16px", zIndex: 30, letterSpacing: "0.03em" },
  conflictToast: { position: "fixed", bottom: 140, left: "50%", transform: "translateX(-50%)", background: T.surfaceHi, border: `2px solid ${T.orange}`, boxShadow: "3px 3px 0px #000", color: T.orange, fontSize: 11, fontWeight: 700, padding: "9px 16px", zIndex: 31, letterSpacing: "0.02em", maxWidth: "88%", textAlign: "center" },
};
