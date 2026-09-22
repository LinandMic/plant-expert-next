import { useRef, useState } from "react";
import { IconX, IconSprig } from "@/components/ui/icons";
import IconButton from "@/components/ui/IconButton";
import Button from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n";
import { createSessionId, sendMessage } from "@/lib/chatApi";

// Per-errorCode UI policy: which message to show, and which actions the
// user gets. Mirrors exactly what pages/api/chat.js can return (see that
// file's `code` values) — every code it can send back has an entry here
// so no server response leaves the UI silently stuck.
const ERROR_POLICY = {
  AUTH_REQUIRED: { messageKey: "assistant.errorSessionExpired", canRetry: false, canStartNew: false, sessionEnded: true },
  NO_CREDITS: { messageKey: "identifier.noCredits", canRetry: false, canStartNew: false, sessionEnded: true },
  SESSION_CLOSED: { messageKey: "assistant.sessionEnded", canRetry: false, canStartNew: true, sessionEnded: true },
  FIRST_MESSAGE_FAILED: { messageKey: "assistant.errorGeneric", canRetry: false, canStartNew: true, sessionEnded: true },
  MESSAGE_FAILED: { messageKey: "assistant.errorGeneric", canRetry: true, canStartNew: false, sessionEnded: false },
  MESSAGE_TOO_LONG: { messageKey: "assistant.messageTooLong", canRetry: false, canStartNew: false, sessionEnded: false, invalidInput: true },
  INVALID_BODY: { messageKey: "assistant.errorGeneric", canRetry: false, canStartNew: false, sessionEnded: false, invalidInput: true },
  TRANSCRIPT_TOO_LONG: { messageKey: "assistant.sessionEnded", canRetry: false, canStartNew: true, sessionEnded: true },
  FORBIDDEN: { messageKey: "assistant.errorGeneric", canRetry: false, canStartNew: true, sessionEnded: true },
  session_expired: { messageKey: "assistant.errorSessionExpired", canRetry: false, canStartNew: false, sessionEnded: true },
  network: { messageKey: "assistant.errorGeneric", canRetry: true, canStartNew: false, sessionEnded: false },
  generic: { messageKey: "assistant.errorGeneric", canRetry: true, canStartNew: false, sessionEnded: false },
};

function policyFor(errorCode) {
  return ERROR_POLICY[errorCode] || ERROR_POLICY.generic;
}

