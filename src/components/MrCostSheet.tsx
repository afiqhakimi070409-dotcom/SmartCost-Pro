/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from "react";
import { KonfigurasiSistem, BahanMentah, BuruhLangsung, OverheadBerubah, OverheadTetap, UserRole } from "../types";
import { TemplatPerniagaan } from "../data/defaultTemplates";
import { 
  Bot, 
  Send, 
  Sparkles, 
  AlertCircle, 
  RefreshCw, 
  Trash2, 
  CheckCircle2, 
  HelpCircle, 
  Scale, 
  TrendingUp, 
  Lightbulb, 
  ShieldAlert, 
  Calculator, 
  ArrowRight, 
  Sliders, 
  X,
  Copy,
  Check,
  Percent,
  Layers,
  ChevronDown,
  ChevronUp,
  FileText
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Language, getTranslation, getStoredLanguage } from "../utils/i18n";
import { RingkasanKos, kiraRingkasanKosStandard, kiraRingkasanKosSebenar } from "../utils/costCalculations";
import ScenarioSimulatorSheet from "./ScenarioSimulatorSheet";
import BatchQuotationSheet from "./BatchQuotationSheet";
import ModalPortal from "./ModalPortal";
import { 
  auditDataPerniagaan, 
  AnomaliData, 
  calculateUsageCostFromPurchase, 
  convertUnit, 
  areUnitsCompatible,
  jalankanUjianPengesahanMatematik, 
  TestResultDetails,
  janaSimulasiBerasingan,
  CadanganSimulasi,
  kenalPastiPeluangPenjimatan,
  PeluangPenjimatanKos,
  kiraKosSeunit,
  kiraHargaDariSasaranMargin
} from "../utils/mrcostEngine";
import { getAuthFetchHeaders, saveServerSessionToken } from "../utils/authSessionClient";
import { auth } from "../firebase";
import {
  apiUrl,
  getFetchCredentialsMode,
  hasExternalApiBaseUrl,
  isOriginUnavailableError,
  sameOriginApiUrl,
} from "../utils/apiBase";

function safeMarkdownUrlTransform(url: string): string {
  const trimmed = (url || "").trim();
  if (!trimmed) return "#";
  if (trimmed.startsWith("#") || (trimmed.startsWith("/") && !trimmed.startsWith("//"))) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed, "https://example.invalid");
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      return trimmed;
    }
  } catch {}
  return "#";
}

function ensureBlankLineBeforeTables(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  const isSeparatorRow = (line: string) =>
    /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);

  for (let i = 0; i < lines.length; i++) {
    const curr = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : "";
    const prev = out.length > 0 ? out[out.length - 1] : "";

    if (
      curr.trim().startsWith("|") &&
      isSeparatorRow(next) &&
      prev.trim().length > 0 &&
      !prev.trim().startsWith("|")
    ) {
      out.push("");
    }
    out.push(curr);
  }
  return out.join("\n");
}

function prepareMarkdownForDisplay(rawText: string, isStreaming: boolean): string {
  if (!rawText) return "";
  let text = rawText.replace(/\r\n/g, "\n");
  text = ensureBlankLineBeforeTables(text);

  if (!isStreaming) {
    return text;
  }

  // Stabilize incomplete markdown at the very tail during streaming so raw syntax does not flicker
  const lines = text.split("\n");
  const lastIdx = lines.length - 1;
  let lastLine = lines[lastIdx];

  // Hold back a partially streamed table header/separator until separator row completes with newline
  if (lines.length >= 2) {
    const prevLine = lines[lastIdx - 1].trim();
    const currTrim = lastLine.trim();
    const looksLikeTableHeader = prevLine.startsWith("|") && prevLine.includes("|");
    const partialSeparator = /^\|?[\s|:\-]*$/.test(currTrim);
    if (looksLikeTableHeader && partialSeparator && !currTrim.endsWith("\n")) {
      lines.splice(lastIdx - 1, 2);
      return lines.join("\n");
    }
  } else if (lastLine.trim().startsWith("|") && lastLine.trim().length < 60 && !text.includes("\n")) {
    return "";
  }

  // Strip trailing lone heading hashes before title words arrive
  if (/^\s*#{1,6}\s*$/.test(lastLine)) {
    lines[lastIdx] = "";
    return lines.join("\n");
  }

  // Auto-close an unclosed trailing **bold** or `code` span on the active line
  const fenceCount = (text.match(/```/g) || []).length;
  if (fenceCount % 2 === 0) {
    const boldTokens = lastLine.match(/\*\*/g) || [];
    if (boldTokens.length % 2 === 1) {
      if (/\*\*\s*$/.test(lastLine)) {
        lastLine = lastLine.replace(/\*\*\s*$/, "");
      } else {
        lastLine = `${lastLine}**`;
      }
    }
    const backtickTokens = lastLine.match(/`/g) || [];
    if (backtickTokens.length % 2 === 1) {
      if (/`\s*$/.test(lastLine)) {
        lastLine = lastLine.replace(/`\s*$/, "");
      } else {
        lastLine = `${lastLine}\``;
      }
    }
    lines[lastIdx] = lastLine;
  }

  return lines.join("\n");
}

const MR_COST_MARKDOWN_COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="markdown-table-wrapper">
      <table {...props} />
    </div>
  ),
};

interface MrCostSheetProps {
  databaseId?: string;
  config: KonfigurasiSistem;
  bahanMentah: BahanMentah[];
  buruhLangsung: BuruhLangsung[];
  overheadBerubah: OverheadBerubah[];
  overheadTetap: OverheadTetap[];
  stdSummary?: RingkasanKos;
  actSummary?: RingkasanKos;
  templates?: TemplatPerniagaan[];
  systemLang?: Language;
  userRole?: UserRole;
  currentUser?: {
    id?: string;
    username: string;
    fullName: string;
    companyName?: string;
    dbKey?: string;
  } | null;
  onApplySimulation?: (updatedConfig: Partial<KonfigurasiSistem>) => void;
}

interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: Date;
  databaseId?: string;
  simulationProposal?: CadanganSimulasi;
}