// ChatModal — reusable overlay/panel for the ALMEO Conversational
// Assistant, mirroring DeleteAccountModal.js's structural conventions
// (role="dialog", overlay+panel, scoped inline <style>). `context` is the
// small, optional { mode: "plant"|"identification", plantId?,
// identification? } payload forwarded to pages/api/chat.js on every
// message — see lib/chatContext.js for what the server actually trusts
// from it. `title` is display-only (never sent to the server).
//
// V1 does not persist the transcript anywhere (see the spec's chat-
// content-persistence section) — `messages` lives only in this
// component's own state and is lost on close/reload by design.
export default function ChatModal({ onClose, context, title }) {
  const { t } = useI18n();
  const sessionIdRef = useRef(null);
  if (!sessionIdRef.current) {
    sessionIdRef.current = createSessionId();
  }

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null); // { policy } | null
  const [sessionEnded, setSessionEnded] = useState(false);

  function startNewConversation() {
    sessionIdRef.current = createSessionId();
    setMessages([]);
    setInput("");
    setError(null);
    setSessionEnded(false);
  }

  async function submit(messagesToSend) {
    setSending(true);
    setError(null);
    const result = await sendMessage({
      sessionId: sessionIdRef.current,
      messages: messagesToSend,
      context,
    });
    setSending(false);

    if (!result.ok) {
      const policy = policyFor(result.errorCode);
      if (policy.invalidInput) {
        // Never actually reached the server as a real turn — roll back
        // the optimistic append so the user can edit and resend.
        setMessages(messagesToSend.slice(0, -1));
        setInput(messagesToSend[messagesToSend.length - 1].content);
      }
      if (policy.sessionEnded) setSessionEnded(true);
      setError({ policy });
      return;
    }

    const reply = result.data && result.data.message;
    if (reply && typeof reply.content === "string") {
      setMessages([...messagesToSend, { role: "assistant", content: reply.content }]);
    }
    const sessionStatus = result.data && result.data.session && result.data.session.status;
    if (sessionStatus === "closed") setSessionEnded(true);
  }

  function handleSend() {
    const text = input.trim();
    if (!text || sending || sessionEnded) return;
    const messagesToSend = [...messages, { role: "user", content: text }];
    setMessages(messagesToSend);
    setInput("");
    submit(messagesToSend);
  }

  function handleRetry() {
    if (messages.length === 0) return;
    submit(messages);
  }

  return (
    <div className="cm-overlay" onClick={onClose}>
      <style>{CHAT_MODAL_STYLES}</style>
      <div
        className="cm-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cm-title"
      >
        <div className="cm-header">
          <div className="cm-header-title" id="cm-title">
            <IconSprig size={18} />
            <span>{title ? t("assistant.modalTitleForPlant", { name: title }) : t("assistant.modalTitle")}</span>
          </div>
          <IconButton icon={IconX} label={t("assistant.close")} onClick={onClose} className="cm-close-btn" />
        </div>

        <div className="cm-messages">
          {messages.length === 0 && !sending && (
            <div className="cm-empty-hint">{t("assistant.inputPlaceholder")}</div>
          )}
          {messages.map((message, index) => (
            <div key={index} className={"cm-bubble cm-bubble-" + message.role}>
              {message.content}
            </div>
          ))}
          {sending && <div className="cm-bubble cm-bubble-assistant cm-bubble-thinking">{t("assistant.thinking")}</div>}
        </div>

        {error && (
          <div className="cm-error">
            <span>{t(error.policy.messageKey)}</span>
            <div className="cm-error-actions">
              {error.policy.canRetry && (
                <Button variant="secondary" onClick={handleRetry}>
                  {t("assistant.retry")}
                </Button>
              )}
              {error.policy.canStartNew && (
                <Button variant="secondary" onClick={startNewConversation}>
                  {t("assistant.startNewConversation")}
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="cm-input-row">
          <input
            className="cm-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={t("assistant.inputPlaceholder")}
            disabled={sending || sessionEnded}
          />
          <Button onClick={handleSend} disabled={sending || sessionEnded || !input.trim()}>
            {t("assistant.send")}
          </Button>
        </div>
        <p className="cm-disclaimer">{t("app.aiDisclaimer")}</p>
      </div>
    </div>
  );
}

const CHAT_MODAL_STYLES = `
  .cm-overlay { position:fixed;inset:0;background:rgba(24,33,29,0.45);display:flex;align-items:flex-end;justify-content:center;padding:0;z-index:1000; }
  @media (min-width:640px) { .cm-overlay { align-items:center;padding:20px; } }
  .cm-panel { position:relative;width:100%;max-width:480px;height:min(680px,88vh);display:flex;flex-direction:column;background:var(--pe-surface);border-radius:var(--pe-radius-lg) var(--pe-radius-lg) 0 0;border:1px solid var(--pe-border);box-shadow:var(--pe-shadow-md);padding:0;overflow:hidden; }
  @media (min-width:640px) { .cm-panel { border-radius:var(--pe-radius-lg);height:min(640px,85vh); } }

  .cm-header { display:flex;align-items:center;justify-content:space-between;padding:16px 16px 14px 20px;border-bottom:1px solid var(--pe-border);flex-shrink:0; }
  .cm-header-title { display:flex;align-items:center;gap:8px;font-family:var(--pe-font-display);font-weight:600;font-size:16px;color:var(--pe-text); }
  .cm-header-title svg { color:var(--pe-accent); }

  .cm-messages { flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:10px; }
  .cm-empty-hint { color:var(--pe-text-muted);font:var(--pe-text-small);text-align:center;margin-top:24px; }
  .cm-bubble { max-width:82%;padding:10px 14px;border-radius:var(--pe-radius-md,14px);font:var(--pe-text-body);line-height:1.45;white-space:pre-wrap;word-break:break-word; }
  .cm-bubble-user { align-self:flex-end;background:var(--pe-accent);color:var(--pe-on-accent);border-bottom-right-radius:4px; }
  .cm-bubble-assistant { align-self:flex-start;background:var(--pe-sand);color:var(--pe-text);border-bottom-left-radius:4px; }
  .cm-bubble-thinking { color:var(--pe-text-muted);font-style:italic; }

  .cm-error { margin:0 20px 10px;padding:10px 14px;background:#fff5f5;border:1px solid rgba(139,58,30,0.2);border-radius:var(--pe-radius-sm);color:var(--pe-terracotta,#8b3a1e);font:var(--pe-text-small);display:flex;flex-direction:column;gap:8px; }
  .cm-error-actions { display:flex;gap:8px;flex-wrap:wrap; }

  .cm-input-row { display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--pe-border);flex-shrink:0;padding-bottom:calc(12px + env(safe-area-inset-bottom, 0px)); }
  .cm-input { flex:1;min-height:44px;border:1px solid var(--pe-border);border-radius:var(--pe-radius-sm);padding:10px 14px;font-family:var(--pe-font-body);font-size:14px;color:var(--pe-text);background:var(--pe-surface);outline:none; }
  .cm-input:focus { border-color:var(--pe-accent); }
  .cm-input:disabled { opacity:0.6; }

  .cm-disclaimer { margin:0;padding:0 20px 12px;font-size:11px;color:var(--pe-text-muted);text-align:center; }
`;