export default function MrCostSheet({
  databaseId,
  config,
  bahanMentah,
  buruhLangsung,
  overheadBerubah,
  overheadTetap,
  stdSummary,
  actSummary,
  templates = [],
  systemLang,
  userRole,
  currentUser,
  onApplySimulation,
}: MrCostSheetProps) {
  const lang: Language = systemLang || config.language || getStoredLanguage();
  const t = getTranslation(lang);
  const resolvedDbId = useMemo(() => {
    if (databaseId && databaseId.trim()) return databaseId.trim();
    if (currentUser?.dbKey && currentUser.dbKey.trim()) return currentUser.dbKey.trim();
    const slug = (config.namaSyarikat || "school_enterprise").toLowerCase().trim().replace(/[^a-z0-9]/g, "_");
    return `pengekosan_company_db_${slug || "school_enterprise"}`;
  }, [databaseId, currentUser?.dbKey, config.namaSyarikat]);
  const activeDbIdRef = useRef<string>(resolvedDbId);
  useEffect(() => {
    activeDbIdRef.current = resolvedDbId;
  }, [resolvedDbId]);

  // Compute fallback summaries if not supplied from parent
  const resolvedStdSummary: RingkasanKos = useMemo(() => {
    if (stdSummary) return stdSummary;
    return kiraRingkasanKosStandard(config, bahanMentah, buruhLangsung, overheadBerubah, overheadTetap);
  }, [stdSummary, config, bahanMentah, buruhLangsung, overheadBerubah, overheadTetap]);

  const resolvedActSummary: RingkasanKos = useMemo(() => {
    if (actSummary) return actSummary;
    return kiraRingkasanKosSebenar(config, bahanMentah, buruhLangsung, overheadBerubah, overheadTetap);
  }, [actSummary, config, bahanMentah, buruhLangsung, overheadBerubah, overheadTetap]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTechDetail, setErrorTechDetail] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Active Modals & Panels
  const [showAnomalyModal, setShowAnomalyModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [showUnitCalcModal, setShowUnitCalcModal] = useState(false);
  const [showSavingsModal, setShowSavingsModal] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [showQuotationModal, setShowQuotationModal] = useState(false);
  const [activeSimulationCard, setActiveSimulationCard] = useState<CadanganSimulasi | null>(null);

  // Unit Converter state
  const [unitCalcState, setUnitCalcState] = useState({
    purchasePrice: 20,
    purchaseQty: 1,
    purchaseUnit: "kg",
    usageQty: 500,
    usageUnit: "g",
  });
  const [unitCalcResult, setUnitCalcResult] = useState<any>(null);

  // Deterministic anomaly audit
  const detectedAnomalies = useMemo(() => {
    return auditDataPerniagaan({
      config,
      bahanMentah,
      buruhLangsung,
      overheadBerubah,
      overheadTetap,
      language: lang,
    });
  }, [config, bahanMentah, buruhLangsung, overheadBerubah, overheadTetap, lang]);

  const handleQuickRepairAnomaly = (anomali: AnomaliData) => {
    if (anomali.suggestedFixValue && onApplySimulation) {
      onApplySimulation(anomali.suggestedFixValue);
      const fixPrice = anomali.suggestedFixValue.hargaJualanStandard || 4.49;
      const successNotice: Message = {
        id: `repair-${Date.now()}`,
        role: "model",
        text: lang === "en"
          ? `Anomaly resolved. The standard selling price for **${config.namaProduk}** is now updated to **RM ${fixPrice.toFixed(2)}**, generating a positive contribution margin of **RM ${(fixPrice - 2.635).toFixed(2)}** (${(((fixPrice - 2.635) / fixPrice) * 100).toFixed(1)}%) per unit over variable costs.`
          : `Anomali berjaya dibaiki. Harga jualan standard untuk **${config.namaProduk}** kini dikemas kini kepada **RM ${fixPrice.toFixed(2)}**, menghasilkan margin caruman positif sebanyak **RM ${(fixPrice - 2.635).toFixed(2)}** (${(((fixPrice - 2.635) / fixPrice) * 100).toFixed(1)}%) seunit melebihi kos berubah.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, successNotice]);
    }
  };

  // Deterministic cost-saving opportunities audit
  const costSavings = useMemo(() => {
    return kenalPastiPeluangPenjimatan({
      bahanMentah,
      buruhLangsung,
      overheadBerubah,
      kuantitiSebenar: Number(config.kuantitiSebenarDijual || 0),
    });
  }, [bahanMentah, buruhLangsung, overheadBerubah, config.kuantitiSebenarDijual]);

  // Run unit converter whenever inputs change
  useEffect(() => {
    const res = calculateUsageCostFromPurchase({
      purchasePrice: Number(unitCalcState.purchasePrice || 0),
      purchaseQty: Number(unitCalcState.purchaseQty || 1),
      purchaseUnit: unitCalcState.purchaseUnit,
      usageQty: Number(unitCalcState.usageQty || 0),
      usageUnit: unitCalcState.usageUnit,
    });
    setUnitCalcResult(res);
  }, [unitCalcState]);

  const getChatStorageKey = (dbId: string, l: Language) => `mrcost_chat_history_v2_${dbId}_${l}`;

  const saveMessagesForDatabase = (dbId: string, l: Language, list: Message[]) => {
    const scoped = list.filter((m) => !m.databaseId || m.databaseId === dbId).map((m) => ({
      ...m,
      databaseId: dbId,
    }));
    try {
      localStorage.setItem(getChatStorageKey(dbId, l), JSON.stringify(scoped));
    } catch {}
    // Best-effort sync to server-isolated history
    const hasConversation = scoped.some((m) => m.id !== "welcome");
    if (hasConversation) {
      getAuthFetchHeaders({ "Content-Type": "application/json" })
        .then((headers) =>
          fetch(apiUrl("/api/mrcost/history"), {
            method: "POST",
            credentials: getFetchCredentialsMode(),
            headers,
            body: JSON.stringify({
              databaseId: dbId,
              messages: scoped.map((m) => ({
                id: m.id,
                role: m.role,
                text: m.text,
                timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
                databaseId: dbId,
                ...(m.simulationProposal ? { simulationProposal: m.simulationProposal } : {}),
              })),
            }),
          })
        )
        .catch(() => {});
    }
  };

  // Initialize / switch chat history cleanly whenever active databaseId or language changes
  useEffect(() => {
    setError(null);
    setLoading(false);
    setActiveSimulationCard(null);
    setMessages([]);

    const storageKey = getChatStorageKey(resolvedDbId, lang);
    const savedMessages = localStorage.getItem(storageKey);
    if (savedMessages) {
      try {
        const parsed: Message[] = JSON.parse(savedMessages)
          .filter((m: any) => !m.databaseId || m.databaseId === resolvedDbId)
          .map((m: any) => ({
            ...m,
            databaseId: resolvedDbId,
            timestamp: new Date(m.timestamp),
          }));
        if (parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      } catch (e) {
        console.error("Failed to load chat history:", e);
      }
    }

    const companyName = config.namaSyarikat || currentUser?.companyName || "SMARTCOST";
    const productName = config.namaProduk || "Produk";
    const currency = config.currency || "RM";

    const defaultWelcome: Message = {
      id: "welcome",
      role: "model",
      databaseId: resolvedDbId,
      text: lang === "en"
        ? `### Welcome to MR. COST AI 🤖\n\nI am your managerial cost accounting and pricing advisor for **${companyName}**.\n\n**Active Worksheet:** **${productName}**\n- Target Production: **${config.sasaranKuantitiStandard || 0} ${config.unitProduk || "units"}**\n- Standard Selling Price: **${currency} ${Number(config.hargaJualanStandard || 0).toFixed(2)}**\n- Current Data Health: **${detectedAnomalies.length === 0 ? "🟢 Clean (No anomalies detected)" : `⚠️ ${detectedAnomalies.length} issue(s) detected`}**\n\n**Key Intelligence Capabilities:**\n* **Deterministic Cost & Pricing**: Compute unit costs and target margin selling prices accurately.\n* **Proactive Anomaly Detection**: Identify unrealistic quantities, negative costs, or prices below cost.\n* **Unit Intelligence**: Auto-convert and reconcile units (kg to g, L to ml, hours to mins).\n* **Non-destructive Simulation**: Run what-if simulations without modifying your live database records.\n\nClick any quick prompt below or type your question in English or Bahasa Melayu!`
        : `### Selamat Datang ke MR COST AI 🤖\n\nSaya adalah penasihat perakaunan kos pengurusan, pengekosan standard, dan penetapan harga untuk **${companyName}**.\n\n**Lembaran Produk Semasa:** **${productName}**\n- Sasaran Pengeluaran: **${config.sasaranKuantitiStandard || 0} ${config.unitProduk || "unit"}**\n- Harga Jualan Standard: **${currency} ${Number(config.hargaJualanStandard || 0).toFixed(2)}**\n- Status Kesihatan Data: **${detectedAnomalies.length === 0 ? "🟢 Bersih (Tiada anomali dikesan)" : `⚠️ ${detectedAnomalies.length} anomali dikesan`}**\n\n**Keupayaan Utama MR COST AI:**\n* **Ketepatan Matematik Penuh**: Pengiraan kos seunit dan formula margin keuntungan yang tepat.\n* **Pengesanan Anomali Proaktif**: Mengesan harga di bawah kos, kuantiti kosong, atau lonjakan harga bahan.\n* **Kecerdasan Unit & Sukatan**: Menukar kg ke g, liter ke ml, jam ke minit secara automatik.\n* **Simulasi Tanpa Merosakkan Rekod**: Hasil simulasi 'what-if' disimpan sebagai cadangan berasingan tanpa mengubah rekod asal anda.\n\nSila pilih soalan pantas di bawah atau taip sebarang pertanyaan anda!`,
      timestamp: new Date(),
    };
    setMessages([defaultWelcome]);
  }, [resolvedDbId, lang, config.namaProduk, config.namaSyarikat, config.currency, config.hargaJualanStandard, config.sasaranKuantitiStandard, config.unitProduk, currentUser]);

  // Auto-scroll and persist messages strictly under active databaseId
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    if (messages.length > 0) {
      const validForCurrentDb = messages.every((m) => !m.databaseId || m.databaseId === resolvedDbId);
      if (validForCurrentDb) {
        saveMessagesForDatabase(resolvedDbId, lang, messages);
      }
    }
  }, [messages, lang, resolvedDbId]);

  const clearChat = () => {
    const confirmPrompt = lang === "en"
      ? "Are you sure you want to clear your conversation history with Mr. Cost?"
      : "Adakah anda pasti untuk mengosongkan perbualan dengan Mr Cost?";

    if (window.confirm(confirmPrompt)) {
      const companyName = config.namaSyarikat || "SMARTCOST";
      const welcomeMsg: Message = {
        id: "welcome",
        role: "model",
        databaseId: resolvedDbId,
        text: lang === "en"
          ? `I'm ready to assist you again! Ask me anything regarding cost accounting, break-even targets, and profitability for **${companyName}**.`
          : `Saya sedia membantu sekali lagi! Sila tanya sebarang maklumat mengenai pengekosan perniagaan dan titik pulang modal untuk **${companyName}**.`,
        timestamp: new Date(),
      };
      setMessages([welcomeMsg]);
      try {
        localStorage.removeItem(getChatStorageKey(resolvedDbId, lang));
      } catch {}
      getAuthFetchHeaders()
        .then((headers) =>
          fetch(apiUrl(`/api/mrcost/history?databaseId=${encodeURIComponent(resolvedDbId)}`), {
            method: "DELETE",
            credentials: getFetchCredentialsMode(),
            headers,
          })
        )
        .catch(() => {});
    }
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend || !textToSend.trim() || loading) return;

    const requestDbId = resolvedDbId;
    const requestLang = lang;

    setError(null);
    setErrorTechDetail(null);
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      text: textToSend,
      timestamp: new Date(),
      databaseId: requestDbId,
    };

    // Check if query is a simulation ("Kalau harga...", "Kalau saya jual...", "What if...")
    let generatedProposal: CadanganSimulasi | undefined;
    const lower = textToSend.toLowerCase();
    const isSimulationQuery = lower.includes("kalau") || lower.includes("simulasi") || lower.includes("what if") || lower.includes("sekiranya");

    if (isSimulationQuery) {
      const priceMatch = lower.match(/(?:jual|harga)\s*(?:rm|rm\s*)?(\d+(?:\.\d+)?)/i);
      const percentMatch = lower.match(/(\d+(?:\.\d+)?)\s*%/);
      const qtyMatch = lower.match(/(?:sasaran|kuantiti|volum)\s*(\d+)/i);

      let simPrice: number | undefined;
      let simFlourSurge: number | undefined;
      let simQty: number | undefined;

      if (priceMatch) {
        simPrice = parseFloat(priceMatch[1]);
      }
      if (percentMatch) {
        simFlourSurge = parseFloat(percentMatch[1]);
      } else if (lower.includes("tepung naik") || lower.includes("bahan naik")) {
        simFlourSurge = 15;
      }
      if (qtyMatch) {
        simQty = parseInt(qtyMatch[1], 10);
      }

      if (simPrice !== undefined || simFlourSurge !== undefined || simQty !== undefined) {
        generatedProposal = janaSimulasiBerasingan({
          tajuk: requestLang === "en" ? `Simulation: ${textToSend.slice(0, 45)}...` : `Simulasi: ${textToSend.slice(0, 45)}...`,
          config,
          bahanMentah,
          buruhLangsung,
          overheadBerubah,
          overheadTetap,
          perubahanHargaJualan: simPrice,
          perubahanKuantitiJualan: simQty,
          peratusPerubahanBahan: simFlourSurge,
        });
      }
    }

    const botMsgId = `bot-${Date.now()}`;
    const initialPlaceholder: Message = {
      id: botMsgId,
      role: "model",
      text: "",
      timestamp: new Date(),
      databaseId: requestDbId,
      simulationProposal: generatedProposal,
    };

    const startingHistory = messages.filter((m) => !m.databaseId || m.databaseId === requestDbId);
    const snapshotWithPlaceholder = [...startingHistory, userMsg, initialPlaceholder];
    saveMessagesForDatabase(requestDbId, requestLang, snapshotWithPlaceholder);

    setMessages((prev) => [...prev, userMsg, initialPlaceholder]);
    setInputValue("");
    setLoading(true);

    const updateMessageInOriginDb = (botText: string) => {
      const updatedSnapshot = snapshotWithPlaceholder.map((m) =>
        m.id === botMsgId ? { ...m, text: botText } : m
      );
      saveMessagesForDatabase(requestDbId, requestLang, updatedSnapshot);

      if (activeDbIdRef.current === requestDbId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === botMsgId ? { ...m, text: botText } : m))
        );
      }
    };

    try {
      // Send only last 6 messages belonging strictly to requestDbId
      const apiHistory = startingHistory.slice(-6).map((m) => ({
        role: m.role,
        databaseId: requestDbId,
        parts: [{ text: m.text }],
      }));

      // Strip credential/PII fields before transmitting businessData
      const {
        kataLaluanLogMasuk: _pw,
        password: _rawPw,
        passwordHash: _pwHash,
        salt: _salt,
        usernameLogMasuk: _un,
        generalSetup: _gs,
        ...safeConfig
      } = config as any;

      const basePayload = {
        databaseId: requestDbId,
        message: textToSend,
        history: apiHistory,
        language: requestLang,
        businessData: {
          config: safeConfig,
          bahanMentah,
          buruhLangsung,
          overheadBerubah,
          overheadTetap,
          templates,
        },
      };

      const isTransientNetworkError = (e: unknown): boolean => {
        if (!e) return false;
        if (e instanceof TypeError) return true;
        const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
        return (
          msg.includes("failed to fetch") ||
          msg.includes("network error") ||
          msg.includes("networkerror") ||
          msg.includes("load failed") ||
          msg.includes("err_network") ||
          msg.includes("aborted")
        );
      };

      const recoverSessionAndRegisterLocalDb = async (): Promise<boolean> => {
        try {
          if (typeof auth.authStateReady === "function") {
            await auth.authStateReady();
          }
          if (auth.currentUser) {
            const idToken = await auth.currentUser.getIdToken(true);
            const fbResp = await fetch(apiUrl("/api/auth/session-firebase"), {
              method: "POST",
              credentials: getFetchCredentialsMode(),
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`,
              },
              body: JSON.stringify({
                dbKey: requestDbId,
                companyName: config.namaSyarikat || "SMARTCOST",
              }),
            });
            if (fbResp.ok) {
              const fbData = await fbResp.json().catch(() => ({}));
              saveServerSessionToken(fbData.sessionToken, fbData.csrfToken);
            }
          }
          if (localStorage.getItem(requestDbId)) {
            const regHeaders = await getAuthFetchHeaders({ "Content-Type": "application/json" });
            const regResp = await fetch(apiUrl("/api/databases/register"), {
              method: "POST",
              credentials: getFetchCredentialsMode(),
              headers: regHeaders,
              body: JSON.stringify({
                databaseId: requestDbId,
                companyName: config.namaSyarikat || requestDbId,
              }),
            });
            return regResp.ok;
          }
        } catch {}
        return false;
      };

      const fetchMrCostWithEdgeFallback = async (
        headers: Record<string, string>,
        payload: Record<string, any>
      ): Promise<Response> => {
        const primaryUrl = apiUrl("/api/mrcost/chat");
        const localUrl = sameOriginApiUrl("/api/mrcost/chat");
        try {
          const resp = await fetch(primaryUrl, {
            method: "POST",
            credentials: getFetchCredentialsMode(),
            headers,
            body: JSON.stringify(payload),
          });
          if (
            hasExternalApiBaseUrl() &&
            primaryUrl !== localUrl &&
            (resp.status === 502 || resp.status === 503 || resp.status === 504)
          ) {
            return await fetch(localUrl, {
              method: "POST",
              credentials: "same-origin",
              headers,
              body: JSON.stringify(payload),
            });
          }
          return resp;
        } catch (err) {
          if (hasExternalApiBaseUrl() && primaryUrl !== localUrl && isOriginUnavailableError(err)) {
            return await fetch(localUrl, {
              method: "POST",
              credentials: "same-origin",
              headers,
              body: JSON.stringify(payload),
            });
          }
          throw err;
        }
      };

      const executeJsonFallback = async (attempts = 2): Promise<string> => {
        let lastErr: unknown;
        let recoveredOnce = false;
        for (let attempt = 1; attempt <= attempts; attempt++) {
          try {
            const reqHeaders = await getAuthFetchHeaders({
              "Content-Type": "application/json",
              "Accept": "application/json",
            });
            let fallbackRes = await fetchMrCostWithEdgeFallback(reqHeaders, {
              ...basePayload,
              stream: false,
            });

            if (fallbackRes.status === 403 && !recoveredOnce) {
              recoveredOnce = true;
              if (await recoverSessionAndRegisterLocalDb()) {
                const retryHeaders = await getAuthFetchHeaders({
                  "Content-Type": "application/json",
                  "Accept": "application/json",
                });
                fallbackRes = await fetchMrCostWithEdgeFallback(retryHeaders, {
                  ...basePayload,
                  stream: false,
                });
              }
            }

            if (!fallbackRes.ok) {
              const errData = await fallbackRes.json().catch(() => ({}));
              const errObj: any = new Error(errData.error || `Server error: HTTP ${fallbackRes.status}`);
              errObj.httpStatus = errData.httpStatus || fallbackRes.status;
              errObj.code = errData.code;
              errObj.detail = errData.detail;
              errObj.modelTried = errData.modelTried;
              throw errObj;
            }

            const data = await fallbackRes.json();
            if (typeof data?.text === "string" && data.text.trim().length > 0) {
              return data.text;
            }
            throw new Error(requestLang === "en" ? "Sorry, no response received." : "Maaf, tiada maklum balas diterima.");
          } catch (e) {
            lastErr = e;
            if (attempt < attempts && isTransientNetworkError(e)) {
              await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
              continue;
            }
            throw e;
          }
        }
        throw lastErr;
      };

      let finalResponseText = "";
      let needsJsonFallback = false;

      try {
        const streamHeaders = await getAuthFetchHeaders({
          "Content-Type": "application/json",
          "Accept": "text/event-stream, application/json",
        });
        let response = await fetchMrCostWithEdgeFallback(streamHeaders, {
          ...basePayload,
          stream: true,
        });

        if (response.status === 403) {
          if (await recoverSessionAndRegisterLocalDb()) {
            const retryHeaders = await getAuthFetchHeaders({
              "Content-Type": "application/json",
              "Accept": "text/event-stream, application/json",
            });
            response = await fetchMrCostWithEdgeFallback(retryHeaders, {
              ...basePayload,
              stream: true,
            });
          }
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errObj: any = new Error(errData.error || `Server error: HTTP ${response.status}`);
          errObj.httpStatus = errData.httpStatus || response.status;
          errObj.code = errData.code;
          errObj.detail = errData.detail;
          errObj.modelTried = errData.modelTried;
          throw errObj;
        }

        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("text/event-stream") && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let accumulatedText = "";
          let buffer = "";

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const parts = buffer.split(/\r?\n\r?\n/);
              buffer = parts.pop() || "";

              for (const block of parts) {
                const trimmed = block.trim();
                if (!trimmed) continue;

                const nonCommentLines = trimmed
                  .split(/\r?\n/)
                  .filter((line) => !line.startsWith(":"));
                if (nonCommentLines.length === 0) continue;

                const cleanBlock = nonCommentLines.join("\n");
                const eventMatch = cleanBlock.match(/^event:\s*(\w+)/m);
                const dataLines = nonCommentLines
                  .filter((line) => line.startsWith("data:"))
                  .map((line) => line.replace(/^data:\s?/, ""));
                const eventType = eventMatch ? eventMatch[1] : "chunk";
                const dataStr = dataLines.join("\n");

                if (eventType === "replace" && dataStr) {
                  try {
                    const parsed = JSON.parse(dataStr);
                    if (typeof parsed.text === "string") {
                      accumulatedText = parsed.text;
                      updateMessageInOriginDb(accumulatedText);
                    }
                  } catch {}
                } else if (eventType === "chunk" && dataStr) {
                  try {
                    const parsed = JSON.parse(dataStr);
                    if (typeof parsed.text === "string" && parsed.text.length > 0) {
                      accumulatedText += parsed.text;
                      updateMessageInOriginDb(accumulatedText);
                    }
                  } catch {}
                } else if (eventType === "error" && dataStr) {
                  const errObjData = JSON.parse(dataStr);
                  let rawErr = errObjData.error || "Streaming error occurred";
                  if (typeof rawErr === "string" && (rawErr.includes("Quota exceeded") || rawErr.includes("429") || rawErr.includes("RESOURCE_EXHAUSTED"))) {
                    rawErr = requestLang === "en"
                      ? "AI service quota temporarily reached. Please retry in a moment or reference the cost sheet directly."
                      : "Had kuota perkhidmatan AI dicapai buat sementara waktu. Sila cuba sebentar lagi atau rujuk lembaran kos secara terus.";
                  }
                  const sseErr: any = new Error(rawErr);
                  sseErr.httpStatus = errObjData.httpStatus;
                  sseErr.code = errObjData.code;
                  sseErr.detail = errObjData.detail;
                  throw sseErr;
                }
              }
            }

            if (buffer.trim()) {
              const nonCommentLines = buffer
                .trim()
                .split(/\r?\n/)
                .filter((line) => !line.startsWith(":"));
              const cleanBuffer = nonCommentLines.join("\n");
              const eventMatch = cleanBuffer.match(/^event:\s*(\w+)/m);
              const dataLines = nonCommentLines
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.replace(/^data:\s?/, ""));
              const eventType = eventMatch ? eventMatch[1] : "chunk";
              const dataStr = dataLines.join("\n");
              if (eventType === "replace" && dataStr) {
                try {
                  const parsed = JSON.parse(dataStr);
                  if (typeof parsed.text === "string") {
                    accumulatedText = parsed.text;
                  }
                } catch {}
              } else if (eventType === "chunk" && dataStr) {
                try {
                  const parsed = JSON.parse(dataStr);
                  if (typeof parsed.text === "string" && parsed.text.length > 0) {
                    accumulatedText += parsed.text;
                  }
                } catch {}
              }
            }
          } catch (streamErr) {
            if (!accumulatedText.trim() && isTransientNetworkError(streamErr)) {
              needsJsonFallback = true;
            } else if (accumulatedText.trim().length > 0 && isTransientNetworkError(streamErr)) {
              finalResponseText = accumulatedText;
            } else {
              throw streamErr;
            }
          }

          if (!needsJsonFallback) {
            if (accumulatedText.trim()) {
              finalResponseText = accumulatedText;
            } else {
              needsJsonFallback = true;
            }
          }
        } else {
          const data = await response.json();
          finalResponseText = data.text || (requestLang === "en" ? "Sorry, no response received." : "Maaf, tiada maklum balas diterima.");
        }
      } catch (fetchErr) {
        if (isTransientNetworkError(fetchErr)) {
          needsJsonFallback = true;
        } else {
          throw fetchErr;
        }
      }

      if (needsJsonFallback) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        finalResponseText = await executeJsonFallback(2);
      }

      updateMessageInOriginDb(finalResponseText);

      if (generatedProposal && activeDbIdRef.current === requestDbId) {
        setActiveSimulationCard(generatedProposal);
      }
    } catch (err: any) {
      const httpStatus = err?.httpStatus ? Number(err.httpStatus) : undefined;
      const errCode = typeof err?.code === "string" && err.code.trim() ? err.code.trim() : undefined;
      const errDetail = typeof err?.detail === "string" && err.detail.trim() ? err.detail.trim() : undefined;
      const modelTried = typeof err?.modelTried === "string" && err.modelTried.trim() ? err.modelTried.trim() : undefined;

      console.error("[Mr Cost AI Error]", {
        httpStatus,
        code: errCode,
        detail: errDetail,
        modelTried,
        message: err?.message,
        raw: err,
      });

      const cleanedSnapshot = snapshotWithPlaceholder.filter((m) => m.id !== botMsgId);
      saveMessagesForDatabase(requestDbId, requestLang, cleanedSnapshot);

      if (activeDbIdRef.current === requestDbId) {
        setMessages((prev) => prev.filter((m) => m.id !== botMsgId || m.text.trim().length > 0));

        const fallbackMsg = requestLang === "en"
          ? "Mr. Cost is currently busy, please try again shortly."
          : "Mr Cost sedang sibuk, sila cuba lagi sebentar.";

        let cleanErrorMsg = fallbackMsg;
        if (errCode === "AI_NOT_CONFIGURED" || httpStatus === 503) {
          cleanErrorMsg =
            typeof err?.message === "string" && err.message.trim()
              ? err.message.trim()
              : (requestLang === "en"
                  ? "Mr. Cost AI key (GEMINI_API_KEY) is not configured on this Cloudflare deployment."
                  : "Kunci API Mr Cost AI (GEMINI_API_KEY) belum ditetapkan pada deployment Cloudflare ini.");
        } else if (errCode === "SESSION_UNAUTHORIZED" || httpStatus === 401) {
          cleanErrorMsg =
            typeof err?.message === "string" && err.message.trim()
              ? err.message.trim()
              : (requestLang === "en"
                  ? "Your session has expired. Please sign in again to use Mr. Cost AI."
                  : "Sesi anda telah tamat tempoh. Sila log masuk semula untuk menggunakan Mr. Cost AI.");
        } else if (typeof err?.message === "string") {
          const raw = err.message.trim();
          const lowerRaw = raw.toLowerCase();
          const looksLikeHtmlOrStack =
            raw.startsWith("<") ||
            lowerRaw.includes("<!doctype") ||
            raw.includes("ApiError") ||
            (raw.includes("{") && raw.includes("}"));
          if (
            raw &&
            !looksLikeHtmlOrStack &&
            !lowerRaw.includes("failed to fetch") &&
            !lowerRaw.includes("network error") &&
            !lowerRaw.includes("load failed")
          ) {
            cleanErrorMsg = raw;
          } else if (lowerRaw.includes("failed to fetch") || lowerRaw.includes("network error") || lowerRaw.includes("load failed")) {
            cleanErrorMsg =
              requestLang === "en"
                ? "Network error while reaching the AI endpoint. Check your internet connection or VITE_API_URL."
                : "Ralat rangkaian semasa menghubungi perkhidmatan AI. Sila semak sambungan internet atau tetapan VITE_API_URL.";
          }
        }

        const techParts = [
          httpStatus ? `HTTP ${httpStatus}` : null,
          errCode ? `Kod: ${errCode}` : null,
          modelTried ? `Model: ${modelTried}` : null,
          errDetail && errDetail !== cleanErrorMsg ? errDetail : null,
        ].filter(Boolean);

        setError(cleanErrorMsg);
        setErrorTechDetail(techParts.length > 0 ? techParts.join(" · ") : null);
      }
    } finally {
      if (activeDbIdRef.current === requestDbId) {
        setLoading(false);
      }
    }
  };

  // Quick Prompt Chips
  const quickPrompts = lang === "en" ? [
    { label: "📚 Job Order vs Process Costing", query: "What is the difference between Job Order Costing and Process Costing?" },
    { label: "📋 Financial vs Cost Accounting", query: "What are the main differences between Financial Accounting and Cost Accounting?" },
    { label: "🏭 3 Manufacturing Cost Elements", query: "What are the 3 core elements of manufacturing cost?" },
    { label: "📊 What-If Simulator", query: "Can you help me simulate a 10% price hike and its effect on my weekly break-even volume?" },
    { label: "📝 B2B Bulk Quotation", query: "How should I price a bulk catering order of 300 units with custom packaging?" },
    { label: "🍰 Cost of Product", query: "Calculate the total cost and unit cost for my active product." },
    { label: "💰 If I sell at $15?", query: "If I sell at RM 15.00, what is my net profit and margin?" },
    { label: "📉 Why is my margin low?", query: "Why is my profit margin low, and where are the cost leakages?" },
    { label: "✂️ Reduce Production Cost", query: "How can I reduce production costs based on my current data?" },
    { label: "🌾 If flour rises 15%?", query: "If the price of raw flour rises by 15%, what is the impact on my unit cost and profit?" },
    { label: "🎯 Price for 35% margin", query: "What is the recommended selling price for a target profit margin of 35%?" },
    { label: "⚖️ Compare two products", query: "Compare the costs and profitability between two of my business products." },
  ] : [
    { label: "📚 Job Order vs Kos Proses", query: "Apakah perbezaan antara Kos Pesanan Kerja (Job Order) dengan Kos Proses (Process Costing)?" },
    { label: "📋 Kewangan vs Kos", query: "Apakah perbezaan utama antara Perakaunan Kewangan dan Perakaunan Kos?" },
    { label: "🏭 3 Elemen Kos Pengeluaran", query: "Apakah 3 elemen utama kos pengeluaran?" },
    { label: "📊 Simulasi Senario", query: "Boleh bantu saya uji simulasi kenaikan harga jualan 10% dan kesannya kepada sasaran titik pulang modal?" },
    { label: "📝 Sebut Harga Tempahan 300 Unit", query: "Bagaimana cara meletakkan harga sebut harga bagi tempahan katering 300 unit berserta pembungkusan khas?" },
    { label: "🍰 Kira kos produk saya", query: "Kira kos produk saya sekarang." },
    { label: "💰 Kalau saya jual RM15, berapa untung?", query: "Kalau saya jual RM15, berapa untung?" },
    { label: "📉 Kenapa margin keuntungan saya rendah?", query: "Kenapa margin keuntungan saya rendah?" },
    { label: "✂️ Macam mana nak kurangkan kos?", query: "Macam mana nak kurangkan kos pengeluaran?" },
    { label: "🌾 Kalau harga tepung naik 15%?", query: "Kalau harga tepung naik 15%, apa kesannya kepada kos dan untung saya?" },
    { label: "🎯 Harga sesuai untuk sasaran margin 35%", query: "Berapakah harga jualan yang sesuai untuk sasaran margin 35%?" },
    { label: "⚖️ Bandingkan kos dua produk saya", query: "Bandingkan kos dua produk saya." },
  ];

  const handleApplyProposalToSheet = (proposal: CadanganSimulasi) => {
    if (!onApplySimulation) {
      alert(lang === "en" ? "Proposal application handler not provided." : "Fungsi aplikasi cadangan tidak disediakan.");
      return;
    }

    const confirmMsg = lang === "en"
      ? `Do you want to update your active worksheet's standard selling price to RM ${proposal.dataSimulasi.hargaJualan.toFixed(2)}? (Original data was untouched during simulation).`
      : `Adakah anda ingin mengemaskini harga jualan standard lembaran aktif kepada RM ${proposal.dataSimulasi.hargaJualan.toFixed(2)}? (Rekod asal TIDAK diubah sepanjang simulasi dijalankan).`;

    if (window.confirm(confirmMsg)) {
      onApplySimulation({
        hargaJualanStandard: proposal.dataSimulasi.hargaJualan,
      });
      setActiveSimulationCard(null);
    }
  };

  const testResults = useMemo(() => jalankanUjianPengesahanMatematik(), []);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col h-[calc(100vh-140px)] min-h-[660px] overflow-hidden animate-fadeIn relative">
      {/* Top Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 sm:px-6 py-3 flex items-center justify-between text-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-linear-to-br from-blue-600 to-indigo-700 rounded-lg flex items-center justify-center border border-blue-400/30 shadow-xs">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-display font-black tracking-wide text-white uppercase">
                MR. COST AI
              </h2>
              <span className="text-[10px] bg-blue-500/20 text-blue-300 font-mono px-2 py-0.5 rounded-full border border-blue-400/30">
                PRO 2026
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">
              {config.namaSyarikat || "SMARTCOST"} · {config.namaProduk}
            </p>
          </div>
        </div>

        {/* Action Toolbars */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Anomaly button */}
          <button
            onClick={() => setShowAnomalyModal(true)}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
              detectedAnomalies.length > 0
                ? "bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25"
                : "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25"
            }`}
            title={lang === "en" ? "Data Anomaly Audit" : "Pengesanan Anomali Data"}
          >
            {detectedAnomalies.length > 0 ? (
              <>
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span className="hidden sm:inline">
                  {lang === "en"
                    ? `${detectedAnomalies.length} ${detectedAnomalies.length === 1 ? "Anomaly" : "Anomalies"}`
                    : `${detectedAnomalies.length} Anomali`}
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">{lang === "en" ? "Data Clean" : "Data Bersih"}</span>
              </>
            )}
          </button>

          {/* Unit Calculator Tool */}
          <button
            onClick={() => setShowUnitCalcModal(true)}
            className="p-1.5 sm:px-2.5 sm:py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-md text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
            title={lang === "en" ? "Unit Intelligence & Conversion Tool" : "Kecerdasan Unit & Sukatan"}
          >
            <Scale className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden md:inline">{lang === "en" ? "Unit Intelligence" : "Kecerdasan Unit"}</span>
          </button>

          {/* Math Test Verification */}
          <button
            onClick={() => setShowTestModal(true)}
            className="p-1.5 sm:px-2.5 sm:py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-md text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
            title={lang === "en" ? "Mathematical Accuracy Tests (A-E)" : "Ujian Ketepatan Matematik A-E"}
          >
            <Calculator className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden md:inline">{lang === "en" ? "Accuracy Tests" : "Ujian Ketepatan"}</span>
          </button>

          {/* Scenario Simulator Tool */}
          <button
            onClick={() => setShowScenarioModal(true)}
            className="p-1.5 sm:px-2.5 sm:py-1 bg-amber-950/60 hover:bg-amber-900 text-amber-300 rounded-md text-xs font-medium border border-amber-700 flex items-center gap-1.5 transition-colors cursor-pointer"
            title={lang === "en" ? "Price & Profit Simulation" : "Simulasi Harga & Sensitiviti Margin"}
          >
            <Sliders className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline">{lang === "en" ? "Scenario Sim" : "Simulasi Senario"}</span>
          </button>

          {/* Batch Quotation Tool */}
          <button
            onClick={() => setShowQuotationModal(true)}
            className="p-1.5 sm:px-2.5 sm:py-1 bg-sky-950/60 hover:bg-sky-900 text-sky-300 rounded-md text-xs font-medium border border-sky-700 flex items-center gap-1.5 transition-colors cursor-pointer"
            title={lang === "en" ? "B2B Bulk Quotation & Wholesale Tier Pricing" : "Penjana Sebut Harga Tempahan Pukal & Diskaun Volum"}
          >
            <FileText className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden md:inline">{lang === "en" ? "Bulk Quotation" : "Sebut Harga"}</span>
          </button>

          {/* Cost Savings Opportunities */}
          {costSavings.length > 0 && (
            <button
              onClick={() => setShowSavingsModal(true)}
              className="p-1.5 sm:px-2.5 sm:py-1 bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 rounded-md text-xs font-medium border border-emerald-700 flex items-center gap-1.5 transition-colors cursor-pointer"
              title={lang === "en" ? "Cost Reduction Opportunities" : "Peluang Penjimatan Kos"}
            >
              <Lightbulb className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden lg:inline">
                {lang === "en" ? `${costSavings.length} Savings Opps` : `${costSavings.length} Peluang Jimat`}
              </span>
            </button>
          )}

          {/* Clear Chat */}
          <button
            onClick={clearChat}
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
            title={lang === "en" ? "Clear conversation history" : "Padam sejarah perbualan"}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Message List area */}
      <div className="flex-1 p-4 sm:p-6 overflow-y-auto overflow-x-hidden bg-slate-50/60 space-y-4">
        {messages.map((msg, msgIndex) => {
          const isActiveStreamingModel =
            loading && msg.role === "model" && msgIndex === messages.length - 1;
          const renderedMarkdownText =
            msg.role === "model" && msg.text
              ? prepareMarkdownForDisplay(msg.text, isActiveStreamingModel)
              : "";

          return (
          <div
            key={msg.id}
            className={`flex animate-slideUp ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`flex gap-2.5 w-full sm:w-auto max-w-full sm:max-w-[92%] lg:max-w-[85%] ${
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              {/* Avatar */}
              <div
                className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center font-bold text-xs mt-0.5 ${
                  msg.role === "user"
                    ? "bg-slate-900 text-white font-mono"
                    : "bg-linear-to-br from-blue-600 to-indigo-700 text-white shadow-xs"
                }`}
              >
                {msg.role === "user" ? "U" : <Bot className="w-4 h-4" />}
              </div>

              {/* Message box */}
              <div className="space-y-1.5 flex-1 min-w-0">
                <div
                  className={`px-4 py-3.5 rounded-xl overflow-hidden ${
                    msg.role === "user"
                      ? "bg-slate-900 text-white rounded-tr-none font-medium shadow-xs text-xs sm:text-sm leading-relaxed"
                      : "bg-white text-slate-800 border border-slate-200/90 rounded-tl-none markdown-body shadow-xs"
                  }`}
                >
                  {msg.role === "user" ? (
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                  ) : (
                    <div className="min-w-0">
                      {msg.text && renderedMarkdownText ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeSanitize]}
                          urlTransform={safeMarkdownUrlTransform}
                          components={MR_COST_MARKDOWN_COMPONENTS}
                        >
                          {renderedMarkdownText}
                        </ReactMarkdown>
                      ) : (
                        <div className="flex items-center gap-2 py-1 text-slate-600 font-medium text-xs">
                          <span className="flex gap-1 items-center shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce" style={{ animationDelay: "0ms" }}></span>
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce" style={{ animationDelay: "150ms" }}></span>
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce" style={{ animationDelay: "300ms" }}></span>
                          </span>
                          <span className="text-slate-700 font-semibold">
                            {lang === "en" ? "Mr. Cost is typing..." : "Mr Cost sedang menaip..."}
                          </span>
                        </div>
                      )}

                      {/* Attached Simulation Card if this response was a what-if simulation */}
                      {msg.simulationProposal && (
                        <div className="mt-4 pt-3 border-t border-slate-200/80 not-prose">
                          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-bold text-indigo-950 flex items-center gap-1.5">
                                <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                                {lang === "en" ? "Separate Simulation Proposal (Live Data Untouched)" : "Cadangan Simulasi Berasingan (Rekod Sebenar Kekal Tidak Diubah)"}
                              </span>
                              <span className="text-[10px] bg-indigo-100 text-indigo-700 font-medium px-2 py-0.5 rounded-md">
                                {lang === "en" ? "Proposal Only" : "Cadangan Berasingan"}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                              <div className="bg-white p-2 rounded border border-slate-200">
                                <div className="text-[10px] text-slate-500">{lang === "en" ? "Selling Price" : "Harga Jualan"}</div>
                                <div className="font-bold text-slate-900">
                                  RM {msg.simulationProposal.dataSimulasi.hargaJualan.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  Asal: RM {msg.simulationProposal.dataAsal.hargaJualan.toFixed(2)}
                                </div>
                              </div>
                              <div className="bg-white p-2 rounded border border-slate-200">
                                <div className="text-[10px] text-slate-500">{lang === "en" ? "Unit Var Cost" : "Kos Berubah Seunit"}</div>
                                <div className="font-bold text-slate-900">
                                  RM {msg.simulationProposal.dataSimulasi.kosBerubahSeunit.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  Asal: RM {msg.simulationProposal.dataAsal.kosBerubahSeunit.toFixed(2)}
                                </div>
                              </div>
                              <div className="bg-white p-2 rounded border border-slate-200">
                                <div className="text-[10px] text-slate-500">{lang === "en" ? "Est. Weekly Profit" : "Untung Mingguan"}</div>
                                <div className={`font-bold ${msg.simulationProposal.perbezaan.bezaUntungMingguan >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                                  RM {msg.simulationProposal.dataSimulasi.untungMingguan.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {msg.simulationProposal.perbezaan.bezaUntungMingguan >= 0 ? "+" : ""}
                                  RM {msg.simulationProposal.perbezaan.bezaUntungMingguan.toFixed(2)}
                                </div>
                              </div>
                              <div className="bg-white p-2 rounded border border-slate-200">
                                <div className="text-[10px] text-slate-500">{lang === "en" ? "BEP Volume" : "BEP Unit"}</div>
                                <div className="font-bold text-slate-900">
                                  {msg.simulationProposal.dataSimulasi.bepUnit} unit
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  Asal: {msg.simulationProposal.dataAsal.bepUnit} unit
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                              <span className="text-[11px] text-slate-500 italic">
                                {lang === "en" ? "Apply to active worksheet only if you choose to adopt this proposal." : "Hanya aplikasikan cadangan jika anda memilih untuk melaksanakannya."}
                              </span>
                              {onApplySimulation && (
                                <button
                                  onClick={() => handleApplyProposalToSheet(msg.simulationProposal!)}
                                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>{lang === "en" ? "Apply Proposal" : "Gunakan Cadangan Ini"}</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer details: time + copy */}
                <div className="flex items-center justify-between px-1 text-[10px] text-slate-400 font-mono">
                  <span>{msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  {msg.role === "model" && (
                    <button
                      onClick={() => handleCopyMessage(msg.id, msg.text)}
                      className="hover:text-slate-700 flex items-center gap-1 cursor-pointer transition-colors"
                      title={lang === "en" ? "Copy response" : "Salin jawapan"}
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span className="text-emerald-600">{lang === "en" ? "Copied" : "Disalin"}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>{lang === "en" ? "Copy" : "Salin"}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          );
        })}

        {/* Loading Spinner only shown if no active model response bubble is present */}
        {loading && messages[messages.length - 1]?.role !== "model" && (
          <div className="flex justify-start animate-fadeIn">
            <div className="flex gap-2.5 w-full sm:w-auto max-w-full sm:max-w-[85%]">
              <div className="w-7 h-7 rounded-lg bg-linear-to-br from-blue-600 to-indigo-700 text-white shrink-0 flex items-center justify-center shadow-xs">
                <Bot className="w-4 h-4 animate-bounce" />
              </div>
              <div className="bg-white border border-slate-200/90 rounded-xl rounded-tl-none px-4 py-3 text-xs shadow-xs text-slate-600 flex items-center gap-2.5">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
                <div>
                  <div className="font-semibold text-slate-800 flex items-center gap-2">
                    <span className="flex gap-1 items-center shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce" style={{ animationDelay: "0ms" }}></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce" style={{ animationDelay: "150ms" }}></span>
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce" style={{ animationDelay: "300ms" }}></span>
                    </span>
                    <span>{lang === "en" ? "Mr. Cost is typing..." : "Mr Cost sedang menaip..."}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {lang === "en"
                      ? "Verifying cost components, testing anomalies, and calculating margins."
                      : "Mengesahkan komponen kos, mengesan anomali, dan mengira margin keuntungan."}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl text-xs flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-xs">{lang === "en" ? "Connection Issue" : "Isu Sambungan AI"}</p>
              <p className="mt-0.5 leading-relaxed text-[11px]">{error}</p>
              {errorTechDetail && (
                <p className="mt-1.5 px-2 py-1 rounded bg-rose-100/80 border border-rose-200/80 font-mono text-[10px] text-rose-900 break-words">
                  {errorTechDetail}
                </p>
              )}
              <button
                onClick={() => {
                  if (messages.length > 1) {
                    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
                    if (lastUserMsg) handleSendMessage(lastUserMsg.text);
                  }
                }}
                className="mt-2 text-rose-700 underline font-semibold cursor-pointer hover:text-rose-900 block"
              >
                {lang === "en" ? "Retry last inquiry" : "Cuba semula soalan terakhir"}
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts Bar */}
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-200/80 overflow-x-auto whitespace-nowrap flex items-center gap-2 shrink-0">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-amber-500" />
          {lang === "en" ? "Quick Prompts:" : "Soalan Pantas:"}
        </span>
        {quickPrompts.map((qp, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(qp.query)}
            disabled={loading}
            className="px-2.5 py-1 bg-white hover:bg-slate-100 hover:border-blue-400 border border-slate-200 text-slate-700 rounded-full text-xs font-medium transition-all cursor-pointer shrink-0 disabled:opacity-50 shadow-2xs"
          >
            {qp.label}
          </button>
        ))}
      </div>

      {/* Input Form area */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage(inputValue);
        }}
        className="p-3 sm:p-4 border-t border-slate-200 bg-white flex items-center gap-2 shrink-0"
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={loading}
          placeholder={
            lang === "en"
              ? `Ask Mr. Cost about ${config.namaProduk} (e.g., 'What if price is $15?', 'Target margin 35%')...`
              : `Tanya Mr Cost tentang ${config.namaProduk} (cth: 'Kira kos kek coklat', 'Kalau harga RM15, berapa untung?')...`
          }
          className="flex-1 px-3.5 py-2.5 bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 focus:border-blue-600 disabled:bg-slate-100 rounded-lg text-xs outline-hidden transition-all text-slate-800 placeholder-slate-400"
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || loading}
          title={lang === "en" ? "Send inquiry" : "Hantar soalan"}
          className="p-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 text-white disabled:text-slate-400 rounded-lg transition-all cursor-pointer flex items-center justify-center shrink-0 shadow-xs"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {/* ==================================================================== */}
      {/* MODAL 1: PENGESANAN KESILAPAN DAN ANOMALI (ANOMALY AUDIT MODAL) */}
      {/* ==================================================================== */}
      {showAnomalyModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-scaleIn">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="font-display font-bold text-sm">
                    {lang === "en" ? "Proactive Data Anomaly & Error Audit" : "Pengesanan Kesilapan & Anomali Data Proaktif"}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {lang === "en" ? "Auditing active product: " : "Audit lembaran aktif: "}
                    {config.namaProduk}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAnomalyModal(false)}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3 flex-1 bg-slate-50/50">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 leading-relaxed">
                <strong>{lang === "en" ? "Policy:" : "Prinsip Keselamatan Data:"}</strong>{" "}
                {lang === "en"
                  ? "Mr. Cost AI actively flags anomalies and provides reasons and recommended corrections. It NEVER automatically deletes or alters your user records."
                  : "MR COST AI secara proaktif mengenal pasti anomali dan memberi sebab serta cadangan pembetulan. AI TIDAK AKAN sesekali mengubah atau memadam rekod data anda secara automatik."}
              </div>

              {detectedAnomalies.length === 0 ? (
                <div className="p-8 text-center bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                  <p className="font-bold text-sm">{lang === "en" ? "No Anomalies Found!" : "Tiada Anomali Dikesan!"}</p>
                  <p className="text-xs text-emerald-700 mt-1">
                    {lang === "en"
                      ? "All quantities, unit costs, selling prices, and margins in this worksheet are mathematically sound."
                      : "Semua kuantiti, kos bahan, harga jualan dan margin keuntungan dalam lembaran ini berada dalam julat munasabah."}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {detectedAnomalies.map((anomali) => (
                    <div
                      key={anomali.id}
                      className={`p-3.5 rounded-lg border text-xs ${
                        anomali.tahap === "kritikal"
                          ? "bg-rose-50 border-rose-200 text-rose-950"
                          : anomali.tahap === "amaran"
                          ? "bg-amber-50 border-amber-200 text-amber-950"
                          : "bg-sky-50 border-sky-200 text-sky-950"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              anomali.tahap === "kritikal"
                                ? "bg-rose-600"
                                : anomali.tahap === "amaran"
                                ? "bg-amber-600"
                                : "bg-sky-600"
                            }`}
                          />
                          {anomali.item}
                        </span>
                        <span className="text-[10px] uppercase font-mono font-bold px-1.5 py-0.5 rounded bg-white/70">
                          {anomali.tahap}
                        </span>
                      </div>
                      <p className="text-slate-700 mb-2 leading-relaxed">
                        <strong>{lang === "en" ? "Reason: " : "Sebab Dikesan: "}</strong>
                        {anomali.sebab}
                      </p>
                      <div className="bg-white/80 p-2.5 rounded border border-slate-200 text-[11px] text-slate-800">
                        <p>
                          <strong>{lang === "en" ? "Suggested Fix: " : "Cadangan Pembetulan: "}</strong>
                          {anomali.cadangan}
                        </p>
                        {anomali.suggestedFixValue && onApplySimulation && (
                          <div className="mt-2 pt-2 border-t border-slate-200/80 flex items-center justify-between">
                            <span className="text-[10px] text-slate-500 font-medium">
                              {lang === "en" ? "Quick automatic remediation:" : "Tindakan pembetulan segera:"}
                            </span>
                            <button
                              onClick={() => {
                                handleQuickRepairAnomaly(anomali);
                                setShowAnomalyModal(false);
                              }}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                            >
                              <Check className="w-3 h-3" />
                              <span>
                                {lang === "en"
                                  ? `Repair Error (Set RM ${(anomali.suggestedFixValue.hargaJualanStandard || 4.00).toFixed(2)})`
                                  : `Baiki Ralat Ini (Kemas kini RM ${(anomali.suggestedFixValue.hargaJualanStandard || 4.00).toFixed(2)})`}
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-white flex justify-end">
              <button
                onClick={() => setShowAnomalyModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                {lang === "en" ? "Close Audit" : "Tutup Audit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 2: KECERDASAN UNIT DAN PENUKARAN (UNIT INTELLIGENCE MODAL) */}
      {/* ==================================================================== */}
      {showUnitCalcModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden animate-scaleIn">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
              <div className="flex items-center gap-2.5">
                <Scale className="w-5 h-5 text-sky-400" />
                <div>
                  <h3 className="font-display font-bold text-sm">
                    {lang === "en" ? "Unit Intelligence & Conversion Tool" : "Kecerdasan Unit & Penukaran Sukatan"}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {lang === "en" ? "Understands purchase unit vs. recipe usage unit" : "Membezakan unit pembelian vs unit penggunaan"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowUnitCalcModal(false)}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg text-xs text-slate-700 leading-relaxed">
                <strong>{lang === "en" ? "Standard Business Ratios:" : "Nisbah Piawai Perniagaan:"}</strong>
                <ul className="list-disc pl-4 mt-1 space-y-0.5 font-mono text-[11px]">
                  <li>1 kg = 1,000 g | 1 tan = 1,000 kg</li>
                  <li>1 L = 1,000 ml</li>
                  <li>1 jam = 60 minit | 1 hari = 24 jam</li>
                  <li>1 dozen = 12 unit</li>
                </ul>
              </div>

              {/* Interactive Test Calculator */}
              <div className="border border-slate-200 rounded-lg p-3.5 space-y-3 bg-white">
                <h4 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                  <Calculator className="w-3.5 h-3.5 text-blue-600" />
                  {lang === "en" ? "Live Conversion Test (e.g., Scenario C)" : "Ujian Penukaran Langsung (cth: Ujian C)"}
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {lang === "en" ? "Purchase Price (RM)" : "Harga Pembelian (RM)"}
                    </label>
                    <input
                      type="number"
                      value={unitCalcState.purchasePrice}
                      onChange={(e) => setUnitCalcState({ ...unitCalcState, purchasePrice: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {lang === "en" ? "Purchase Package Size & Unit" : "Kuantiti & Unit Pembelian"}
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        value={unitCalcState.purchaseQty}
                        onChange={(e) => setUnitCalcState({ ...unitCalcState, purchaseQty: parseFloat(e.target.value) || 1 })}
                        className="w-16 px-2 py-1.5 border border-slate-300 rounded text-xs font-mono"
                      />
                      <select
                        value={unitCalcState.purchaseUnit}
                        onChange={(e) => setUnitCalcState({ ...unitCalcState, purchaseUnit: e.target.value })}
                        className="flex-1 px-2 py-1.5 border border-slate-300 rounded text-xs"
                      >
                        <option value="kg">kg (Kilogram)</option>
                        <option value="g">g (Gram)</option>
                        <option value="L">L (Liter)</option>
                        <option value="ml">ml (Mililiter)</option>
                        <option value="jam">jam (Jam)</option>
                        <option value="dozen">dozen (12 unit)</option>
                        <option value="unit">unit</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {lang === "en" ? "Usage / Recipe Quantity" : "Kuantiti Penggunaan / Resipi"}
                    </label>
                    <input
                      type="number"
                      value={unitCalcState.usageQty}
                      onChange={(e) => setUnitCalcState({ ...unitCalcState, usageQty: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      {lang === "en" ? "Usage Unit" : "Unit Penggunaan"}
                    </label>
                    <select
                      value={unitCalcState.usageUnit}
                      onChange={(e) => setUnitCalcState({ ...unitCalcState, usageUnit: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs"
                    >
                      <option value="g">g (Gram)</option>
                      <option value="kg">kg (Kilogram)</option>
                      <option value="ml">ml (Mililiter)</option>
                      <option value="L">L (Liter)</option>
                      <option value="minit">minit</option>
                      <option value="jam">jam</option>
                      <option value="unit">unit</option>
                    </select>
                  </div>
                </div>

                {unitCalcResult && (
                  <div className={`p-3 rounded-lg border text-xs mt-3 ${
                    unitCalcResult.success ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-rose-50 border-rose-200 text-rose-900"
                  }`}>
                    {unitCalcResult.success ? (
                      <>
                        <div className="font-bold text-sm mb-1 text-emerald-950">
                          Kos Penggunaan Bahan: RM {unitCalcResult.cost.toFixed(2)}
                        </div>
                        <p className="text-[11px] text-emerald-800">{unitCalcResult.explanation}</p>
                      </>
                    ) : (
                      <>
                        <div className="font-bold text-rose-950 mb-0.5">{lang === "en" ? "Incompatible Units:" : "Unit Tidak Serasi:"}</div>
                        <p className="text-[11px]">{unitCalcResult.explanation}</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-white flex justify-end">
              <button
                onClick={() => setShowUnitCalcModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                {lang === "en" ? "Done" : "Selesai"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 3: UJIAN KETEPATAN MATEMATIK A-E (MATHEMATICAL VERIFICATION MODAL) */}
      {/* ==================================================================== */}
      {showTestModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-scaleIn">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
              <div className="flex items-center gap-2.5">
                <Calculator className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="font-display font-bold text-sm">
                    {lang === "en" ? "Deterministic Accuracy Test Suite (A - E)" : "Siri Ujian Ketepatan Matematik Deterministik (A - E)"}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {lang === "en" ? "Mandatory validation benchmarks" : "Ujian wajib sebelum pelepasan sistem"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowTestModal(false)}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3 flex-1 bg-slate-50/50">
              <div className="space-y-2.5">
                {testResults.map((t, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-white rounded-lg border border-slate-200 shadow-2xs flex items-start justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-900 flex items-center gap-2">
                        <span>{t.ujian}</span>
                        <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                          {JSON.stringify(t.input)}
                        </span>
                      </div>
                      <p className="text-slate-600 text-[11px] mt-1 leading-relaxed">{t.catatan}</p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono shrink-0 ${
                        t.status === "LULUS"
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          : "bg-rose-100 text-rose-800 border border-rose-300"
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-white flex justify-end">
              <button
                onClick={() => setShowTestModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                {lang === "en" ? "Close" : "Tutup"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 4: CADANGAN PENJIMATAN KOS (COST SAVINGS OPPORTUNITIES MODAL) */}
      {/* ==================================================================== */}
      {showSavingsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-scaleIn">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
              <div className="flex items-center gap-2.5">
                <Lightbulb className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="font-display font-bold text-sm">
                    {lang === "en" ? "Actionable Cost-Reduction Opportunities" : "Peluang Penjimatan Kos Berdasarkan Data Sebenar"}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {config.namaSyarikat} · {config.namaProduk}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSavingsModal(false)}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3 flex-1 bg-slate-50/50">
              {costSavings.map((item, idx) => (
                <div key={idx} className="bg-white border border-slate-200 rounded-lg p-4 space-y-2 text-xs shadow-2xs">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-emerald-600" />
                      {item.kategori}
                    </h4>
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded border border-emerald-200">
                      {item.anggaranPenjimatan}
                    </span>
                  </div>

                  <p className="text-slate-700">
                    <strong>{lang === "en" ? "Issue: " : "Masalah Dikenal Pasti: "}</strong>
                    {item.masalah}
                  </p>
                  <p className="text-slate-600 text-[11px]">
                    <strong>{lang === "en" ? "Evidence: " : "Bukti / Nilai Data: "}</strong>
                    {item.buktiNilai}
                  </p>
                  <div className="bg-emerald-50/50 border border-emerald-200/60 p-2 rounded text-[11px] text-emerald-900">
                    <strong>{lang === "en" ? "Action: " : "Tindakan Disyorkan: "}</strong>
                    {item.tindakan}
                  </div>
                  <p className="text-[10px] text-slate-400 italic">
                    <strong>{lang === "en" ? "Assumption: " : "Andaian: "}</strong>
                    {item.andaian}
                  </p>
                </div>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-white flex justify-end">
              <button
                onClick={() => setShowSavingsModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                {lang === "en" ? "Close" : "Tutup"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 5: SIMULASI SENARIO MARGIN (SCENARIO SIMULATOR MODAL) */}
      {/* ==================================================================== */}
      <ModalPortal
        isOpen={showScenarioModal}
        onClose={() => setShowScenarioModal(false)}
        title={lang === "en" ? "Interactive What-If Simulation Studio" : "Studio Simulasi Senario What-If Interaktif"}
        icon={<Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
        closeAriaLabel={lang === "en" ? "Close" : "Tutup"}
      >
        <ScenarioSimulatorSheet
          config={config}
          bahanMentah={bahanMentah}
          buruhLangsung={buruhLangsung}
          overheadBerubah={overheadBerubah}
          overheadTetap={overheadTetap}
          stdSummary={resolvedStdSummary}
          actSummary={resolvedActSummary}
          systemLang={lang}
          onApplySimulation={onApplySimulation}
          onClose={() => setShowScenarioModal(false)}
        />
      </ModalPortal>

      {/* ==================================================================== */}
      {/* MODAL 6: SEBUT HARGA TEMPAHAN PUKAL (BATCH QUOTATION MODAL) */}
      {/* ==================================================================== */}
      <ModalPortal
        isOpen={showQuotationModal}
        onClose={() => setShowQuotationModal(false)}
        title={lang === "en" ? "B2B Bulk Quotation & Tier Pricing Studio" : "Studio Sebut Harga & Skala Pesanan Pukal B2B"}
        icon={<FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
        closeAriaLabel={lang === "en" ? "Close" : "Tutup"}
      >
        <BatchQuotationSheet
          config={config}
          bahanMentah={bahanMentah}
          buruhLangsung={buruhLangsung}
          overheadBerubah={overheadBerubah}
          overheadTetap={overheadTetap}
          stdSummary={resolvedStdSummary}
          actSummary={resolvedActSummary}
          systemLang={lang}
          onClose={() => setShowQuotationModal(false)}
        />
      </ModalPortal>
    </div>
  );
}
